'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Auth = require('../lib/auth');

// The real organiser password is deliberately NOT written here; these tests use an override.
const fakeStore = () => ({ data: {}, save() {} });
const env = { ADMIN_ID: 'IZWAN', ADMIN_PASSWORD: 'test-pass' };

test('only the configured ID and password can sign in', async () => {
  const auth = new Auth(fakeStore(), env);
  assert.strictEqual((await auth.login('IZWAN', 'test-pass', 'ip1')).ok, true);
  assert.strictEqual((await auth.login('izwan', 'test-pass', 'ip1')).ok, true); // ID is not case-sensitive
  assert.strictEqual((await auth.login('IZWAN', 'test-pasS', 'ip1')).ok, false);
  assert.strictEqual((await auth.login('ADMIN', 'test-pass', 'ip1')).ok, false);
  assert.strictEqual((await auth.login('IZWAN', '', 'ip1')).ok, false);
});

test('built-in password rejects wrong guesses', async () => {
  const auth = new Auth(fakeStore(), {});
  assert.strictEqual((await auth.login('IZWAN', '000000', 'ip4')).ok, false);
  assert.strictEqual((await auth.login('IZWAN', '', 'ip4')).ok, false);
});

test('session tokens, sign out, lockout', async () => {
  const auth = new Auth(fakeStore(), env);
  const r = await auth.login('IZWAN', 'test-pass', 'ip2');
  assert.ok(auth.isAdmin(r.token));
  assert.ok(!auth.isAdmin("nope"));
  auth.logout(r.token);
  assert.ok(!auth.isAdmin(r.token));
  for (let i = 0; i < 5; i++) await auth.login('IZWAN', 'x', 'ip3');
  const locked = await auth.login('IZWAN', 'test-pass', 'ip3');
  assert.strictEqual(locked.ok, false);
  assert.match(locked.error, /Too many/);
});

const { createTournament } = require('../lib/bracket');
const { permission, courtPins } = Auth;

function twoCourtTournament() {
  return createTournament({ name: 'x', format: 'round_robin', teamNames: ['A', 'B', 'C', 'D'], durationSec: 60, courts: 2 });
}

test('default court PINs: 1111, 2222, ...', () => {
  const t = twoCourtTournament();
  assert.deepStrictEqual(courtPins(t), [{ court: 1, pin: '1111' }, { court: 2, pin: '2222' }]);
});

test('court scorer signs in with PIN and can only score own court', () => {
  const auth = new Auth(fakeStore(), env);
  const t = twoCourtTournament();
  assert.strictEqual(auth.loginCourt(t, '9999', 'ip5').ok, false);
  const r = auth.loginCourt(t, '2222', 'ip5');
  assert.strictEqual(r.court, 2);
  const s = auth.session(r.token);
  const c1 = t.matches.find((m) => m.court === 'Court 1');
  const c2 = t.matches.find((m) => m.court === 'Court 2');
  assert.strictEqual(permission(s, t, 'score', { matchId: c2.id }), null);
  assert.strictEqual(permission(s, t, 'timerStart', { matchId: c2.id }), null);
  assert.match(permission(s, t, 'score', { matchId: c1.id }), /Court 2/);
  assert.match(permission(s, t, 'setCourt', { matchId: c2.id }), /organiser/);
  assert.strictEqual(auth.isAdmin(r.token), false);
  // Not valid for another tournament.
  const other = twoCourtTournament();
  assert.match(permission(s, other, 'score', { matchId: other.matches[0].id }), /sign in/);
  // Revoked when the PIN changes.
  auth.revokeCourt(t.id, [2]);
  assert.strictEqual(auth.session(r.token), null);
});

test('organiser can do everything; no session can do nothing', () => {
  const t = twoCourtTournament();
  assert.strictEqual(permission({ role: 'admin' }, t, 'setCourt', { matchId: t.matches[0].id }), null);
  assert.match(permission(null, t, 'score', { matchId: t.matches[0].id }), /sign in/);
});
