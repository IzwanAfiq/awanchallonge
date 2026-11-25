'use strict';
// Tournament logic: bracket generation, match results, advancement, standings.
// Pure functions operating on plain objects so they are easy to test.

const crypto = require('crypto');

const id = () => crypto.randomBytes(6).toString('hex');

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Standard bracket seed order, e.g. size 8 -> [1,8,4,5,2,7,3,6]
function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((s) => [s, n - s]);
  }
  return order;
}

function newTimer(durationSec) {
  return { duration: durationSec * 1000, elapsed: 0, startedAt: null };
}

function newMatch(fields, durationSec) {
  return {
    id: id(),
    round: 0,
    index: 0,
    teamA: null,
    teamB: null,
    scoreA: 0,
    scoreB: 0,
    status: 'pending', // pending | live | done | bye
    winner: null,
    court: '',
    time: '', // scheduled start, "HH:MM"
    next: null, // { matchId, slot: 'A' | 'B' }
    timer: newTimer(durationSec),
    ...fields,
  };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateSingleElim(teams, durationSec) {
  const size = nextPow2(Math.max(teams.length, 2));
  const rounds = Math.log2(size);
  const matches = [];
  const byRound = [];

  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    const list = [];
    for (let i = 0; i < count; i++) {
      const m = newMatch({ round: r, index: i }, durationSec);
      list.push(m);
      matches.push(m);
    }
    byRound.push(list);
  }
  // Link each match to the match its winner goes to.
  for (let r = 0; r < rounds - 1; r++) {
    byRound[r].forEach((m, i) => {
      m.next = { matchId: byRound[r + 1][Math.floor(i / 2)].id, slot: i % 2 === 0 ? 'A' : 'B' };
    });
  }
  // Place seeds (teams in given order are seeds 1..n; missing seeds are byes).
  const order = seedOrder(size);
  byRound[0].forEach((m, i) => {
    const a = teams[order[i * 2] - 1];
    const b = teams[order[i * 2 + 1] - 1];
    m.teamA = a ? a.id : null;
    m.teamB = b ? b.id : null;
  });
  const t = { matches };
  // Resolve byes.
  byRound[0].forEach((m) => {
    if (!m.teamA || !m.teamB) {
      m.status = 'bye';
      m.winner = m.teamA || m.teamB;
      advance(t, m);
    }
  });
  return matches;
}

// Circle method; every team plays every other team once.
function generateRoundRobin(teams, durationSec) {
  const list = teams.map((t) => t.id);
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const matches = [];
  let arr = list.slice();
  for (let r = 1; r < n; r++) {
    let idx = 0;
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a && b) {
        // Alternate home/away so the fixed team isn't always team A.
        const swap = i === 0 && r % 2 === 0;
        matches.push(newMatch({ round: r, index: idx++, teamA: swap ? b : a, teamB: swap ? a : b }, durationSec));
      }
    }
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  return matches;
}

// Spread matches over courts and time slots. A new slot row starts at each round,
// so a team is never booked into two matches at once.
function schedule(matches, { courts, startTime, durationSec, breakMin }) {
  const playable = matches.filter((m) => m.status !== 'bye').sort((a, b) => a.round - b.round || a.index - b.index);
  let start = null;
  const hm = /^(\d{1,2}):(\d{2})$/.exec(startTime || '');
  if (hm) start = Number(hm[1]) * 60 + Number(hm[2]);
  const slotMin = Math.ceil(durationSec / 60) + breakMin;
  let row = 0;
  let round = null;
  let col = 0;
  for (const m of playable) {
    if (m.round !== round) {
      if (round !== null && col > 0) row++;
      round = m.round;
      col = 0;
    }
    if (col === courts) { row++; col = 0; }
    m.court = courts > 1 || hm ? `Court ${col + 1}` : '';
    if (start !== null) {
      const t = (start + row * slotMin) % (24 * 60);
      m.time = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    }
    col++;
  }
}

function createTournament({ name, format, teamNames, durationSec, randomize, courts = 1, startTime = '', breakMin = 0 }) {
  const cleanNames = (teamNames || []).map((s) => String(s).trim()).filter(Boolean);
  const unique = [...new Set(cleanNames)];
  if (!name || !String(name).trim()) throw new Error('Tournament name is required');
  if (unique.length < 2) throw new Error('At least 2 teams are required');
  if (unique.length > 128) throw new Error('At most 128 teams are supported');
  if (!['single_elim', 'round_robin'].includes(format)) throw new Error('Unknown format');
  const dur = Math.round(Number(durationSec));
  if (!Number.isFinite(dur) || dur < 10 || dur > 6 * 3600) throw new Error('Match time limit must be between 10 seconds and 6 hours');

  const nCourts = Math.round(Number(courts) || 1);
  if (nCourts < 1 || nCourts > 32) throw new Error('Courts must be between 1 and 32');
  const brk = Math.max(0, Math.min(240, Math.round(Number(breakMin) || 0)));
  const st = String(startTime || '').trim();
  if (st && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(st)) throw new Error('Start time must look like 13:00');

  let teams = unique.map((n, i) => ({ id: id(), name: n.slice(0, 60), color: i }));
  if (randomize) teams = shuffle(teams);
  const matches = format === 'single_elim' ? generateSingleElim(teams, dur) : generateRoundRobin(teams, dur);
  schedule(matches, { courts: nCourts, startTime: st, durationSec: dur, breakMin: brk });
  return {
    id: id(),
    name: String(name).trim().slice(0, 100),
    format,
    durationSec: dur,
    courts: nCourts,
    startTime: st,
    teams,
    matches,
    createdAt: Date.now(),
  };
}

function findMatch(t, matchId) {
  const m = t.matches.find((x) => x.id === matchId);
  if (!m) throw new Error('Match not found');
  return m;
}

function advance(t, m) {
  if (!m.next) return;
  const nm = t.matches.find((x) => x.id === m.next.matchId);
  if (!nm) return;
  nm[m.next.slot === 'A' ? 'teamA' : 'teamB'] = m.winner;
}

function timerRemaining(timer, now) {
  const run = timer.startedAt ? now - timer.startedAt : 0;
  return timer.duration - timer.elapsed - run;
}

function pauseTimer(m, now) {
  if (m.timer.startedAt) {
    m.timer.elapsed += now - m.timer.startedAt;
    m.timer.startedAt = null;
  }
}

function assertPlayable(m) {
  if (m.status === 'bye') throw new Error('This is a bye');
  if (m.status === 'done') throw new Error('Match is finished. Reopen it to make changes.');
  if (!m.teamA || !m.teamB) throw new Error('Waiting for both teams');
}

// Apply an action from a scorer/admin. Mutates t. Returns nothing; throws on invalid action.
function applyAction(t, type, p = {}, now = Date.now()) {
  if (type === 'setDefaultDuration') {
    const dur = Math.round(Number(p.seconds));
    if (!Number.isFinite(dur) || dur < 10 || dur > 6 * 3600) throw new Error('Invalid duration');
    t.durationSec = dur;
    // Apply to matches whose timer hasn't been touched yet.
    t.matches.forEach((m) => {
      if (m.status === 'pending' && m.timer.elapsed === 0 && !m.timer.startedAt) m.timer.duration = dur * 1000;
    });
    return;
  }

  const m = findMatch(t, p.matchId);
  switch (type) {
    case 'score': {
      assertPlayable(m);
      const key = p.team === 'A' ? 'scoreA' : p.team === 'B' ? 'scoreB' : null;
      if (!key) throw new Error('Invalid team');
      const delta = Math.round(Number(p.delta));
      if (!Number.isFinite(delta) || Math.abs(delta) > 100) throw new Error('Invalid delta');
      m[key] = Math.max(0, m[key] + delta);
      if (m.status === 'pending') m.status = 'live';
      break;
    }
    case 'setScore': {
      assertPlayable(m);
      const a = Math.round(Number(p.scoreA));
      const b = Math.round(Number(p.scoreB));
      if (![a, b].every((x) => Number.isFinite(x) && x >= 0 && x < 100000)) throw new Error('Invalid score');
      m.scoreA = a;
      m.scoreB = b;
      if (m.status === 'pending') m.status = 'live';
      break;
    }
    case 'timerStart':
      assertPlayable(m);
      if (!m.timer.startedAt) m.timer.startedAt = now;
      m.status = 'live';
      break;
    case 'timerPause':
      pauseTimer(m, now);
      break;
    case 'timerReset':
      if (m.status === 'done') throw new Error('Match is finished');
      m.timer.elapsed = 0;
      m.timer.startedAt = null;
      break;
    case 'timerAdjust': {
      // Positive seconds = add time to the clock.
      if (m.status === 'done') throw new Error('Match is finished');
      const s = Math.round(Number(p.seconds));
      if (!Number.isFinite(s) || Math.abs(s) > 3600) throw new Error('Invalid adjustment');
      m.timer.duration = Math.max(1000, m.timer.duration + s * 1000);
      break;
    }
    case 'setCourt':
      m.court = String(p.court || '').trim().slice(0, 30);
      if (p.time !== undefined) {
        const tm = String(p.time || '').trim();
        if (tm && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(tm)) throw new Error('Time must look like 13:00');
        m.time = tm;
      }
      break;
    case 'finish': {
      assertPlayable(m);
      let winner = null;
      if (m.scoreA > m.scoreB) winner = m.teamA;
      else if (m.scoreB > m.scoreA) winner = m.teamB;
      else if (p.winner === 'A') winner = m.teamA;
      else if (p.winner === 'B') winner = m.teamB;
      if (!winner && t.format === 'single_elim') throw new Error('Scores are tied. Pick a winner (tie-break) to finish.');
      pauseTimer(m, now);
      m.status = 'done';
      m.winner = winner; // null = draw (round robin only)
      advance(t, m);
      break;
    }
    case 'reopen': {
      if (m.status !== 'done') throw new Error('Match is not finished');
      if (m.next) {
        const nm = findMatch(t, m.next.matchId);
        if (nm.status === 'done' || nm.status === 'live') {
          throw new Error('The next match has already started. Reopen that one first.');
        }
        nm[m.next.slot === 'A' ? 'teamA' : 'teamB'] = null;
      }
      m.status = 'live';
      m.winner = null;
      break;
    }
    default:
      throw new Error('Unknown action');
  }
}

function standings(t) {
  const rows = new Map(t.teams.map((tm) => [tm.id, { teamId: tm.id, name: tm.name, played: 0, won: 0, drawn: 0, lost: 0, pf: 0, pa: 0, points: 0 }]));
  for (const m of t.matches) {
    if (m.status !== 'done' || !m.teamA || !m.teamB) continue;
    const a = rows.get(m.teamA);
    const b = rows.get(m.teamB);
    if (!a || !b) continue;
    a.played++; b.played++;
    a.pf += m.scoreA; a.pa += m.scoreB;
    b.pf += m.scoreB; b.pa += m.scoreA;
    if (m.winner === m.teamA) { a.won++; b.lost++; a.points += 3; }
    else if (m.winner === m.teamB) { b.won++; a.lost++; b.points += 3; }
    else { a.drawn++; b.drawn++; a.points++; b.points++; }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, diff: r.pf - r.pa }))
    .sort((x, y) => y.points - x.points || y.diff - x.diff || y.pf - x.pf || x.name.localeCompare(y.name));
}

module.exports = { createTournament, applyAction, standings, seedOrder, timerRemaining };
