// Transport layer. Two implementations with the same shape:
//  - trystero: real WebRTC peer-to-peer. Peers find each other through public Nostr relays
//              AND public BitTorrent WebSocket trackers at the same time (no server of our own),
//              so one flaky signalling network doesn't stop a game.
//  - local:    BroadcastChannel between tabs of one browser (for testing: add ?local to the URL)
//
// transport = { selfId, send(type, data, targetPeerId?), on(type, cb(data, peerId)),
//               onPeerJoin(cb), onPeerLeave(cb), onError(cb), stats(), leave() }

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
  return trysteroTransport(roomId, params.getAll('relay'), params.getAll('tracker'))
}

async function trysteroTransport(roomId, customRelays, customTrackers) {
  const [nostr, torrent] = await Promise.all([import('@trystero-p2p/nostr'), import('@trystero-p2p/torrent')])
  // ?relay=wss://… and/or ?tracker=wss://… replace the defaults (testing / troubleshooting)
  const custom = customRelays.length || customTrackers.length
  const strategies = [
    { lib: nostr, urls: custom ? customRelays : NOSTR_RELAYS },
    { lib: torrent, urls: custom ? customTrackers : TORRENT_TRACKERS },
  ].filter(x => x.urls.length)

  const handlers = {}
  const joinCbs = []
  const leaveCbs = []
  const errorCbs = []
  const peerRooms = new Map() // peerId -> Set of room entries it is reachable through

  const rooms = strategies.map(({ lib, urls }) => {
    const entry = { lib }
    // The room id doubles as the password, so relay operators can't read the connection offers.
    entry.room = lib.joinRoom({ appId: APP_ID, password: roomId, relayConfig: { urls, warnOnRelayFailure: false } }, roomId, {
      onJoinError: details => errorCbs.forEach(cb => cb(details)),
    })
    entry.msg = entry.room.makeAction('msg')
    entry.msg.onMessage = (packet, { peerId }) => handlers[packet?.type]?.(packet.data, peerId)
    entry.room.onPeerJoin = id => {
      const set = peerRooms.get(id) ?? new Set()
      const isNew = set.size === 0
      set.add(entry)
      peerRooms.set(id, set)
      if (isNew) joinCbs.forEach(cb => cb(id))
    }
    entry.room.onPeerLeave = id => {
      const set = peerRooms.get(id)
      if (!set) return
      set.delete(entry)
      if (set.size === 0) {
        peerRooms.delete(id)
        leaveCbs.forEach(cb => cb(id))
      }
    }
    return entry
  })

  const sendTo = (peerId, packet) => {
    const entry = peerRooms.get(peerId)?.values().next().value
    return entry?.msg.send(packet, { target: peerId }).catch(() => {})
  }

  return {
    selfId: nostr.selfId,
    // Always send per-peer so a peer reachable over both networks gets each message once
    send: (type, data, target) => {
      const packet = { type, data }
      if (target) return sendTo(target, packet)
      for (const id of peerRooms.keys()) sendTo(id, packet)
    },
    on: (type, cb) => { handlers[type] = cb },
    onPeerJoin: cb => joinCbs.push(cb),
    onPeerLeave: cb => leaveCbs.push(cb),
    onError: cb => errorCbs.push(cb),
    peerCount: () => peerRooms.size,
    stats: () => {
      let open = 0
      let total = 0
      for (const { lib } of rooms) {
        for (const ws of Object.values(lib.getRelaySockets?.() ?? {})) {
          total++
          if (ws?.readyState === 1) open++
        }
      }
      return { relaysOpen: open, relaysTotal: total, peers: peerRooms.size }
    },
    leave: () => rooms.forEach(r => r.room.leave()),
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
