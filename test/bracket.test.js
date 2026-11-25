'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createTournament, applyAction, standings, seedOrder, timerRemaining } = require('../lib/bracket');

const names = (n) => Array.from({ length: n }, (_, i) => 'T' + (i + 1));
const nameOf = (t, id) => t.teams.find((x) => x.id === id).name;

test('seed order', () => {
  assert.deepStrictEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test('single elim with byes auto-advances top seeds', () => {
  const t = createTournament({ name: 'x', format: 'single_elim', teamNames: names(6), durationSec: 600 });
  assert.strictEqual(t.matches.length, 7);
  const byes = t.matches.filter((m) => m.status === 'bye');
  assert.strictEqual(byes.length, 2);
  const r2 = t.matches.filter((m) => m.round === 2);
  const placed = r2.flatMap((m) => [m.teamA, m.teamB]).filter(Boolean).map((id) => nameOf(t, id)).sort();
  assert.deepStrictEqual(placed, ['T1', 'T2']);
});

test('playing through to a champion, reopen rules', () => {
  const t = createTournament({ name: 'x', format: 'single_elim', teamNames: names(4), durationSec: 60 });
  const [m1, m2] = t.matches.filter((m) => m.round === 1);
  const final = t.matches.find((m) => m.round === 2);
  applyAction(t, 'score', { matchId: m1.id, team: 'A', delta: 3 });
  assert.strictEqual(m1.status, 'live');
  applyAction(t, 'finish', { matchId: m1.id });
  assert.strictEqual(final.teamA, m1.teamA);
  // Tie in knockout needs a tie-break winner.
  assert.throws(() => applyAction(t, 'finish', { matchId: m2.id }), /tied/);
  applyAction(t, 'finish', { matchId: m2.id, winner: 'B' });
  assert.strictEqual(final.teamB, m2.teamB);
  applyAction(t, 'score', { matchId: final.id, team: 'B', delta: 1 });
  assert.throws(() => applyAction(t, 'reopen', { matchId: m1.id }), /next match/);
  applyAction(t, 'finish', { matchId: final.id });
  assert.strictEqual(final.winner, m2.teamB);
  assert.throws(() => applyAction(t, 'score', { matchId: final.id, team: 'A', delta: 1 }), /finished/);
});

test('round robin: everyone plays everyone once, standings', () => {
  const t = createTournament({ name: 'x', format: 'round_robin', teamNames: names(5), durationSec: 60 });
  assert.strictEqual(t.matches.length, 10);
  const pairs = new Set(t.matches.map((m) => [m.teamA, m.teamB].sort().join()));
  assert.strictEqual(pairs.size, 10);
  const m = t.matches[0];
  applyAction(t, 'setScore', { matchId: m.id, scoreA: 2, scoreB: 2 });
  applyAction(t, 'finish', { matchId: m.id });
  assert.strictEqual(m.winner, null);
  const s = standings(t);
  assert.strictEqual(s.filter((r) => r.points === 1).length, 2);
});

test('timer start/pause/adjust', () => {
  const t = createTournament({ name: 'x', format: 'round_robin', teamNames: names(2), durationSec: 60 });
  const m = t.matches[0];
  applyAction(t, 'timerStart', { matchId: m.id }, 1000);
  assert.strictEqual(timerRemaining(m.timer, 11000), 50000);
  applyAction(t, 'timerPause', { matchId: m.id }, 21000);
  assert.strictEqual(timerRemaining(m.timer, 99999), 40000);
  applyAction(t, 'timerAdjust', { matchId: m.id, seconds: 30 });
  assert.strictEqual(timerRemaining(m.timer, 0), 70000);
  applyAction(t, 'timerStart', { matchId: m.id }, 100000);
  assert.strictEqual(timerRemaining(m.timer, 200000), -30000); // overtime
});

test('validation', () => {
  assert.throws(() => createTournament({ name: 'x', format: 'single_elim', teamNames: ['A'], durationSec: 60 }), /2 teams/);
  assert.throws(() => createTournament({ name: 'x', format: 'single_elim', teamNames: ['A', 'B'], durationSec: 1 }), /time limit/);
});
