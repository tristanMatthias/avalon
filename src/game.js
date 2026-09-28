// Pure Avalon rules engine. No DOM, no networking.
// The host holds the full state; everyone else only ever receives viewFor(state, id).

export const MIN_PLAYERS = 5
export const MAX_PLAYERS = 10

// [good, evil] by player count
export const TEAM_SIZES = {
  5: [3, 2],
  6: [4, 2],
  7: [4, 3],
  8: [5, 3],
  9: [6, 3],
  10: [6, 4],
}

// Players sent on each quest, by player count
export const QUEST_SIZES = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
}

export const ROLES = {
  merlin: { name: 'Merlin', team: 'good', blurb: 'You know who is evil (except Mordred). Guide the good without revealing yourself — the Assassin is hunting you.' },
  percival: { name: 'Percival', team: 'good', blurb: 'You know who Merlin is… but Morgana appears to you as Merlin too.' },
  servant: { name: 'Loyal Servant of Arthur', team: 'good', blurb: 'You know nothing but your own loyalty. Find the traitors.' },
  assassin: { name: 'Assassin', team: 'evil', blurb: 'If good completes three quests, you get one chance to name Merlin and steal the win.' },
  morgana: { name: 'Morgana', team: 'evil', blurb: 'You appear as Merlin to Percival. Sow confusion.' },
  mordred: { name: 'Mordred', team: 'evil', blurb: 'Merlin cannot see you. Hide in plain sight.' },
  oberon: { name: 'Oberon', team: 'evil', blurb: 'You are evil, but you do not know the other minions and they do not know you.' },
  minion: { name: 'Minion of Mordred', team: 'evil', blurb: 'Work with your fellow minions to fail three quests.' },
}

export const DEFAULT_SETTINGS = {
  merlin: true, // Merlin + Assassin
  percival: true,
  morgana: true,
  mordred: false,
  oberon: false,
  lady: false,
}

export function isEvil(role) {
  return ROLES[role]?.team === 'evil'
}

export function failsNeeded(playerCount, questIdx) {
  return questIdx === 3 && playerCount >= 7 ? 2 : 1
}

export function createGame() {
  return {
    phase: 'lobby',
    players: [], // {id, name}
    settings: { ...DEFAULT_SETTINGS },
    gameNo: 0,
    log: [],
  }
}

// Validate settings for a given player count. Returns an error string or null.
export function settingsError(settings, n) {
  if (n < MIN_PLAYERS) return `Need at least ${MIN_PLAYERS} players`
  if (n > MAX_PLAYERS) return `At most ${MAX_PLAYERS} players`
  const [good, evil] = TEAM_SIZES[n]
  const specialEvil = (settings.merlin ? 1 : 0) + (settings.morgana ? 1 : 0) + (settings.mordred ? 1 : 0) + (settings.oberon ? 1 : 0)
  const specialGood = (settings.merlin ? 1 : 0) + (settings.percival ? 1 : 0)
  if (specialEvil > evil) return `Too many evil roles for ${n} players (max ${evil})`
  if (specialGood > good) return `Too many good roles for ${n} players`
  if (settings.percival && !settings.merlin) return 'Percival needs Merlin in the game'
  if (settings.morgana && !settings.percival) return 'Morgana needs Percival in the game'
  return null
}

export function buildRoleDeck(settings, n) {
  const [good, evil] = TEAM_SIZES[n]
  const g = []
  const e = []
  if (settings.merlin) { g.push('merlin'); e.push('assassin') }
  if (settings.percival) g.push('percival')
  if (settings.morgana) e.push('morgana')
  if (settings.mordred) e.push('mordred')
  if (settings.oberon) e.push('oberon')
  while (g.length < good) g.push('servant')
  while (e.length < evil) e.push('minion')
  return [...g, ...e]
}

function shuffle(arr, rand) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

class GameError extends Error {}
const fail = msg => { throw new GameError(msg) }

// ---- Lobby actions (host applies these directly) ----

export function addPlayer(state, id, name) {
  const existing = state.players.find(p => p.id === id)
  if (existing) { existing.name = cleanName(name) || existing.name; return state }
  if (state.phase !== 'lobby') fail('Game already in progress')
  if (state.players.length >= MAX_PLAYERS) fail('Game is full')
  state.players.push({ id, name: cleanName(name) || 'Player' })
  return state
}

export function removePlayer(state, id) {
  if (state.phase !== 'lobby') fail('Cannot remove players mid-game')
  state.players = state.players.filter(p => p.id !== id)
  return state
}

export function cleanName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 20)
}

export function startGame(state, rand = Math.random) {
  const n = state.players.length
  const err = settingsError(state.settings, n)
  if (err) fail(err)
  const order = shuffle(state.players.map(p => p.id), rand)
  const deck = shuffle(buildRoleDeck(state.settings, n), rand)
  const roles = Object.fromEntries(order.map((id, i) => [id, deck[i]]))
  const leaderIdx = Math.floor(rand() * n)
  Object.assign(state, {
    phase: 'propose',
    gameNo: state.gameNo + 1,
    order,
    roles,
    leaderIdx,
    questIdx: 0,
    rejects: 0,
    quests: QUEST_SIZES[n].map((size, i) => ({ size, failsNeeded: failsNeeded(n, i), result: null, fails: 0, team: null })),
    team: [],
    votes: {},
    questCards: {},
    lastVote: null,
    lady: state.settings.lady ? { holder: order[(leaderIdx + n - 1) % n], previous: [], checks: [] } : null,
    winner: null,
    winReason: null,
    assassinTarget: null,
    log: [{ t: 'start' }],
  })
  return state
}

export function backToLobby(state) {
  const keep = { players: state.players, settings: state.settings, gameNo: state.gameNo }
  for (const k of Object.keys(state)) delete state[k]
  Object.assign(state, createGame(), keep)
  return state
}

// ---- In-game actions, performed by player `id` ----

export function leaderId(state) {
  return state.order[state.leaderIdx]
}

function advanceLeader(state) {
  state.leaderIdx = (state.leaderIdx + 1) % state.order.length
  state.team = []
  state.votes = {}
  state.phase = 'propose'
}

export function act(state, id, action) {
  if (!state.order?.includes(id)) fail('You are not in this game')
  const { type } = action
  switch (state.phase) {
    case 'propose': {
      if (type !== 'propose') fail('Waiting for a team proposal')
      if (id !== leaderId(state)) fail('Only the leader proposes a team')
      const team = [...new Set(action.team ?? [])]
      const size = state.quests[state.questIdx].size
      if (team.length !== size) fail(`Pick exactly ${size} players`)
      if (!team.every(t => state.order.includes(t))) fail('Unknown player on team')
      state.team = team
      state.votes = {}
      state.phase = 'vote'
      return state
    }
    case 'vote': {
      if (type !== 'vote') fail('Voting on the team')
      state.votes[id] = !!action.approve
      if (Object.keys(state.votes).length === state.order.length) resolveVote(state)
      return state
    }
    case 'quest': {
      if (type !== 'quest') fail('Quest in progress')
      if (!state.team.includes(id)) fail('You are not on this quest')
      if (id in state.questCards) fail('You already played a card')
      const success = !!action.success
      if (!success && !isEvil(state.roles[id])) fail('Loyal servants must succeed')
      state.questCards[id] = success
      if (Object.keys(state.questCards).length === state.team.length) resolveQuest(state)
      return state
    }
    case 'lady': {
      if (type !== 'lady') fail('Lady of the Lake in progress')
      const lady = state.lady
      if (id !== lady.holder) fail('Only the holder of the Lady may use her')
      const target = action.target
      if (!state.order.includes(target) || target === id) fail('Pick another player')
      if (lady.previous.includes(target)) fail('That player has already held the Lady')
      lady.checks.push({ holder: id, target, evil: isEvil(state.roles[target]), quest: state.questIdx })
      lady.previous.push(id)
      lady.holder = target
      state.log.push({ t: 'lady', holder: id, target })
      advanceLeader(state)
      return state
    }
    case 'assassin': {
      if (type !== 'assassinate') fail('The Assassin is choosing')
      if (state.roles[id] !== 'assassin') fail('Only the Assassin may strike')
      const target = action.target
      if (!state.order.includes(target) || target === id) fail('Pick another player')
      state.assassinTarget = target
      const hit = state.roles[target] === 'merlin'
      state.log.push({ t: 'assassinate', target, hit })
      return end(state, hit ? 'evil' : 'good', hit ? 'The Assassin found Merlin' : 'Merlin survived the Assassin')
    }
    default:
      fail('Game is not in progress')
  }
}

function resolveVote(state) {
  const yes = Object.values(state.votes).filter(Boolean).length
  const approved = yes * 2 > state.order.length
  state.lastVote = { leader: leaderId(state), team: state.team, votes: { ...state.votes }, approved, quest: state.questIdx, attempt: state.rejects + 1 }
  state.log.push({ t: 'vote', ...state.lastVote })
  if (approved) {
    state.rejects = 0
    state.questCards = {}
    state.phase = 'quest'
  } else {
    state.rejects += 1
    if (state.rejects >= 5) return end(state, 'evil', 'Five team proposals were rejected in a row')
    advanceLeader(state)
  }
}

function resolveQuest(state) {
  const q = state.quests[state.questIdx]
  const fails = Object.values(state.questCards).filter(v => !v).length
  q.fails = fails
  q.team = state.team
  q.result = fails >= q.failsNeeded ? 'fail' : 'success'
  state.log.push({ t: 'quest', quest: state.questIdx, team: state.team, fails, result: q.result })
  state.questCards = {}
  const failsTotal = state.quests.filter(x => x.result === 'fail').length
  const wins = state.quests.filter(x => x.result === 'success').length
  if (failsTotal >= 3) return end(state, 'evil', 'Three quests failed')
  if (wins >= 3) {
    if (state.settings.merlin) {
      state.phase = 'assassin'
      return
    }
    return end(state, 'good', 'Three quests succeeded')
  }
  state.questIdx += 1
  // Lady of the Lake is used after quests 2, 3 and 4
  if (state.lady && state.questIdx >= 2 && state.questIdx <= 4) {
    state.phase = 'lady'
    state.team = []
    state.votes = {}
    return
  }
  advanceLeader(state)
}

function end(state, winner, reason) {
  state.phase = 'over'
  state.winner = winner
  state.winReason = reason
  state.log.push({ t: 'end', winner, reason })
  return state
}

// ---- What each player is allowed to see ----

// Who `id` can see at night, as [{id, label}]
export function knowledge(state, id) {
  const role = state.roles?.[id]
  if (!role) return []
  const others = state.order.filter(o => o !== id)
  const r = o => state.roles[o]
  switch (role) {
    case 'merlin':
      return others.filter(o => isEvil(r(o)) && r(o) !== 'mordred').map(o => ({ id: o, label: 'Evil' }))
    case 'percival':
      return others.filter(o => r(o) === 'merlin' || r(o) === 'morgana').map(o => ({ id: o, label: 'Merlin or Morgana' }))
    case 'oberon':
      return []
    default:
      if (isEvil(role)) return others.filter(o => isEvil(r(o)) && r(o) !== 'oberon').map(o => ({ id: o, label: 'Evil' }))
      return []
  }
}

export function viewFor(state, id) {
  const base = {
    phase: state.phase,
    players: state.players,
    settings: state.settings,
    gameNo: state.gameNo,
    you: id,
  }
  if (state.phase === 'lobby') return base
  const over = state.phase === 'over'
  const role = state.roles[id] ?? null
  const inGame = state.order.includes(id)
  return {
    ...base,
    order: state.order,
    leader: leaderId(state),
    questIdx: state.questIdx,
    rejects: state.rejects,
    quests: state.quests,
    team: state.team,
    voted: Object.keys(state.votes),
    myVote: id in state.votes ? state.votes[id] : null,
    played: Object.keys(state.questCards),
    myCard: id in state.questCards ? state.questCards[id] : null,
    lastVote: state.lastVote,
    lady: state.lady && {
      holder: state.lady.holder,
      previous: state.lady.previous,
      checks: state.lady.checks.map(c => (c.holder === id || over ? c : { holder: c.holder, target: c.target, quest: c.quest })),
    },
    role,
    side: role ? ROLES[role].team : null,
    knows: inGame ? knowledge(state, id) : [],
    // Evil needs to know who the Assassin is during the assassination
    assassin: state.phase === 'assassin' && (isEvil(role) || over) ? state.order.find(o => state.roles[o] === 'assassin') : null,
    winner: state.winner,
    winReason: state.winReason,
    assassinTarget: state.assassinTarget,
    roles: over ? state.roles : null,
    log: state.log,
  }
}

export { GameError }
