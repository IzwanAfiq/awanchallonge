'use strict';
// Sign-in and permissions.
//
// Two kinds of session:
//   - organiser: ID + password. Can do everything.
//   - court scorer: a per-tournament, per-court PIN. Can only score / run the
//     clock on matches played on their own court.
//
// The default organiser password is stored only as a slow salted scrypt hash,
// so it is not readable from the source code. Override with ADMIN_ID / ADMIN_PASSWORD.

const crypto = require('crypto');

const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const DEFAULT_ID = 'IZWAN';
const DEFAULT_SALT = 'a76310d8e473d5e900e541a5d2a6a0bb';
const DEFAULT_HASH = '25035493615e1d93def6a97c60c0e4643b6532a5497bdc7184a01b188bbe3091';
const ADMIN_DAYS = 30;
const SCORER_HOURS = 24;

// Actions a court scorer may perform on their own court's matches.
const SCORER_ACTIONS = new Set(['score', 'setScore', 'timerStart', 'timerPause', 'timerReset', 'timerAdjust', 'finish', 'reopen']);

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));
const key = (token) => sha256(token).toString('hex');

function scrypt(password, salt) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(String(password), salt, 32, SCRYPT, (err, k) => (err ? reject(err) : resolve(k.toString('hex')))),
  );
}

// "Court 3" -> 3. An empty court means a single unnamed court -> 1. Other names -> null.
function courtNumber(m) {
  if (!m.court) return 1;
  const r = /(\d+)\s*$/.exec(m.court);
  return r ? Number(r[1]) : null;
}

// Default PIN: the court number repeated 4 times (Court 1 = 1111, Court 2 = 2222, Court 10 = 10101010).
const defaultPin = (n) => String(n).repeat(4);

function courtCount(t) {
  const nums = t.matches.map(courtNumber).filter((n) => n);
  return Math.max(t.courts || 1, ...nums, 1);
}

function courtPin(t, n) {
  return (t.courtPins && t.courtPins[n]) || defaultPin(n);
}

function courtPins(t) {
  const out = [];
  for (let n = 1; n <= courtCount(t); n++) out.push({ court: n, pin: courtPin(t, n) });
  return out;
}

// Returns null if the session may perform this action, or an error message.
function permission(session, t, type, payload = {}) {
  if (!session) return 'Please sign in';
  if (session.role === 'admin') return null;
  if (session.role !== 'court' || session.tid !== t.id) return 'Please sign in';
  if (!SCORER_ACTIONS.has(type)) return 'Only the organiser can do that';
  const m = t.matches.find((x) => x.id === payload.matchId);
  if (!m) return 'Match not found';
  if (courtNumber(m) !== session.court) return `You can only score Court ${session.court} matches`;
  return null;
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

  fail(ip) {
    const f = this.failures.get(ip) || { count: 0, until: 0 };
    if (f.until < Date.now()) f.count = 0;
    f.count++;
    f.until = Date.now() + 5 * 60 * 1000;
    this.failures.set(ip, f);
  }

  issue(session) {
    const token = crypto.randomBytes(32).toString('hex');
    this.store.data.sessions[key(token)] = session;
    this.prune();
    this.store.save();
    return token;
  }

  tooMany(ip) {
    const wait = this.blocked(ip);
    return wait ? { ok: false, error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.` } : null;
  }

  async login(id, password, ip) {
    const stop = this.tooMany(ip);
    if (stop) return stop;
    // ID is matched case-insensitively (phone keyboards auto-capitalise); password exactly.
    const idOk = safeEqual(String(id || '').trim().toUpperCase(), this.id.toUpperCase());
    const pwOk = this.password !== null
      ? safeEqual(String(password || ''), this.password)
      : safeEqual(await scrypt(password || '', DEFAULT_SALT), DEFAULT_HASH);
    if (!idOk || !pwOk) {
      this.fail(ip);
      return { ok: false, error: 'Wrong ID or password' };
    }
    this.failures.delete(ip);
    const token = this.issue({ role: 'admin', exp: Date.now() + ADMIN_DAYS * 864e5 });
    return { ok: true, token, role: 'admin' };
  }

  loginCourt(t, pin, ip) {
    const stop = this.tooMany(ip);
    if (stop) return stop;
    const p = String(pin || '').trim();
    const match = courtPins(t).find((c) => safeEqual(p, c.pin));
    if (!match) {
      this.fail(ip);
      return { ok: false, error: 'Wrong PIN' };
    }
    this.failures.delete(ip);
    const token = this.issue({ role: 'court', tid: t.id, court: match.court, exp: Date.now() + SCORER_HOURS * 3600e3 });
    return { ok: true, token, role: 'court', tid: t.id, court: match.court };
  }

  // The session for a token, or null. Sessions saved before roles existed are organiser sessions.
  session(token) {
    if (!token || typeof token !== 'string') return null;
    const s = this.store.data.sessions[key(token)];
    if (!s || s.exp <= Date.now()) return null;
    return { role: s.role || 'admin', tid: s.tid || null, court: s.court || null };
  }

  isAdmin(token) {
    const s = this.session(token);
    return !!s && s.role === 'admin';
  }

  logout(token) {
    if (!token) return;
    delete this.store.data.sessions[key(token)];
    this.store.save();
  }

  // Sign out court scorers of a tournament (optionally only some courts).
  revokeCourt(tid, courts) {
    for (const [k, s] of Object.entries(this.store.data.sessions)) {
      if (s.role === 'court' && s.tid === tid && (!courts || courts.includes(s.court))) delete this.store.data.sessions[k];
    }
    this.store.save();
  }

  prune() {
    const now = Date.now();
    for (const [k, s] of Object.entries(this.store.data.sessions)) if (s.exp < now) delete this.store.data.sessions[k];
  }
}

module.exports = Auth;
Object.assign(module.exports, { permission, courtNumber, courtPins, courtCount, defaultPin });
