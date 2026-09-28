// Transport layer. Two implementations with the same shape:
//  - hybrid: direct WebRTC between phones (found via public Nostr relays and BitTorrent trackers)
//            plus an encrypted relay through public MQTT brokers for networks where direct
//            connections fail. No server of our own.
//  - local:  BroadcastChannel between tabs of one browser (for testing: add ?local to the URL)
//
// transport = { selfId, send(type, data, targetPeerId?), on(type, cb(data, peerId)),
//               onPeerJoin(cb), onPeerLeave(cb), onError(cb), stats(), leave() }

import { relayChannel, MQTT_BROKERS } from './relay.js'

const APP_ID = 'avalon-p2p-game-v1'

// Large, well-established public relays. Every player must use the same list.
const NOSTR_RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.nostr.net',
  'wss://offchain.pub',
  'wss://purplerelay.com',
  'wss://relay.mostr.pub',
]
const TORRENT_TRACKERS = [
  'wss://tracker.webtorrent.dev',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.files.fm:7073/announce',
  'wss://open.ftorrent.com',
]

export async function connect(roomId) {
  const params = new URLSearchParams(location.search)
  if (params.has('local')) return localTransport(roomId)
  // ?relay=…, ?tracker=… and ?mqtt=… replace the default servers (testing / troubleshooting);
  // pass "none" to switch a path off.
  const pick = (key, defaults) => {
    const custom = params.getAll(key)
    return custom.length ? custom.filter(u => u !== 'none') : defaults
  }
  const custom = ['relay', 'tracker'].some(k => params.has(k))
  return hybridTransport(roomId, {
    nostr: custom ? pick('relay', []) : NOSTR_RELAYS,
    torrent: custom ? pick('tracker', []) : TORRENT_TRACKERS,
    mqtt: pick('mqtt', MQTT_BROKERS),
  })
}

// Messages travel over direct WebRTC (when phones can connect directly) AND through the
// encrypted MQTT relay (which works on any network). Each message carries an id, so whichever
// copy arrives first wins and the other is dropped.
async function hybridTransport(roomId, servers) {
  const [nostr, torrent] = await Promise.all([import('@trystero-p2p/nostr'), import('@trystero-p2p/torrent')])
  const selfId = nostr.selfId

  const handlers = {}
  const joinCbs = []
  const leaveCbs = []
  const errorCbs = []
  const seen = new Set()
  const rtcPeers = new Map() // peerId -> Set of trystero room entries it is reachable through
  const relayPeers = new Set()
  const knownPeers = () => new Set([...rtcPeers.keys(), ...relayPeers])

  const deliver = (packet, peerId) => {
    if (!packet || typeof packet !== 'object' || seen.has(packet.mid)) return
    seen.add(packet.mid)
    if (seen.size > 2000) seen.delete(seen.values().next().value)
    handlers[packet.type]?.(packet.data, peerId)
  }
  const peerUp = (id, add) => {
    const had = rtcPeers.has(id) || relayPeers.has(id)
    add()
    if (!had) joinCbs.forEach(cb => cb(id))
  }
  const peerDown = (id, remove) => {
    remove()
    if (!rtcPeers.has(id) && !relayPeers.has(id)) leaveCbs.forEach(cb => cb(id))
  }

  // ---- WebRTC via Trystero (Nostr + BitTorrent signalling)
  const rooms = [
    { lib: nostr, urls: servers.nostr },
    { lib: torrent, urls: servers.torrent },
  ].filter(x => x.urls.length).map(({ lib, urls }) => {
    const entry = { lib }
    // The room id doubles as the password, so relay operators can't read the connection offers.
    entry.room = lib.joinRoom({ appId: APP_ID, password: roomId, relayConfig: { urls, warnOnRelayFailure: false } }, roomId, {
      onJoinError: details => errorCbs.forEach(cb => cb(details)),
    })
    entry.msg = entry.room.makeAction('msg')
    entry.msg.onMessage = (packet, { peerId }) => deliver(packet, peerId)
    entry.room.onPeerJoin = id => peerUp(id, () => rtcPeers.set(id, (rtcPeers.get(id) ?? new Set()).add(entry)))
    entry.room.onPeerLeave = id => peerDown(id, () => {
      const set = rtcPeers.get(id)
      set?.delete(entry)
      if (!set?.size) rtcPeers.delete(id)
    })
    return entry
  })

  // ---- Encrypted MQTT relay
  const relay = servers.mqtt.length ? await relayChannel({ roomId, selfId, brokers: servers.mqtt }) : null
  relay?.onMessage((packet, peerId) => deliver(packet, peerId))
  relay?.onPeer(id => peerUp(id, () => relayPeers.add(id)))
  relay?.onLeave(id => peerDown(id, () => relayPeers.delete(id)))

  const sendTo = (peerId, packet) => {
    const entry = rtcPeers.get(peerId)?.values().next().value
    entry?.msg.send(packet, { target: peerId }).catch(() => {})
    if (relayPeers.has(peerId)) relay.send(packet, peerId)
  }

  return {
    selfId,
    // Always addressed per-peer: each message is encrypted for its recipient only
    send: (type, data, target) => {
      const packet = { mid: Math.random().toString(36).slice(2) + Date.now().toString(36), type, data }
      for (const id of target ? [target] : knownPeers()) sendTo(id, packet)
    },
    on: (type, cb) => { handlers[type] = cb },
    onPeerJoin: cb => joinCbs.push(cb),
    onPeerLeave: cb => leaveCbs.push(cb),
    onError: cb => errorCbs.push(cb),
    peerCount: () => knownPeers().size,
    stats: () => {
      let open = 0
      let total = 0
      for (const { lib } of rooms) {
        for (const ws of Object.values(lib.getRelaySockets?.() ?? {})) {
          total++
          if (ws?.readyState === 1) open++
        }
      }
      const r = relay?.stats() ?? { open: 0, total: 0 }
      return {
        relaysOpen: open + r.open,
        relaysTotal: total + r.total,
        brokersOpen: r.open,
        peers: knownPeers().size,
        direct: rtcPeers.size,
      }
    },
    leave: () => {
      rooms.forEach(r => r.room.leave())
      relay?.close()
    },
  }
}

function localTransport(roomId) {
  const selfId = Math.random().toString(36).slice(2, 10)
  const ch = new BroadcastChannel(`avalon:${roomId}`)
  const handlers = {}
  const joinCbs = []
  const leaveCbs = []
  const peers = new Set()
  const post = m => ch.postMessage({ ...m, from: selfId })
  const addPeer = id => {
    if (peers.has(id)) return
    peers.add(id)
    joinCbs.forEach(cb => cb(id))
  }
  ch.onmessage = ({ data: m }) => {
    if (m.to && m.to !== selfId) return
    if (m.kind === 'hi') { if (!peers.has(m.from)) post({ kind: 'hi', to: m.from }); addPeer(m.from) }
    else if (m.kind === 'bye') { peers.delete(m.from); leaveCbs.forEach(cb => cb(m.from)) }
    else if (m.kind === 'msg') { addPeer(m.from); handlers[m.type]?.(m.data, m.from) }
  }
  addEventListener('pagehide', () => post({ kind: 'bye' }))
  setTimeout(() => post({ kind: 'hi' }), 50)
  return {
    selfId,
    send: (type, data, target) => post({ kind: 'msg', type, data, to: target }),
    on: (type, cb) => { handlers[type] = cb },
    onPeerJoin: cb => joinCbs.push(cb),
    onPeerLeave: cb => leaveCbs.push(cb),
    onError: () => {},
    peerCount: () => peers.size,
    stats: () => ({ relaysOpen: 1, relaysTotal: 1, peers: peers.size }),
    leave: () => { post({ kind: 'bye' }); ch.close() },
  }
}
