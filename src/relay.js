// Relay message path: encrypted pub/sub through public MQTT brokers over secure WebSockets.
//
// WebRTC needs a direct connection between phones, which some networks (mobile carriers,
// Wi-Fi with client isolation) don't allow. This path only needs ordinary outbound WebSockets,
// so it works anywhere the web works. Several brokers are used at once for redundancy.
//
// Privacy: everything published is encrypted with a key derived from the room id (which only
// lives in the invite link's #fragment), so brokers see only noise. Messages addressed to one
// player (e.g. their secret role, or their quest card) are additionally encrypted with an
// ECDH-derived key shared only by sender and recipient, so other players can't read them either.

export const MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://mqtt.eclipseprojects.io:443/mqtt',
  'wss://public.cloud.shiftr.io', // username/password: public/public
]

const HEARTBEAT_MS = 8000

const enc = new TextEncoder()
const dec = new TextDecoder()
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0))
const randomId = () => b64(crypto.getRandomValues(new Uint8Array(9)))

// ---------------------------------------------------------------- minimal MQTT 3.1.1 client (QoS 0)

function varint(n) {
  const out = []
  do {
    let byte = n % 128
    n = Math.floor(n / 128)
    if (n > 0) byte |= 128
    out.push(byte)
  } while (n > 0)
  return out
}
const str = s => {
  const b = enc.encode(s)
  return [b.length >> 8, b.length & 255, ...b]
}
const packet = (type, body) => new Uint8Array([type, ...varint(body.length), ...body])

function mqttConnection(url, clientId, topic, onMessage) {
  const u = new URL(url)
  const creds = u.hostname.endsWith('shiftr.io') ? { user: 'public', pass: 'public' } : null
  let ws
  let buf = new Uint8Array(0)
  let ping
  let closed = false
  let retry = 1000
  const conn = { url, open: false }

  const connect = () => {
    if (closed) return
    try {
      ws = new WebSocket(url, 'mqtt')
    } catch {
      return setTimeout(connect, (retry = Math.min(retry * 2, 30000)))
    }
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      const flags = creds ? 0xc2 : 0x02 // clean session (+ username & password)
      const body = [...str('MQTT'), 4, flags, 0, 60, ...str(clientId)]
      if (creds) body.push(...str(creds.user), ...str(creds.pass))
      ws.send(packet(0x10, body))
    }
    ws.onmessage = e => {
      const next = new Uint8Array(buf.length + e.data.byteLength)
      next.set(buf)
      next.set(new Uint8Array(e.data), buf.length)
      buf = next
      parse()
    }
    ws.onclose = () => {
      conn.open = false
      clearInterval(ping)
      if (!closed) setTimeout(connect, (retry = Math.min(retry * 2, 30000)))
    }
    ws.onerror = () => {}
  }

  const parse = () => {
    for (;;) {
      if (buf.length < 2) return
      let len = 0
      let mult = 1
      let i = 1
      let byte
      do {
        if (i >= buf.length) return
        byte = buf[i++]
        len += (byte & 127) * mult
        mult *= 128
      } while (byte & 128)
      if (buf.length < i + len) return
      const header = buf[0]
      const type = header & 0xf0
      const body = buf.slice(i, i + len)
      buf = buf.slice(i + len)
      if (type === 0x20) {
        // CONNACK
        if (body[1] !== 0) return ws.close()
        retry = 1000
        conn.open = true
        ws.send(packet(0x82, [0, 1, ...str(topic), 0])) // SUBSCRIBE, packet id 1, QoS 0
        ping = setInterval(() => ws.readyState === 1 && ws.send(new Uint8Array([0xc0, 0])), 30000)
        conn.onOpen?.()
      } else if (type === 0x30) {
        // PUBLISH (QoS 0: no packet id)
        const tlen = (body[0] << 8) | body[1]
        const qos = (header >> 1) & 3
        onMessage(body.slice(2 + tlen + (qos ? 2 : 0)))
      }
    }
  }

  conn.publish = payload => {
    if (!conn.open || ws.readyState !== 1) return
    ws.send(packet(0x30, [...str(topic), ...payload]))
  }
  conn.close = () => {
    closed = true
    clearInterval(ping)
    try { ws?.close() } catch {}
  }
  connect()
  return conn
}

// ---------------------------------------------------------------- encrypted room channel

async function sha256(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))
}

async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return out
}

async function open(key, bytes) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12))
  return JSON.parse(dec.decode(pt))
}

// Returns { send(obj, to?), onMessage(cb(obj, from)), onPeer(cb(id)), stats(), close() }
export async function relayChannel({ roomId, selfId, brokers = MQTT_BROKERS }) {
  const topicHash = [...(await sha256(`avalon-topic:${roomId}`)).subarray(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('')
  const topic = `avalon-p2p/${topicHash}`
  const roomKey = await crypto.subtle.importKey('raw', await sha256(`avalon-room-key:${roomId}`), 'AES-GCM', false, ['encrypt', 'decrypt'])
  const ecdh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey'])
  const myPk = b64(await crypto.subtle.exportKey('raw', ecdh.publicKey))

  const peerKeys = new Map() // peerId -> { pk, key: Promise<CryptoKey> }
  const lastSeen = new Map() // peerId -> ms
  const seen = new Set()
  let onMsg = () => {}
  let onPeer = () => {}
  let onLeave = () => {}

  const pairKey = (peerId, pk) => {
    const known = peerKeys.get(peerId)
    if (known?.pk === pk) return known.key
    const key = crypto.subtle
      .importKey('raw', unb64(pk), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
      .then(pub => crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, ecdh.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']))
    peerKeys.set(peerId, { pk, key })
    return key
  }

  const receive = async bytes => {
    let env
    try { env = await open(roomKey, bytes) } catch { return }
    if (!env || env.from === selfId || seen.has(env.id)) return
    remember(env.id)
    if (typeof env.from !== 'string' || typeof env.pk !== 'string') return
    const isNew = !lastSeen.has(env.from)
    const key = pairKey(env.from, env.pk)
    lastSeen.set(env.from, Date.now())
    if (isNew) {
      announce() // let the newcomer learn our key straight away
      onPeer(env.from)
    }
    if (env.to && env.to !== selfId) return
    let body = env.body
    if (env.to) {
      try { body = await open(await key, unb64(env.sealed)) } catch { return }
    }
    if (body) onMsg(body, env.from)
  }
  const remember = id => {
    seen.add(id)
    if (seen.size > 2000) seen.delete(seen.values().next().value)
  }

  const clientId = `avalon-${randomId().replace(/[^a-zA-Z0-9]/g, '')}`
  const conns = brokers.map((url, i) => mqttConnection(url, `${clientId}-${i}`, topic, bytes => void receive(bytes)))

  const publish = async (to, body) => {
    const env = { id: randomId(), from: selfId, pk: myPk }
    if (to) {
      const peer = peerKeys.get(to)
      if (!peer) return false
      env.to = to
      env.sealed = b64(await seal(await peer.key, body))
    } else {
      env.body = body
    }
    const bytes = await seal(roomKey, env)
    conns.forEach(c => c.publish(bytes))
    return true
  }

  // Announce ourselves when a broker connects and then as a heartbeat; peers that go quiet have left
  const announce = () => void publish(null, null)
  conns.forEach(c => { c.onOpen = announce })
  const heartbeat = setInterval(() => {
    announce()
    const cutoff = Date.now() - HEARTBEAT_MS * 3.5
    for (const [id, t] of lastSeen) {
      if (t < cutoff) {
        lastSeen.delete(id)
        onLeave(id)
      }
    }
  }, HEARTBEAT_MS)

  return {
    send: (body, to) => publish(to, body),
    onMessage: cb => { onMsg = cb },
    onPeer: cb => { onPeer = cb },
    onLeave: cb => { onLeave = cb },
    stats: () => ({ open: conns.filter(c => c.open).length, total: conns.length }),
    close: () => {
      clearInterval(heartbeat)
      conns.forEach(c => c.close())
    },
  }
}
