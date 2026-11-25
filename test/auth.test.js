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
  assert.ok(auth.check(r.token));
  assert.ok(!auth.check('nope'));
  auth.logout(r.token);
  assert.ok(!auth.check(r.token));
  for (let i = 0; i < 5; i++) await auth.login('IZWAN', 'x', 'ip3');
  const locked = await auth.login('IZWAN', 'test-pass', 'ip3');
  assert.strictEqual(locked.ok, false);
  assert.match(locked.error, /Too many/);
});
