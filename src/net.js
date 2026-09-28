// Transport layer. Two implementations with the same shape:
//  - trystero: real WebRTC peer-to-peer, discovered via public Nostr relays (no server of our own)
//  - local:    BroadcastChannel between tabs of one browser (for testing: add ?local to the URL)
//
// transport = { selfId, send(type, data, targetPeerId?), on(type, cb(data, peerId)),
//               onPeerJoin(cb), onPeerLeave(cb), leave() }

const APP_ID = 'avalon-p2p-game-v1'

export async function connect(roomId) {
  if (new URLSearchParams(location.search).has('local')) return localTransport(roomId)
  return trysteroTransport(roomId)
}

async function trysteroTransport(roomId) {
  const { joinRoom, selfId } = await import('trystero')
  // The room id doubles as the password, so relay operators can't read the connection offers.
  const room = joinRoom({ appId: APP_ID, password: roomId }, roomId)
  const msg = room.makeAction('msg')
  const handlers = {}
  msg.onMessage = (packet, { peerId }) => handlers[packet?.type]?.(packet.data, peerId)
  const joinCbs = []
  const leaveCbs = []
  room.onPeerJoin = id => joinCbs.forEach(cb => cb(id))
  room.onPeerLeave = id => leaveCbs.forEach(cb => cb(id))
  return {
    selfId,
    send: (type, data, target) => msg.send({ type, data }, target ? { target } : undefined).catch(() => {}),
    on: (type, cb) => { handlers[type] = cb },
    onPeerJoin: cb => joinCbs.push(cb),
    onPeerLeave: cb => leaveCbs.push(cb),
    peerCount: () => Object.keys(room.getPeers()).length,
    leave: () => room.leave(),
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
    peerCount: () => peers.size,
    leave: () => { post({ kind: 'bye' }); ch.close() },
  }
}
