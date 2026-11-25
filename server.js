'use strict';

const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const Store = require('./lib/store');
const Auth = require('./lib/auth');
const { permission, courtPins } = Auth;
const { createTournament, applyAction, standings } = require('./lib/bracket');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');

const store = new Store(DATA_FILE);
const auth = new Auth(store);
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const bearer = (req) => (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
const authed = (req) => auth.isAdmin(bearer(req));

// Court PINs are private: never sent to viewers.
function publicView(t) {
  const { courtPins: _hidden, ...rest } = t;
  return rest;
}

function payload(t) {
  return { tournament: publicView(t), standings: standings(t), serverNow: Date.now() };
}

function broadcast(t) {
  io.to(t.id).emit('state', payload(t));
  io.emit('list-changed');
}

function summary(t) {
  return {
    id: t.id,
    name: t.name,
    format: t.format,
    teams: t.teams.length,
    durationSec: t.durationSec,
    courts: t.courts || 1,
    live: t.matches.filter((m) => m.status === 'live').length,
    done: t.matches.filter((m) => m.status === 'done').length,
    total: t.matches.filter((m) => m.status !== 'bye').length,
    createdAt: t.createdAt,
  };
}

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const page = (f) => (req, res) => res.sendFile(path.join(__dirname, 'public', f));
app.get('/t/:id', page('display.html'));
app.get('/t/:id/score', page('score.html'));

app.get('/api/tournaments', (req, res) => res.json(store.list().map(summary)));

app.get('/api/tournaments/:id', (req, res) => {
  const t = store.get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(payload(t));
});

app.set('trust proxy', 'loopback');

app.post('/api/login', async (req, res) => {
  const b = req.body || {};
  const r = await auth.login(b.id, b.password, req.ip);
  res.status(r.ok ? 200 : 401).json(r);
});
app.post('/api/logout', (req, res) => {
  auth.logout(bearer(req));
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => {
  const s = auth.session(bearer(req));
  res.json(s ? { ok: true, ...s } : { ok: false });
});

app.post('/api/tournaments/:id/court-login', (req, res) => {
  const t = store.get(req.params.id);
  if (!t) return res.status(404).json({ ok: false, error: 'Tournament not found' });
  const r = auth.loginCourt(t, req.body && req.body.pin, req.ip);
  res.status(r.ok ? 200 : 401).json(r);
});

app.get('/api/tournaments/:id/pins', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'Please sign in' });
  const t = store.get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json({ pins: courtPins(t) });
});

app.put('/api/tournaments/:id/pins', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'Please sign in' });
  const t = store.get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const next = Object.fromEntries(courtPins(t).map((c) => [c.court, c.pin]));
  const changed = [];
  for (const [court, pin] of Object.entries((req.body && req.body.pins) || {})) {
    const p = String(pin).trim();
    if (!(court in next)) return res.status(400).json({ error: `No court ${court}` });
    if (!/^\d{4,8}$/.test(p)) return res.status(400).json({ error: 'PINs must be 4 to 8 digits' });
    if (next[court] !== p) changed.push(Number(court));
    next[court] = p;
  }
  if (new Set(Object.values(next)).size !== Object.keys(next).length) return res.status(400).json({ error: 'Each court needs a different PIN' });
  t.courtPins = next;
  store.save();
  if (changed.length) auth.revokeCourt(t.id, changed); // old PIN stops working straight away
  res.json({ pins: courtPins(t) });
});

app.post('/api/tournaments', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'Please sign in' });
  try {
    const b = req.body || {};
    const t = createTournament({
      name: b.name,
      format: b.format,
      teamNames: Array.isArray(b.teams) ? b.teams : String(b.teams || '').split('\n'),
      durationSec: b.durationSec,
      randomize: !!b.randomize,
      courts: b.courts,
      startTime: b.startTime,
      breakMin: b.breakMin,
    });
    t.courtPins = Object.fromEntries(courtPins(t).map((c) => [c.court, c.pin]));
    store.put(t);
    io.emit('list-changed');
    res.status(201).json({ id: t.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/tournaments/:id', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'Please sign in' });
  if (!store.get(req.params.id)) return res.status(404).json({ error: 'Not found' });
  store.remove(req.params.id);
  auth.revokeCourt(req.params.id);
  io.to(req.params.id).emit('deleted');
  io.emit('list-changed');
  res.json({ ok: true });
});

app.get('/api/qr', async (req, res) => {
  const url = String(req.query.url || '').slice(0, 500);
  if (!/^https?:\/\//.test(url)) return res.status(400).end();
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#000', light: '#fff' } });
  res.type('image/svg+xml').send(svg);
});

// LAN addresses so the display page can show a QR code phones can actually reach.
app.get('/api/info', (req, res) => {
  const addrs = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) addrs.push(`http://${a.address}:${PORT}`);
  }
  res.json({ lan: addrs });
});

io.on('connection', (socket) => {
  socket.on('time', (cb) => typeof cb === 'function' && cb(Date.now()));

  socket.on('join', (id) => {
    if (typeof id !== 'string') return;
    for (const room of socket.rooms) if (room !== socket.id) socket.leave(room);
    const t = store.get(id);
    if (!t) return socket.emit('deleted');
    socket.join(id);
    socket.emit('state', payload(t));
  });

  socket.on('action', (msg, cb) => {
    const reply = typeof cb === 'function' ? cb : () => {};
    if (!msg || typeof msg !== 'object') return reply({ ok: false, error: 'Bad request' });
    const t = store.get(msg.tournamentId);
    if (!t) return reply({ ok: false, error: 'Tournament not found' });
    const session = auth.session(msg.token);
    const denied = permission(session, t, msg.type, msg.payload || {});
    if (denied) return reply({ ok: false, error: denied, auth: !session });
    try {
      applyAction(t, msg.type, msg.payload || {});
    } catch (e) {
      return reply({ ok: false, error: e.message });
    }
    store.save();
    broadcast(t);
    reply({ ok: true });
  });
});

function shutdown() {
  store.flush();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Tournament server running on http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  On your phone (same Wi-Fi): http://${a.address}:${PORT}`);
  }
  console.log(`  Organiser: sign in as ${auth.id}. Court scorers: PIN 1111 for Court 1, 2222 for Court 2, ...`);
});
