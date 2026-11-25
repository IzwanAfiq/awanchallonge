'use strict';

const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const Store = require('./lib/store');
const Auth = require('./lib/auth');
const { createTournament, applyAction, standings } = require('./lib/bracket');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');

const store = new Store(DATA_FILE);
const auth = new Auth(store);
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const bearer = (req) => (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
const authed = (req) => auth.check(bearer(req));

function payload(t) {
  return { tournament: t, standings: standings(t), serverNow: Date.now() };
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
app.get('/api/me', (req, res) => res.json({ ok: authed(req) }));

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
    if (!auth.check(msg.token)) return reply({ ok: false, error: 'Please sign in', auth: true });
    const t = store.get(msg.tournamentId);
    if (!t) return reply({ ok: false, error: 'Tournament not found' });
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
  console.log(`  Sign in as ${auth.id} to edit scores.`);
});
