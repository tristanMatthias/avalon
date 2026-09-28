import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../src/game.js'

function seeded(seed = 1) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
}

function newGame(n, settings = {}, seed = 1) {
  const s = G.createGame()
  for (let i = 0; i < n; i++) G.addPlayer(s, `p${i}`, `Player ${i}`)
  Object.assign(s.settings, settings)
  G.startGame(s, seeded(seed))
  return s
}

const byRole = (s, role) => s.order.filter(id => s.roles[id] === role)
const good = s => s.order.filter(id => !G.isEvil(s.roles[id]))
const evil = s => s.order.filter(id => G.isEvil(s.roles[id]))

function voteAll(s, approve) {
  for (const id of s.order) G.act(s, id, { type: 'vote', approve })
}

function runQuest(s, team, failers = []) {
  G.act(s, G.leaderId(s), { type: 'propose', team })
  voteAll(s, true)
  for (const id of team) G.act(s, id, { type: 'quest', success: !failers.includes(id) })
}

test('role decks match player counts', () => {
  for (let n = 5; n <= 10; n++) {
    const deck = G.buildRoleDeck(G.DEFAULT_SETTINGS, n)
    assert.equal(deck.length, n)
    assert.equal(deck.filter(G.isEvil).length, G.TEAM_SIZES[n][1])
  }
})

test('settings validation', () => {
  assert.match(G.settingsError(G.DEFAULT_SETTINGS, 4), /at least 5/)
  assert.equal(G.settingsError(G.DEFAULT_SETTINGS, 5), null)
  assert.match(G.settingsError({ ...G.DEFAULT_SETTINGS, mordred: true }, 5), /Too many evil/)
  assert.equal(G.settingsError({ ...G.DEFAULT_SETTINGS, mordred: true }, 7), null)
  assert.match(G.settingsError({ ...G.DEFAULT_SETTINGS, merlin: false }, 5), /Percival needs Merlin/)
})

test('cannot start with fewer than 5', () => {
  const s = G.createGame()
  for (let i = 0; i < 4; i++) G.addPlayer(s, `p${i}`, 'x')
  assert.throws(() => G.startGame(s), /at least 5/)
})

test('knowledge: merlin, percival, evil, mordred, oberon', () => {
  const s = newGame(10, { mordred: true, oberon: true })
  const merlin = byRole(s, 'merlin')[0]
  const mordred = byRole(s, 'mordred')[0]
  const oberon = byRole(s, 'oberon')[0]
  const assassin = byRole(s, 'assassin')[0]
  const merlinSees = G.knowledge(s, merlin).map(k => k.id).sort()
  assert.deepEqual(merlinSees, evil(s).filter(id => id !== mordred).sort())
  assert.ok(merlinSees.includes(oberon))
  const percSees = G.knowledge(s, byRole(s, 'percival')[0]).map(k => k.id).sort()
  assert.deepEqual(percSees, [merlin, byRole(s, 'morgana')[0]].sort())
  const assassinSees = G.knowledge(s, assassin).map(k => k.id).sort()
  assert.deepEqual(assassinSees, evil(s).filter(id => id !== oberon && id !== assassin).sort())
  assert.deepEqual(G.knowledge(s, oberon), [])
  for (const id of byRole(s, 'servant')) assert.deepEqual(G.knowledge(s, id), [])
})

test('views hide other roles and votes until reveal', () => {
  const s = newGame(5)
  const [a, b] = s.order
  const v = G.viewFor(s, a)
  assert.equal(v.role, s.roles[a])
  assert.equal(v.roles, null)
  assert.ok(!JSON.stringify(v).includes(`"${b}":"${s.roles[b]}"`))
  G.act(s, G.leaderId(s), { type: 'propose', team: s.order.slice(0, 2) })
  G.act(s, a, { type: 'vote', approve: false })
  const vb = G.viewFor(s, b)
  assert.deepEqual(vb.voted, [a])
  assert.equal(vb.myVote, null)
  assert.ok(!('votes' in vb))
})

test('only leader proposes, correct size required', () => {
  const s = newGame(5)
  const other = s.order.find(id => id !== G.leaderId(s))
  assert.throws(() => G.act(s, other, { type: 'propose', team: s.order.slice(0, 2) }), /leader/)
  assert.throws(() => G.act(s, G.leaderId(s), { type: 'propose', team: s.order.slice(0, 3) }), /exactly 2/)
})

test('tied vote rejects, leader advances, 5 rejects = evil wins', () => {
  const s = newGame(6)
  const first = s.leaderIdx
  for (let i = 0; i < 5; i++) {
    G.act(s, G.leaderId(s), { type: 'propose', team: s.order.slice(0, 2) })
    s.order.forEach((id, j) => G.act(s, id, { type: 'vote', approve: j < 3 })) // 3/6 = tie
    if (i < 4) {
      assert.equal(s.phase, 'propose')
      assert.equal(s.rejects, i + 1)
      assert.equal(s.leaderIdx, (first + i + 1) % 6)
    }
  }
  assert.equal(s.phase, 'over')
  assert.equal(s.winner, 'evil')
})

test('good cannot fail quests', () => {
  const s = newGame(5)
  const g = good(s)[0]
  G.act(s, G.leaderId(s), { type: 'propose', team: [g, good(s)[1]] })
  voteAll(s, true)
  assert.throws(() => G.act(s, g, { type: 'quest', success: false }), /must succeed/)
})

test('three fails = evil wins', () => {
  const s = newGame(5)
  const e = evil(s)[0]
  const g = good(s)
  for (let q = 0; q < 3; q++) {
    const team = [e, ...g].slice(0, s.quests[s.questIdx].size)
    runQuest(s, team, [e])
  }
  assert.equal(s.winner, 'evil')
  assert.equal(s.winReason, 'Three quests failed')
})

test('quest 4 needs two fails with 7+ players', () => {
  const s = newGame(7)
  const [e1] = evil(s)
  const g = good(s)
  runQuest(s, g.slice(0, 2)) // success
  runQuest(s, [e1, ...g].slice(0, 3), [e1]) // fail
  runQuest(s, g.slice(0, 3)) // success
  runQuest(s, [e1, ...g].slice(0, 4), [e1]) // only 1 fail on quest 4 -> success
  assert.equal(s.quests[3].result, 'success')
  assert.equal(s.quests[3].fails, 1)
  assert.equal(s.phase, 'assassin')
})

test('assassination: hit and miss', () => {
  for (const hit of [true, false]) {
    const s = newGame(5)
    const g = good(s)
    for (let q = 0; q < 3; q++) runQuest(s, g.slice(0, s.quests[s.questIdx].size))
    assert.equal(s.phase, 'assassin')
    const assassin = byRole(s, 'assassin')[0]
    const merlin = byRole(s, 'merlin')[0]
    const target = hit ? merlin : g.find(id => id !== merlin)
    assert.throws(() => G.act(s, merlin, { type: 'assassinate', target }), /Only the Assassin/)
    G.act(s, assassin, { type: 'assassinate', target })
    assert.equal(s.winner, hit ? 'evil' : 'good')
    assert.ok(G.viewFor(s, g[0]).roles)
  }
})

test('no merlin: three successes win outright', () => {
  const s = newGame(5, { merlin: false, percival: false, morgana: false })
  const g = good(s)
  for (let q = 0; q < 3; q++) runQuest(s, g.slice(0, s.quests[s.questIdx].size))
  assert.equal(s.winner, 'good')
})

test('lady of the lake after quests 2-4', () => {
  const s = newGame(7, { lady: true })
  const g = good(s)
  const firstHolder = s.lady.holder
  assert.equal(firstHolder, s.order[(s.leaderIdx + 6) % 7])
  runQuest(s, g.slice(0, 2))
  assert.equal(s.phase, 'propose')
  const e = evil(s)[0]
  runQuest(s, [e, ...g].slice(0, 3), [e])
  assert.equal(s.phase, 'lady')
  const target = s.order.find(id => id !== firstHolder)
  const other = s.order.find(id => id !== firstHolder && id !== target)
  assert.throws(() => G.act(s, other, { type: 'lady', target }), /holder/)
  G.act(s, firstHolder, { type: 'lady', target })
  assert.equal(s.lady.holder, target)
  assert.equal(s.phase, 'propose')
  // Result only visible to the one who checked
  assert.equal(G.viewFor(s, firstHolder).lady.checks[0].evil, G.isEvil(s.roles[target]))
  assert.equal(G.viewFor(s, other).lady.checks[0].evil, undefined)
  // Cannot check someone who previously held the lady
  runQuest(s, g.slice(0, 3))
  assert.equal(s.phase, 'lady')
  assert.throws(() => G.act(s, target, { type: 'lady', target: firstHolder }), /already held/)
})

test('back to lobby keeps players', () => {
  const s = newGame(5)
  G.backToLobby(s)
  assert.equal(s.phase, 'lobby')
  assert.equal(s.players.length, 5)
  assert.equal(s.order, undefined)
})
