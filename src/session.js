// Game session: the host device owns the authoritative game state and sends every
// player a personalised view (so secret roles only ever travel to their owner).
// Other devices are thin clients that send actions to the host.

import * as G from './game.js'
import { connect } from './net.js'

// In ?local test mode every tab is a separate player, so keep identity per-tab.
const backend = () => (new URLSearchParams(location.search).has('local') ? sessionStorage : localStorage)
const store = {
  get(key) { try { return JSON.parse(backend().getItem(key)) } catch { return null } },
  set(key, v) { try { backend().setItem(key, JSON.stringify(v)) } catch {} },
  del(key) { try { backend().removeItem(key) } catch {} },
}

export const randomId = (len = 8) => {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return [...bytes].map(b => abc[b % abc.length]).join('')
}

const meKey = room => `avalon:${room}:me`
const hostKey = room => `avalon:${room}:host`

export function isHostOf(room) {
  return !!store.get(hostKey(room))
}

export function savedName() {
  return store.get('avalon:name') || ''
}

// Called by the creator: sets up a fresh room with themselves as host + first player.
export function createRoom(name) {
  const room = randomId(10)
  const token = randomId(16)
  const id = randomId(6)
  const state = G.createGame()
  G.addPlayer(state, id, name)
  store.set(hostKey(room), { state, tokens: { [token]: id }, hostId: id })
  store.set(meKey(room), { token, name })
  store.set('avalon:name', name)
  return room
}

export function forgetRoom(room) {
  store.del(meKey(room))
  store.del(hostKey(room))
}

export async function openSession(room, onChange) {
  const me = store.get(meKey(room)) || { token: randomId(16), name: '' }
  store.set(meKey(room), me)
  const host = store.get(hostKey(room))
  const net = await connect(room)
  const s = {
    room,
    isHost: !!host,
    view: null,
    status: host ? 'ready' : 'searching',
    error: null,
    kicked: false,
    name: me.name,
    openedAt: Date.now(),
  }
  const emit = () => onChange(s)
  let flashTimer
  const flash = msg => {
    s.error = msg
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => { s.error = null; emit() }, 3500)
    emit()
  }

  if (host) {
    // ---------------- Host ----------------
    const { state, tokens, hostId } = host
    const peers = {} // peerId -> player id
    const save = () => store.set(hostKey(room), { state, tokens, hostId })
    const online = () => [hostId, ...Object.values(peers)]
    const viewOf = id => ({ ...G.viewFor(state, id), online: online(), host: hostId })
    const broadcast = () => {
      save()
      for (const [peerId, id] of Object.entries(peers)) net.send('view', viewOf(id), peerId)
      s.view = viewOf(hostId)
      emit()
    }
    const run = (fn, peerId) => {
      try { fn(); broadcast() } catch (e) {
        if (!(e instanceof G.GameError)) console.error(e)
        if (peerId) net.send('error', e.message, peerId)
        else flash(e.message)
      }
    }

    net.on('hello', ({ token, name } = {}, peerId) => {
      if (typeof token !== 'string') return
      let id = tokens[token]
      if (!id && name && state.phase === 'lobby') {
        id = randomId(6)
        try { G.addPlayer(state, id, name) } catch (e) { net.send('error', e.message, peerId); return }
        tokens[token] = id
      } else if (id && name && state.phase === 'lobby') {
        G.addPlayer(state, id, name) // rename
      }
      // Unknown tokens mid-game become spectators (id stays undefined)
      peers[peerId] = id ?? `spectator:${peerId}`
      broadcast()
    })
    net.on('act', (action, peerId) => {
      const id = peers[peerId]
      if (!id || !action) return
      run(() => G.act(state, id, action), peerId)
    })
    net.onPeerLeave(peerId => { delete peers[peerId]; broadcast() })

    s.act = action => run(() => G.act(state, hostId, action))
    s.rename = name => run(() => { G.addPlayer(state, hostId, name); me.name = G.cleanName(name); store.set(meKey(room), me); store.set('avalon:name', me.name) })
    s.setSetting = (k, v) => run(() => { if (state.phase === 'lobby') state.settings[k] = v })
    s.kick = id => run(() => {
      G.removePlayer(state, id)
      for (const [t, pid] of Object.entries(tokens)) if (pid === id) delete tokens[t]
      for (const [peerId, pid] of Object.entries(peers)) if (pid === id) { net.send('kicked', true, peerId); delete peers[peerId] }
    })
    s.start = () => run(() => G.startGame(state))
    s.toLobby = () => run(() => G.backToLobby(state))
    s.view = viewOf(hostId)
  } else {
    // ---------------- Client ----------------
    let hostPeer = null
    const hello = target => { if (me.name) net.send('hello', { token: me.token, name: me.name }, target) }
    net.on('view', (view, peerId) => {
      hostPeer = peerId
      s.view = view
      s.status = 'ready'
      emit()
    })
    net.on('error', msg => flash(String(msg)))
    net.on('kicked', () => { s.kicked = true; forgetRoom(room); emit() })
    net.onPeerJoin(peerId => hello(peerId))
    net.onPeerLeave(peerId => {
      if (peerId === hostPeer) { hostPeer = null; s.status = 'host-lost'; emit() }
    })
    const toHost = (type, data) => {
      if (!hostPeer) return flash('Not connected to the host yet')
      net.send(type, data, hostPeer)
    }
    s.act = action => toHost('act', action)
    s.rename = name => {
      me.name = G.cleanName(name)
      s.name = me.name
      store.set(meKey(room), me)
      store.set('avalon:name', me.name)
      hello(hostPeer || undefined)
      emit()
    }
    s.setSetting = s.kick = s.start = s.toLobby = () => flash('Only the host can do that')
    hello()
    // Keep saying hello until the host answers (covers slow relay discovery)
    const retry = setInterval(() => { if (!hostPeer) hello() }, 4000)
    s.close = () => { clearInterval(retry); net.leave() }
  }
  s.close ??= () => net.leave()
  s.leave = () => { forgetRoom(room); s.close() }
  s.peerCount = () => net.peerCount()
  s.stats = () => net.stats()
  net.onError(d => {
    s.netError = String(d?.error?.message ?? d?.error ?? 'Connection failed')
    emit()
  })
  emit()
  return s
}
