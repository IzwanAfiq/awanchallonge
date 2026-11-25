'use strict';
// Organiser sign-in. Only the configured ID + password can change scores.
//
// The default password is stored only as a slow salted scrypt hash, so it is
// not readable from the source code. Override with ADMIN_ID / ADMIN_PASSWORD.

const crypto = require('crypto');

const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const DEFAULT_ID = 'IZWAN';
const DEFAULT_SALT = 'a76310d8e473d5e900e541a5d2a6a0bb';
const DEFAULT_HASH = '25035493615e1d93def6a97c60c0e4643b6532a5497bdc7184a01b188bbe3091';
const SESSION_DAYS = 30;

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));

function scrypt(password, salt) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(String(password), salt, 32, SCRYPT, (err, key) => (err ? reject(err) : resolve(key.toString('hex')))),
  );
}

class Auth {
  constructor(store, env = process.env) {
    this.store = store;
    this.id = String(env.ADMIN_ID || DEFAULT_ID);
    this.password = env.ADMIN_PASSWORD ? String(env.ADMIN_PASSWORD) : null;
    this.failures = new Map(); // ip -> { count, until }
    if (!store.data.sessions) store.data.sessions = {};
  }

  // Throttle guessing: 5 wrong tries locks that address out for 5 minutes.
  blocked(ip) {
    const f = this.failures.get(ip);
    return f && f.count >= 5 && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
  }

  async login(id, password, ip) {
    const wait = this.blocked(ip);
    if (wait) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.` };
    // ID is matched case-insensitively (phone keyboards auto-capitalise); password exactly.
    const idOk = safeEqual(String(id || '').trim().toUpperCase(), this.id.toUpperCase());
    const pwOk = this.password !== null
      ? safeEqual(String(password || ''), this.password)
      : safeEqual(await scrypt(password || '', DEFAULT_SALT), DEFAULT_HASH);
    if (!idOk || !pwOk) {
      const f = this.failures.get(ip) || { count: 0, until: 0 };
      if (f.until < Date.now()) f.count = 0;
      f.count++;
      f.until = Date.now() + 5 * 60 * 1000;
      this.failures.set(ip, f);
      return { ok: false, error: 'Wrong ID or password' };
    }
    this.failures.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    this.store.data.sessions[sha256(token).toString('hex')] = { exp: Date.now() + SESSION_DAYS * 864e5 };
    this.prune();
    this.store.save();
    return { ok: true, token, id: this.id };
  }

  check(token) {
    if (!token || typeof token !== 'string') return false;
    const s = this.store.data.sessions[sha256(token).toString('hex')];
    return !!s && s.exp > Date.now();
  }

  logout(token) {
    if (!token) return;
    delete this.store.data.sessions[sha256(token).toString('hex')];
    this.store.save();
  }

  prune() {
    const now = Date.now();
    for (const [k, s] of Object.entries(this.store.data.sessions)) if (s.exp < now) delete this.store.data.sessions[k];
  }
}

module.exports = Auth;
