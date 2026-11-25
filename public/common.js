/* Shared client helpers: socket connection, server clock sync, formatting, bracket rendering. */
(function () {
  const socket = io();
  let offset = 0; // serverNow - Date.now()

  function syncClock() {
    const t0 = Date.now();
    socket.emit('time', (serverNow) => {
      const t1 = Date.now();
      offset = serverNow + (t1 - t0) / 2 - t1;
    });
  }
  socket.on('connect', syncClock);
  setInterval(syncClock, 60000);

  const now = () => Date.now() + offset;

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function remaining(timer) {
    const run = timer.startedAt ? now() - timer.startedAt : 0;
    return timer.duration - timer.elapsed - run;
  }

  function fmtClock(ms) {
    const over = ms < 0;
    const total = Math.ceil(Math.abs(ms) / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const body = (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
    return (over ? '+' : '') + body;
  }

  function fmtDuration(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m}m ${s}s` : `${m} min`;
  }

  function teamName(t, teamId) {
    if (!teamId) return null;
    const tm = t.teams.find((x) => x.id === teamId);
    return tm ? tm.name : '?';
  }

  function roundName(t, round) {
    if (t.format === 'round_robin') return 'Round ' + round;
    const total = Math.max(...t.matches.map((m) => m.round));
    const left = total - round;
    if (left === 0) return 'Final';
    if (left === 1) return 'Semifinals';
    if (left === 2) return 'Quarterfinals';
    return 'Round ' + round;
  }

  // Timer element markup; values are filled in by tickTimers().
  function timerHtml(m, cls = '') {
    return `<span class="clock ${cls}" data-timer="${m.id}"></span>`;
  }

  let current = null;
  function tickTimers() {
    if (current) {
      document.querySelectorAll('[data-timer]').forEach((el) => {
        const m = current.matches.find((x) => x.id === el.dataset.timer);
        if (!m) return;
        const ms = remaining(m.timer);
        el.textContent = fmtClock(ms);
        el.classList.toggle('running', !!m.timer.startedAt);
        el.classList.toggle('low', ms <= 30000 && ms > 0 && m.status !== 'done');
        el.classList.toggle('over', ms <= 0 && m.status !== 'done');
      });
    }
    requestAnimationFrame(tickTimers);
  }
  requestAnimationFrame(tickTimers);

  function matchCard(t, m, { link } = {}) {
    const a = teamName(t, m.teamA);
    const b = teamName(t, m.teamB);
    const isBye = m.status === 'bye';
    const side = (name, score, teamId) => {
      const win = m.status === 'done' && m.winner && m.winner === teamId;
      const lose = m.status === 'done' && m.winner && m.winner !== teamId;
      return `<div class="side ${win ? 'win' : ''} ${lose ? 'lose' : ''} ${name ? '' : 'tbd'}">
        <span class="name">${name ? esc(name) : isBye ? 'BYE' : 'TBD'}</span>
        <span class="score">${isBye || (m.status === 'pending' && !score) ? '' : score}</span>
      </div>`;
    };
    const meta = [];
    if (m.court) meta.push(`<span class="court">${esc(m.court)}</span>`);
    if (m.status === 'live') meta.push('<span class="badge live">LIVE</span>' + timerHtml(m));
    else if (m.status === 'pending' && m.teamA && m.teamB) meta.push(timerHtml(m, 'idle'));
    else if (m.status === 'done') meta.push('<span class="badge done">FINAL</span>');
    const tag = link ? 'a' : 'div';
    const href = link ? ` href="${link}"` : '';
    return `<${tag}${href} class="match ${m.status}" data-id="${m.id}">
      ${side(a, m.scoreA, m.teamA)}${side(b, m.scoreB, m.teamB)}
      ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
    </${tag}>`;
  }

  function renderBracket(t) {
    const rounds = [...new Set(t.matches.map((m) => m.round))].sort((a, b) => a - b);
    const last = rounds[rounds.length - 1];
    const cols = rounds.map((r) => {
      const ms = t.matches.filter((m) => m.round === r).sort((a, b) => a.index - b.index);
      let body;
      if (r === last) {
        body = `<div class="slot">${ms.map((m) => matchCard(t, m)).join('')}</div>`;
      } else {
        const pairs = [];
        for (let i = 0; i < ms.length; i += 2) {
          pairs.push(`<div class="pair"><div class="slot">${matchCard(t, ms[i])}</div><div class="slot">${ms[i + 1] ? matchCard(t, ms[i + 1]) : ''}</div></div>`);
        }
        body = pairs.join('');
      }
      return `<div class="round"><h3>${roundName(t, r)}</h3><div class="round-body">${body}</div></div>`;
    });
    const final = t.matches.find((m) => m.round === last);
    const champ = final && final.status === 'done' && final.winner
      ? `<div class="round champion"><h3>Champion</h3><div class="round-body"><div class="slot"><div class="champ-name">🏆 ${esc(teamName(t, final.winner))}</div></div></div></div>`
      : '';
    return `<div class="bracket">${cols.join('')}${champ}</div>`;
  }

  function renderStandings(t, rows) {
    return `<table class="standings">
      <thead><tr><th>#</th><th class="l">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>+/-</th><th>Pts</th></tr></thead>
      <tbody>${rows
        .map((r, i) => `<tr class="${i === 0 && r.played ? 'lead' : ''}"><td>${i + 1}</td><td class="l">${esc(r.name)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.diff > 0 ? '+' : ''}${r.diff}</td><td><b>${r.points}</b></td></tr>`)
        .join('')}</tbody></table>`;
  }

  function renderRounds(t, opts) {
    const rounds = [...new Set(t.matches.map((m) => m.round))].sort((a, b) => a - b);
    return rounds
      .map((r) => {
        const ms = t.matches.filter((m) => m.round === r);
        return `<section class="rr-round"><h3>${roundName(t, r)}</h3><div class="match-grid">${ms.map((m) => matchCard(t, m, opts && opts.link ? { link: opts.link(m) } : {})).join('')}</div></section>`;
      })
      .join('');
  }

  const PIN_KEY = 'tourney-pin';
  const getPin = () => {
    try { return localStorage.getItem(PIN_KEY) || ''; } catch { return ''; }
  };
  const setPin = (p) => {
    try { localStorage.setItem(PIN_KEY, p); } catch {}
  };

  function action(tournamentId, type, payload) {
    return new Promise((resolve) => {
      socket.emit('action', { pin: getPin(), tournamentId, type, payload }, (res) => resolve(res || { ok: false, error: 'No response' }));
    });
  }

  function toast(msg, kind = 'error') {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'show ' + kind;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.className = ''), 3000);
  }

  window.T = {
    socket, now, esc, remaining, fmtClock, fmtDuration, teamName, roundName, timerHtml,
    matchCard, renderBracket, renderStandings, renderRounds, getPin, setPin, action, toast,
    setCurrent: (t) => (current = t),
  };
})();
