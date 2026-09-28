import './style.css'
import qrcode from 'qrcode-generator'
import morphdom from 'morphdom'
import { ROLES, TEAM_SIZES, MIN_PLAYERS, MAX_PLAYERS, settingsError } from './game.js'
import * as S from './session.js'
import { icon, crest } from './icons.js'

const app = document.getElementById('app')
let session = null
const ui = {
  pick: [],
  pickKey: '',
  reveal: false,
  seen: null, // log length already announced
  announce: null,
  showLog: false,
  copied: false,
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const roomFromHash = () => {
  const r = location.hash.replace(/^#\/?/, '')
  return /^[a-z0-9]{6,20}$/.test(r) ? r : null
}
const shareUrl = room => `${location.origin}${location.pathname}${location.search}#${room}`

// ---------------------------------------------------------------- boot

async function boot() {
  session?.close?.()
  session = null
  Object.assign(ui, { pick: [], pickKey: '', reveal: false, seen: null, announce: null })
  const room = roomFromHash()
  if (!room) return render()
  render()
  const token = (boot.token = {})
  const s = await S.openSession(room, s => { if (boot.token === token) { session = s; render() } })
  if (boot.token !== token) return s.close()
  session = s
  render()
}

// ---------------------------------------------------------------- rendering

function render() {
  // Diff into the DOM so animations don't restart and typed input survives updates
  const next = document.createElement('div')
  next.id = 'app'
  next.innerHTML = screen()
  morphdom(app, next, {
    onBeforeElUpdated(from, to) {
      if (from.tagName === 'INPUT' && from.dataset.keep !== undefined) return false
      if (from.isEqualNode(to)) return false
      return true
    },
  })
}

function screen() {
  if (!roomFromHash()) return homeScreen()
  if (!session) return shell(`<div class="center-msg"><div class="spinner"></div><p>Lighting the torches…</p></div>`)
  if (session.kicked) return shell(`<div class="scroll center"><h2>You have been dismissed</h2><p>The host removed you from this table.</p><button class="btn" data-a="home">Return to Camelot</button></div>`)
  const v = session.view
  if (!session.isHost && !session.name) return joinScreen()
  if (!v) return shell(`<div class="center-msg"><div class="spinner"></div><h2>Seeking the host…</h2><p>Connecting peer-to-peer. Make sure the person who created the game still has it open, with their screen on.</p>${netStatus()}<button class="btn ghost small" data-a="leave">Leave</button></div>`)
  syncUi(v)
  return v.phase === 'lobby' ? lobbyScreen(v) : gameScreen(v)
}

const shell = (inner, cls = '') => `<main class="shell ${cls}">${inner}${toast()}</main>`

// Connection diagnostics, so "stuck" has an explanation
function netStatus() {
  const st = session?.stats?.()
  if (!st) return ''
  const secs = Math.round((Date.now() - (session.openedAt ?? Date.now())) / 1000)
  let msg
  if (st.relaysOpen === 0) {
    msg = secs < 8
      ? 'Contacting signalling servers…'
      : 'Can’t reach any signalling servers. Check your internet connection, or try mobile data instead of this Wi-Fi (some networks block them).'
  } else if (st.peers === 0) {
    msg = `Connected to ${st.relaysOpen}/${st.relaysTotal} signalling servers. Waiting for the host’s phone to answer…`
  } else {
    msg = `Found ${st.peers} player${st.peers === 1 ? '' : 's'}, waiting for the host…`
  }
  const err = session.netError ? `<p class="net-err">Found another player but couldn’t open a direct connection. Try putting everyone on the same Wi-Fi.</p>` : ''
  return `<p class="net-status">${msg}</p>${err}`
}

function toast() {
  const bits = []
  if (session?.error) bits.push(`<div class="toast">${esc(session.error)}</div>`)
  if (session?.status === 'host-lost') bits.push(`<div class="toast warn">The host has left the table. Waiting for them to return…</div>`)
  return bits.join('')
}

function banner() {
  return `<header class="banner">
    <div class="banner-title" data-a="menu">${crest('small')}<span>Avalon</span></div>
    ${roomFromHash() ? `<button class="icon-btn" data-a="leave" aria-label="Leave game">${icon('door')}</button>` : ''}
  </header>`
}

// ---------------------------------------------------------------- home / join

function homeScreen() {
  return shell(`
    <div class="hero">
      ${crest('big')}
      <h1>Avalon</h1>
      <p class="tagline">The Resistance · Arthurian intrigue for 5–10 knights</p>
    </div>
    <div class="scroll">
      <h2>Summon a Round Table</h2>
      <label class="field">Your name
        <input id="name" data-keep maxlength="20" autocomplete="nickname" placeholder="Sir Lancelot" value="${esc(S.savedName())}" enterkeyhint="go">
      </label>
      <button class="btn big" data-a="create">Create game</button>
      <p class="fine">You’ll get a link to share. Everyone joins on their phone — games run peer-to-peer between your devices, no accounts or server needed.</p>
    </div>
    <details class="scroll rules">
      <summary>How to play</summary>
      ${rulesHtml()}
    </details>`, 'home')
}

function hostSignal() {
  const st = session?.stats?.()
  if (!st || new URLSearchParams(location.search).has('local')) return ''
  const ok = st.relaysOpen > 0
  return `<p class="signal ${ok ? 'ok' : 'bad'}"><span class="dot"></span>${ok ? `Open for players · ${st.relaysOpen}/${st.relaysTotal} signalling servers` : 'Connecting to signalling servers…'}</p>`
}

function joinScreen() {
  return shell(`
    ${banner()}
    <div class="hero small">
      ${crest('big')}
      <h1>A summons!</h1>
      <p class="tagline">You have been called to the Round Table</p>
    </div>
    <div class="scroll">
      <label class="field">Your name
        <input id="name" data-keep maxlength="20" autocomplete="nickname" placeholder="Sir Gawain" value="${esc(S.savedName())}" enterkeyhint="go">
      </label>
      <button class="btn big" data-a="join">Take your seat</button>
    </div>`)
}

// ---------------------------------------------------------------- lobby

const SETTINGS = [
  ['merlin', 'Merlin & Assassin', 'Merlin sees evil; if good wins, the Assassin may kill Merlin to steal victory.'],
  ['percival', 'Percival', 'Good. Sees Merlin (and Morgana).'],
  ['morgana', 'Morgana', 'Evil. Appears as Merlin to Percival.'],
  ['mordred', 'Mordred', 'Evil. Hidden from Merlin.'],
  ['oberon', 'Oberon', 'Evil, but unknown to (and unaware of) the other minions.'],
  ['lady', 'Lady of the Lake', 'After quests 2, 3 and 4, the holder secretly checks a player’s loyalty.'],
]

function lobbyScreen(v) {
  const room = roomFromHash()
  const url = shareUrl(room)
  const n = v.players.length
  const err = settingsError(v.settings, n)
  const host = session.isHost
  const online = new Set(v.online)
  const qr = qrcode(0, 'M')
  qr.addData(url)
  qr.make()
  const comp = TEAM_SIZES[n] ? `<span class="good-t">${TEAM_SIZES[n][0]} loyal</span> · <span class="evil-t">${TEAM_SIZES[n][1]} evil</span>` : `${MIN_PLAYERS}–${MAX_PLAYERS} players`

  return shell(`
    ${banner()}
    <section class="scroll">
      <h2>Gather your knights</h2>
      <p class="fine">Share this link or let friends scan the code.</p>
      ${hostSignal()}
      <div class="qr">${qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })}</div>
      <div class="link-row">
        <input readonly value="${esc(url)}" aria-label="Game link">
      </div>
      <div class="row">
        <button class="btn" data-a="copy">${ui.copied ? 'Copied!' : 'Copy link'}</button>
        ${navigator.share ? `<button class="btn ghost" data-a="share">Share…</button>` : ''}
      </div>
    </section>

    <section class="scroll">
      <div class="h-row"><h2>At the table</h2><span class="count">${n}/${MAX_PLAYERS}</span></div>
      <ul class="roster">
        ${v.players.map(p => `<li class="${online.has(p.id) ? '' : 'offline'}">
          <span class="avatar">${esc(p.name[0]?.toUpperCase())}</span>
          <span class="pname">${esc(p.name)}${p.id === v.you ? ' <em>(you)</em>' : ''}${p.id === v.host ? ` <span class="tag">host</span>` : ''}</span>
          ${host && p.id !== v.you ? `<button class="icon-btn small" data-a="kick" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">${icon('x')}</button>` : ''}
        </li>`).join('')}
      </ul>
      <div class="rename">
        <input id="rename" data-keep maxlength="20" placeholder="Change your name" value="">
        <button class="btn ghost small" data-a="rename">Rename</button>
      </div>
    </section>

    <section class="scroll">
      <div class="h-row"><h2>Characters</h2><span class="count">${comp}</span></div>
      <ul class="settings">
        ${SETTINGS.map(([k, label, desc]) => `<li>
          <label class="toggle ${host ? '' : 'readonly'}">
            <input type="checkbox" data-a="setting" data-k="${k}" ${v.settings[k] ? 'checked' : ''} ${host ? '' : 'disabled'}>
            <span class="switch"></span>
            <span><strong>${label}</strong><small>${desc}</small></span>
          </label>
        </li>`).join('')}
      </ul>
    </section>

    <div class="action-bar">
      ${host
        ? `<button class="btn big" data-a="start" ${err ? 'disabled' : ''}>${err ? esc(err) : 'Begin the quest'}</button>`
        : `<p class="waiting">${icon('hourglass')} Waiting for the host to begin… ${err ? `<small>${esc(err)}</small>` : ''}</p>`}
    </div>`, 'with-bar')
}

// ---------------------------------------------------------------- game

const nameOf = (v, id) => v.players.find(p => p.id === id)?.name ?? '???'

function phaseKey(v) {
  return [v.gameNo, v.phase, v.questIdx, v.leader, v.rejects].join(':')
}

// What the current player can select on the table, if anything
function pickMode(v) {
  const me = v.you
  if (v.phase === 'propose' && v.leader === me) {
    return { max: v.quests[v.questIdx].size, can: () => true, label: n => `Propose this team (${n}/${v.quests[v.questIdx].size})`, send: pick => ({ type: 'propose', team: pick }) }
  }
  if (v.phase === 'lady' && v.lady?.holder === me) {
    return { max: 1, can: id => id !== me && !v.lady.previous.includes(id), label: () => 'Examine loyalty', send: pick => ({ type: 'lady', target: pick[0] }) }
  }
  if (v.phase === 'assassin' && v.role === 'assassin') {
    return { max: 1, can: id => id !== me, label: () => 'Strike!', send: pick => ({ type: 'assassinate', target: pick[0] }) }
  }
  return null
}

function syncUi(v) {
  const key = phaseKey(v)
  if (key !== ui.pickKey) { ui.pick = []; ui.pickKey = key }
  const log = v.log ?? []
  if (ui.seen === null || ui.seen > log.length) ui.seen = log.length
  if (log.length > ui.seen) {
    const fresh = log.slice(ui.seen).filter(e => ['vote', 'quest', 'lady', 'end', 'start'].includes(e.t))
    ui.seen = log.length
    if (fresh.length) {
      const e = fresh[fresh.length - 1]
      ui.announce = e
      if (e.t === 'quest') ui.cards = e.team.map((_, i) => (i < e.fails ? 'fail' : 'success')).sort(() => Math.random() - 0.5)
    }
    if (fresh.some(e => e.t === 'start')) ui.reveal = false
  }
}

function gameScreen(v) {
  const pm = pickMode(v)
  return shell(`
    ${banner()}
    ${v.role ? roleCard(v) : `<div class="scroll center small-pad"><p>You are watching this game as a spectator.</p></div>`}
    ${statusScroll(v)}
    ${table(v, pm)}
    ${history(v)}
    ${actionBar(v, pm)}
    ${ui.announce ? announcement(v, ui.announce) : ''}
  `, 'with-bar game')
}

function roleCard(v) {
  const role = ROLES[v.role]
  if (!ui.reveal) {
    return `<button class="sealed" data-a="reveal">
      <span class="seal">${icon('seal')}</span>
      <span><strong>Your secret orders</strong><small>Tap to break the seal — shield your screen!</small></span>
    </button>`
  }
  const knows = v.knows.length
    ? `<ul class="knows">${v.knows.map(k => `<li><span class="avatar ${k.label === 'Evil' ? 'evil' : 'merlinish'}">${esc(nameOf(v, k.id)[0]?.toUpperCase())}</span>${esc(nameOf(v, k.id))} <em>${esc(k.label)}</em></li>`).join('')}</ul>`
    : ''
  const lady = (v.lady?.checks ?? []).filter(c => c.holder === v.you && c.evil !== undefined)
  return `<section class="role-card ${v.side}" data-a="hide">
    <div class="role-head">
      ${crest(v.side)}
      <div>
        <small>${v.side === 'good' ? 'Loyal Servant of Arthur' : 'Minion of Mordred'}</small>
        <h2>${role.name}</h2>
      </div>
    </div>
    <p>${role.blurb}</p>
    ${knows ? `<h3>${v.role === 'percival' ? 'One of these is Merlin' : v.role === 'merlin' ? 'You see these servants of evil' : 'Your fellow minions'}</h3>${knows}` : ''}
    ${lady.map(c => `<p class="lady-note">${icon('lady')} The Lady revealed <strong>${esc(nameOf(v, c.target))}</strong> is <strong class="${c.evil ? 'evil-t' : 'good-t'}">${c.evil ? 'Evil' : 'Good'}</strong>.</p>`).join('')}
    <small class="tap-hide">Tap to hide</small>
  </section>`
}

function statusScroll(v) {
  const leader = esc(nameOf(v, v.leader))
  const q = v.quests[v.questIdx]
  const needs = q && q.failsNeeded > 1 ? ' <em>(needs two fails)</em>' : ''
  let title = ''
  let text = ''
  switch (v.phase) {
    case 'propose':
      title = `Quest ${v.questIdx + 1} · Proposal ${v.rejects + 1} of 5`
      text = v.leader === v.you
        ? `You lead. Choose <strong>${q.size}</strong> knights for this quest — tap seats at the table.`
        : `<strong>${leader}</strong> is choosing ${q.size} knights for the quest.`
      break
    case 'vote':
      title = `Vote on ${leader}’s team`
      text = `${v.team.map(id => `<strong>${esc(nameOf(v, id))}</strong>`).join(', ')}.<br>${v.voted.length}/${v.order.length} have voted.${v.rejects === 4 ? ' <em class="evil-t">Last chance — a fifth rejection hands victory to evil!</em>' : ''}`
      break
    case 'quest':
      title = `Quest ${v.questIdx + 1} is underway`
      text = `${v.team.map(id => `<strong>${esc(nameOf(v, id))}</strong>`).join(', ')} ride out.${needs}<br>${v.played.length}/${v.team.length} cards played.`
      break
    case 'lady':
      title = 'The Lady of the Lake'
      text = v.lady.holder === v.you
        ? 'Choose a player whose loyalty you wish to learn. Only you will see the answer.'
        : `<strong>${esc(nameOf(v, v.lady.holder))}</strong> consults the Lady of the Lake…`
      break
    case 'assassin':
      title = 'The Assassin strikes'
      text = v.role === 'assassin'
        ? 'Good has won three quests. Discuss with your fellow minions, then name Merlin.'
        : v.assassin
          ? `Good won three quests. Help <strong>${esc(nameOf(v, v.assassin))}</strong> (the Assassin) find Merlin!`
          : 'Good has won three quests… but the Assassin may yet find Merlin.'
      break
    case 'over':
      title = v.winner === 'good' ? 'Camelot prevails!' : 'Mordred triumphs!'
      text = esc(v.winReason)
      break
  }
  return `<section class="status ${v.phase === 'over' ? v.winner : ''}"><h2>${title}</h2><p>${text}</p></section>`
}

function table(v, pm) {
  const n = v.order.length
  const meIdx = Math.max(0, v.order.indexOf(v.you))
  const online = new Set(v.online)
  const over = v.phase === 'over'
  const seats = v.order.map((id, i) => {
    // Put "you" at the bottom of the table and go clockwise
    const a = ((i - meIdx) / n) * Math.PI * 2 + Math.PI / 2
    const x = 50 + Math.cos(a) * 41
    const y = 50 + Math.sin(a) * 41
    const picked = ui.pick.includes(id)
    const onTeam = ['vote', 'quest'].includes(v.phase) && v.team.includes(id)
    const done = (v.phase === 'vote' && v.voted.includes(id)) || (v.phase === 'quest' && v.played.includes(id))
    const known = ui.reveal && v.knows.find(k => k.id === id)
    const pickable = pm?.can(id)
    const role = over && v.roles ? v.roles[id] : null
    const cls = [
      'seat',
      picked && 'picked',
      onTeam && 'on-team',
      id === v.you && 'me',
      !online.has(id) && 'offline',
      pickable && 'pickable',
      pm && !pickable && 'unpickable',
      role && ROLES[role].team,
      known && (known.label === 'Evil' ? 'known-evil' : 'known-merlin'),
      over && v.assassinTarget === id && 'slain',
    ].filter(Boolean).join(' ')
    return `<button class="${cls}" style="left:${x}%;top:${y}%" data-a="seat" data-id="${id}" ${pickable ? '' : 'tabindex="-1"'}>
      <span class="avatar">${esc(nameOf(v, id)[0]?.toUpperCase())}
        ${v.leader === id && !over ? `<span class="badge crown">${icon('crown')}</span>` : ''}
        ${v.lady?.holder === id && !over ? `<span class="badge lady">${icon('lady')}</span>` : ''}
        ${done ? `<span class="badge done">${icon('check')}</span>` : ''}
        ${onTeam || picked ? `<span class="badge sword">${icon('sword')}</span>` : ''}
      </span>
      <span class="seat-name">${esc(nameOf(v, id))}</span>
      ${role ? `<span class="seat-role">${ROLES[role].name.replace(/ of .*/, '')}</span>` : ''}
    </button>`
  })
  const quests = v.quests.map((q, i) => `<div class="quest ${q.result ?? ''} ${i === v.questIdx && !q.result && !over ? 'current' : ''}">
      <span>${q.result ? icon(q.result === 'success' ? 'chalice' : 'skull') : q.size}</span>
      ${q.failsNeeded > 1 ? '<small>2✕</small>' : ''}
    </div>`).join('')
  const track = [1, 2, 3, 4, 5].map(i => `<span class="vt ${i <= v.rejects ? 'on' : ''} ${i === 5 ? 'last' : ''}"></span>`).join('')
  return `<section class="table-wrap">
    <div class="round-table">
      <div class="table-top">
        <div class="quests">${quests}</div>
        <div class="vote-track"><small>Rejected</small>${track}</div>
      </div>
      ${seats.join('')}
    </div>
  </section>`
}

function history(v) {
  const entries = v.log.filter(e => ['vote', 'quest', 'lady', 'assassinate'].includes(e.t))
  if (!entries.length) return ''
  const rows = entries.slice().reverse().map(e => {
    if (e.t === 'vote') {
      const yes = Object.entries(e.votes).filter(([, x]) => x).map(([id]) => id)
      const no = Object.entries(e.votes).filter(([, x]) => !x).map(([id]) => id)
      return `<li><div class="log-h"><span class="pill ${e.approved ? 'good' : 'evil'}">${e.approved ? 'Approved' : 'Rejected'}</span> Q${e.quest + 1}.${e.attempt} · ${esc(nameOf(v, e.leader))} proposed</div>
        <div class="log-team">${e.team.map(id => esc(nameOf(v, id))).join(', ')}</div>
        <div class="log-votes"><span class="good-t">✓ ${yes.map(id => esc(nameOf(v, id))).join(', ') || '—'}</span><span class="evil-t">✗ ${no.map(id => esc(nameOf(v, id))).join(', ') || '—'}</span></div></li>`
    }
    if (e.t === 'quest') {
      return `<li><div class="log-h"><span class="pill ${e.result === 'success' ? 'good' : 'evil'}">Quest ${e.quest + 1} ${e.result === 'success' ? 'succeeded' : 'failed'}</span> ${e.fails} fail${e.fails === 1 ? '' : 's'}</div>
        <div class="log-team">${e.team.map(id => esc(nameOf(v, id))).join(', ')}</div></li>`
    }
    if (e.t === 'lady') return `<li><div class="log-h">${icon('lady')} ${esc(nameOf(v, e.holder))} examined ${esc(nameOf(v, e.target))}</div></li>`
    if (e.t === 'assassinate') return `<li><div class="log-h">${icon('dagger')} The Assassin struck ${esc(nameOf(v, e.target))} — ${e.hit ? 'it was Merlin!' : 'not Merlin.'}</div></li>`
    return ''
  }).join('')
  return `<details class="scroll history" ${ui.showLog ? 'open' : ''}>
    <summary data-a="log">Chronicle of the quest <small>(${entries.length})</small></summary>
    <ul>${rows}</ul>
  </details>`
}

function actionBar(v, pm) {
  const me = v.you
  let inner = ''
  if (pm) {
    const ready = ui.pick.length === pm.max
    inner = `<button class="btn big ${v.phase === 'assassin' ? 'evil' : ''}" data-a="confirm-pick" ${ready ? '' : 'disabled'}>${esc(pm.label(ui.pick.length))}</button>`
  } else if (v.phase === 'vote' && v.order.includes(me)) {
    inner = `<div class="row two">
      <button class="btn big approve ${v.myVote === true ? 'chosen' : ''}" data-a="vote" data-v="1">${icon('check')} Approve</button>
      <button class="btn big reject ${v.myVote === false ? 'chosen' : ''}" data-a="vote" data-v="0">${icon('x')} Reject</button>
    </div>${v.myVote !== null ? '<small class="hint">You may change your vote until everyone has voted.</small>' : ''}`
  } else if (v.phase === 'quest' && v.team.includes(me) && v.myCard === null) {
    const good = v.side === 'good'
    inner = `<div class="row two">
      <button class="btn big success" data-a="quest" data-v="1">${icon('chalice')} Success</button>
      <button class="btn big fail" data-a="quest" data-v="0" ${good ? 'disabled' : ''}>${icon('skull')} Fail</button>
    </div>${good ? '<small class="hint">Loyal servants of Arthur must always succeed.</small>' : '<small class="hint">Your choice is secret — only the count of fails is revealed.</small>'}`
  } else if (v.phase === 'quest' && v.team.includes(me)) {
    inner = `<p class="waiting">${icon('check')} Your card is played. Awaiting the others…</p>`
  } else if (v.phase === 'over') {
    inner = session.isHost
      ? `<button class="btn big" data-a="lobby">Play again</button>`
      : `<p class="waiting">Waiting for the host to start another game…</p>`
  } else {
    inner = `<p class="waiting">${icon('hourglass')} Discuss, accuse, deceive…</p>`
  }
  return `<div class="action-bar">${inner}</div>`
}

function announcement(v, e) {
  let body = ''
  if (e.t === 'start') {
    body = `${crest('big')}<h2>The game begins</h2><p>Roles have been dealt in secret. Shield your screen and break your seal to learn who you are.</p>`
  } else if (e.t === 'vote') {
    body = `<h2 class="${e.approved ? 'good-t' : 'evil-t'}">Team ${e.approved ? 'approved' : 'rejected'}</h2>
      <ul class="vote-reveal">${v.order.map(id => `<li class="${e.votes[id] ? 'yes' : 'no'}"><span>${esc(nameOf(v, id))}</span>${icon(e.votes[id] ? 'check' : 'x')}</li>`).join('')}</ul>
      <p>${e.approved ? 'The team rides out on the quest.' : `The leadership passes on. Rejections: ${v.rejects}/5.`}</p>`
  } else if (e.t === 'quest') {
    const cards = ui.cards ?? []
    body = `<h2 class="${e.result === 'success' ? 'good-t' : 'evil-t'}">Quest ${e.quest + 1} ${e.result === 'success' ? 'succeeded' : 'failed'}</h2>
      <div class="cards">${cards.map((c, i) => `<span class="card ${c}" style="animation-delay:${i * 0.35}s">${icon(c === 'fail' ? 'skull' : 'chalice')}</span>`).join('')}</div>
      <p>${e.fails} fail card${e.fails === 1 ? '' : 's'} played.</p>`
  } else if (e.t === 'lady') {
    const mine = v.lady?.checks.find(c => c.holder === v.you && c.target === e.target && c.evil !== undefined)
    body = `<div class="big-icon">${icon('lady')}</div><h2>The Lady of the Lake</h2>
      ${mine
        ? `<p><strong>${esc(nameOf(v, e.target))}</strong> is <strong class="${mine.evil ? 'evil-t' : 'good-t'}">${mine.evil ? 'a servant of Mordred' : 'loyal to Arthur'}</strong>.</p><p class="fine">Only you know this. You may tell the truth… or lie.</p>`
        : `<p>${esc(nameOf(v, e.holder))} has learned the loyalty of ${esc(nameOf(v, e.target))}, who now holds the Lady.</p>`}`
  } else if (e.t === 'end') {
    body = `${crest(e.winner)}<h2 class="${e.winner}-t">${e.winner === 'good' ? 'Good triumphs!' : 'Evil triumphs!'}</h2><p>${esc(e.reason)}</p><p class="fine">All roles are now revealed at the table.</p>`
  }
  return `<div class="overlay" data-a="dismiss"><div class="scroll modal">${body}<button class="btn" data-a="dismiss">Continue</button></div></div>`
}

function rulesHtml() {
  return `<ol>
    <li>Everyone is secretly dealt a role: a <span class="good-t">Loyal Servant of Arthur</span> or a <span class="evil-t">Minion of Mordred</span>. Evil players know each other.</li>
    <li>Each round a leader proposes a team for the quest. Everyone votes openly to approve or reject it. Five rejections in a row and evil wins.</li>
    <li>Approved team members secretly play Success or Fail. Good must succeed; evil may fail. A single fail sinks the quest (quest 4 needs two with 7+ players).</li>
    <li>Three failed quests: evil wins. Three successful quests: good wins — unless the Assassin then names Merlin.</li>
  </ol>`
}

// ---------------------------------------------------------------- events

app.addEventListener('click', async e => {
  const el = e.target.closest('[data-a]')
  if (!el) return
  const a = el.dataset.a
  const v = session?.view
  switch (a) {
    case 'create': {
      const name = document.getElementById('name').value.trim()
      if (!name) return document.getElementById('name').focus()
      location.hash = S.createRoom(name)
      return
    }
    case 'join': {
      const name = document.getElementById('name').value.trim()
      if (!name) return document.getElementById('name').focus()
      session.rename(name)
      return
    }
    case 'rename': {
      const input = document.getElementById('rename')
      if (input.value.trim()) { session.rename(input.value); input.value = '' }
      return
    }
    case 'copy': {
      try { await navigator.clipboard.writeText(shareUrl(roomFromHash())) } catch {
        const i = app.querySelector('.link-row input'); i.select(); document.execCommand('copy')
      }
      ui.copied = true; render(); setTimeout(() => { ui.copied = false; render() }, 2000)
      return
    }
    case 'share':
      navigator.share?.({ title: 'Join my Avalon game', text: 'Take your seat at the Round Table:', url: shareUrl(roomFromHash()) }).catch(() => {})
      return
    case 'setting':
      session.setSetting(el.dataset.k, el.checked)
      return
    case 'kick':
      if (confirm(`Remove ${nameOf(v, el.dataset.id)} from the game?`)) session.kick(el.dataset.id)
      return
    case 'start': return session.start()
    case 'lobby': return session.toLobby()
    case 'leave':
      if (confirm(session?.isHost ? 'Leave this game? As host, the game ends for everyone.' : 'Leave this game?')) {
        session?.leave()
        session = null
        location.hash = ''
      }
      return
    case 'home': location.hash = ''; return
    case 'reveal': ui.reveal = true; render(); return
    case 'hide': ui.reveal = false; render(); return
    case 'log': e.preventDefault(); ui.showLog = !ui.showLog; render(); return
    case 'dismiss':
      if (el.classList.contains('overlay') && e.target !== el) return
      ui.announce = null; render(); return
    case 'seat': {
      const pm = v && pickMode(v)
      const id = el.dataset.id
      if (!pm || !pm.can(id)) return
      if (ui.pick.includes(id)) ui.pick = ui.pick.filter(x => x !== id)
      else if (pm.max === 1) ui.pick = [id]
      else if (ui.pick.length < pm.max) ui.pick = [...ui.pick, id]
      navigator.vibrate?.(10)
      render()
      return
    }
    case 'confirm-pick': {
      const pm = pickMode(v)
      if (!pm || ui.pick.length !== pm.max) return
      if (v.phase === 'assassin' && !confirm(`Strike down ${nameOf(v, ui.pick[0])}? This cannot be undone.`)) return
      session.act(pm.send(ui.pick))
      return
    }
    case 'vote': session.act({ type: 'vote', approve: el.dataset.v === '1' }); navigator.vibrate?.(15); return
    case 'quest':
      if (el.dataset.v === '0' && !confirm('Play a FAIL card?')) return
      session.act({ type: 'quest', success: el.dataset.v === '1' })
      navigator.vibrate?.(15)
      return
  }
})

app.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return
  const id = e.target.id
  if (id === 'name') app.querySelector('[data-a="create"],[data-a="join"]')?.click()
  if (id === 'rename') app.querySelector('[data-a="rename"]')?.click()
})

// Handy for debugging from the console
window.avalon = { get session() { return session } }

addEventListener('hashchange', boot)
boot()

// Refresh connection diagnostics while nobody's playing yet
setInterval(() => {
  const v = session?.view
  if (session && (!v || v.phase === 'lobby' || session.status === 'host-lost')) render()
}, 2000)

// Keep phones awake while in a game — a sleeping host drops everyone's connection
let wakeLock = null
async function keepAwake() {
  if (!roomFromHash() || document.visibilityState !== 'visible' || wakeLock) return
  try {
    wakeLock = await navigator.wakeLock?.request('screen')
    wakeLock?.addEventListener('release', () => { wakeLock = null })
  } catch {}
}
document.addEventListener('visibilitychange', keepAwake)
addEventListener('hashchange', keepAwake)
app.addEventListener('click', keepAwake)
keepAwake()
