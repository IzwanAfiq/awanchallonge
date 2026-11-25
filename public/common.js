/* Shared client helpers: socket, clock sync, sign-in, formatting and the neon UI renderers. */
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

  /* ---------- time ---------- */
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
    return (over ? '+' : '') + (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  function fmtDuration(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m}m ${s}s` : `${m} min`;
  }

  /* ---------- icons ---------- */
  const PALETTE = ['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7', '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#8b5cf6', '#84cc16', '#f43f5e'];
  const ICONS = {
    trophy: '<path d="M7 4h10v3a5 5 0 0 1-10 0V4Z"/><path d="M7 5H4v1a3 3 0 0 0 3 3M17 5h3v1a3 3 0 0 1-3 3M12 12v4M8 20h8M9 16h6v4H9z"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 19a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14a5 5 0 0 1 5 5"/>',
    court: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M12 5v14"/><circle cx="12" cy="12" r="2.5"/><path d="M3 9h3v6H3M21 9h-3v6h3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z" fill="currentColor"/>',
    chart: '<path d="M5 20V11M12 20V5M19 20v-7"/>',
    bracket: '<path d="M4 5h5v6H4M4 13h5v6H4M9 8h4v8H9M13 12h7"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    home: '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
  };
  const icon = (name, cls = '') =>
    `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  function teamOf(t, teamId) {
    return teamId ? t.teams.find((x) => x.id === teamId) || null : null;
  }
  function teamName(t, teamId) {
    const tm = teamOf(t, teamId);
    return tm ? tm.name : null;
  }
  function teamColor(t, teamId) {
    const tm = teamOf(t, teamId);
    if (!tm) return '#4b5563';
    const i = Number.isInteger(tm.color) ? tm.color : t.teams.indexOf(tm);
    return PALETTE[i % PALETTE.length];
  }
  function shield(color) {
    return `<svg class="shield" viewBox="0 0 24 28" aria-hidden="true"><path d="M12 1.5 21.5 5v8c0 6.8-4.6 11.6-9.5 13.5C7.1 24.6 2.5 19.8 2.5 13V5Z" fill="${color}" stroke="rgba(255,255,255,.55)" stroke-width="1.2"/><path d="M12 4.5 18.8 7v6c0 4.8-3.1 8.4-6.8 10Z" fill="rgba(255,255,255,.22)"/></svg>`;
  }
  const teamShield = (t, id) => shield(teamColor(t, id));

  function roundName(t, round) {
    if (t.format === 'round_robin') return 'Round ' + String(round).padStart(2, '0');
    const total = Math.max(...t.matches.map((m) => m.round));
    const left = total - round;
    if (left === 0) return 'Final';
    if (left === 1) return 'Semifinals';
    if (left === 2) return 'Quarterfinals';
    return 'Round ' + round;
  }
  const courtLabel = (m) => m.court || 'Main Court';

  /* ---------- live clocks ---------- */
  const timerHtml = (m, cls = '') => `<span class="clock ${cls}" data-timer="${m.id}"></span>`;
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

  /* ---------- match pieces ---------- */
  function scoreBox(m, side) {
    if (m.status === 'bye' || (m.status === 'pending' && !m.scoreA && !m.scoreB)) return '<span class="sbox empty">–</span>';
    const mine = side === 'A' ? m.scoreA : m.scoreB;
    const id = side === 'A' ? m.teamA : m.teamB;
    const cls = m.status === 'done' ? (m.winner === id ? 'win' : m.winner ? 'lose' : 'draw') : '';
    return `<span class="sbox ${cls}">${mine}</span>`;
  }

  function teamLine(t, m, side) {
    const id = side === 'A' ? m.teamA : m.teamB;
    const name = teamName(t, id);
    const label = name ? esc(name) : m.status === 'bye' ? 'BYE' : 'TBD';
    const lose = m.status === 'done' && m.winner && m.winner !== id;
    return `<div class="tline ${name ? '' : 'tbd'} ${lose ? 'lose' : ''}">${teamShield(t, id)}<span class="tn">${label}</span>${scoreBox(m, side)}</div>`;
  }

  function chip(m) {
    const bits = [];
    if (m.court) bits.push(icon('court') + esc(m.court));
    if (m.time) bits.push(esc(m.time));
    return bits.length ? `<div class="chip ${m.status === 'live' ? 'live' : ''}">${bits.join(' <i>|</i> ')}</div>` : '';
  }

  function matchCard(t, m, { link, showChip = true } = {}) {
    const meta = [];
    if (m.status === 'live') meta.push('<span class="badge live">LIVE</span>' + timerHtml(m));
    else if (m.status === 'pending' && m.teamA && m.teamB) meta.push(`<span class="muted">${m.time && !showChip ? icon('clock') + esc(m.time) : 'Time limit'}</span>` + timerHtml(m, 'idle'));
    else if (m.status === 'done') meta.push('<span class="badge done">FINAL</span>');
    const tag = link ? 'a' : 'div';
    return `<${tag}${link ? ` href="${link}"` : ''} class="mcard ${m.status}" data-id="${m.id}">
      ${showChip ? chip(m) : ''}
      ${teamLine(t, m, 'A')}${teamLine(t, m, 'B')}
      ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
    </${tag}>`;
  }

  /* ---------- views ---------- */
  function renderBracket(t) {
    const rounds = [...new Set(t.matches.map((m) => m.round))].sort((a, b) => a - b);
    const last = rounds[rounds.length - 1];
    const cols = rounds.map((r) => {
      const ms = t.matches.filter((m) => m.round === r).sort((a, b) => a.index - b.index);
      let body;
      if (r === last) body = `<div class="slot">${matchCard(t, ms[0])}</div>`;
      else {
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
      ? `<div class="round champion"><h3>Champion</h3><div class="round-body"><div class="slot"><div class="champ">${icon('trophy')}<span>${esc(teamName(t, final.winner))}</span></div></div></div></div>`
      : '';
    return `<div class="bracket">${cols.join('')}${champ}</div>`;
  }

  function medal(rank) {
    if (rank > 3) return `<span class="rank">${rank}</span>`;
    return `<span class="rank medal m${rank}">${rank}</span>`;
  }

  function renderStandings(t, rows) {
    return `<div class="glass table-wrap"><table class="standings">
      <thead><tr><th>#</th><th class="l">Team</th><th>P</th><th>W / D / L</th><th>+/-</th><th>Pts</th><th class="hide-sm">Win rate</th></tr></thead>
      <tbody>${rows.map((r, i) => {
        const rate = r.played ? Math.round((r.won / r.played) * 1000) / 10 : 0;
        const rc = !r.played ? '' : rate >= 75 ? 'good' : rate >= 34 ? 'mid' : 'bad';
        return `<tr class="${i === 0 && r.played ? 'lead' : ''}">
          <td>${rows.some((x) => x.played) ? medal(i + 1) : `<span class="rank">${i + 1}</span>`}</td>
          <td class="l"><span class="tcell">${teamShield(t, r.teamId)}<b>${esc(r.name)}</b></span></td>
          <td>${r.played}</td>
          <td class="wdl"><span class="w">${r.won}</span> / <span class="d">${r.drawn}</span> / <span class="lo">${r.lost}</span></td>
          <td>${r.diff > 0 ? '+' : ''}${r.diff}</td>
          <td><b class="pts">${r.points}</b></td>
          <td class="hide-sm"><span class="rate ${rc}">${r.played ? rate + '%' : '–'}</span></td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }

  // "Match dashboard" style: one card per round, matches inside with court/time chips.
  function renderRounds(t, opts = {}) {
    const rounds = [...new Set(t.matches.map((m) => m.round))].sort((a, b) => a - b);
    return `<div class="round-grid">${rounds.map((r) => {
      const ms = t.matches.filter((m) => m.round === r && m.status !== 'bye');
      if (!ms.length) return '';
      const allDone = ms.every((m) => m.status === 'done');
      return `<section class="glass round-card ${allDone ? 'complete' : ''}">
        <h3>${roundName(t, r)}${allDone ? `<span class="tick">${icon('check')}</span>` : ''}</h3>
        ${ms.map((m) => matchCard(t, m, opts.link ? { link: opts.link(m) } : {})).join('')}
      </section>`;
    }).join('')}</div>`;
  }

  function courts(t) {
    const names = [...new Set(t.matches.filter((m) => m.status !== 'bye').map(courtLabel))];
    return names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  const ready = (m) => m.teamA && m.teamB;
  const byTime = (a, b) => (a.time || '').localeCompare(b.time || '') || a.round - b.round || a.index - b.index;

  function renderSchedule(t) {
    return `<div class="sched-grid">${courts(t).map((c, ci) => {
      const ms = t.matches.filter((m) => m.status !== 'bye' && courtLabel(m) === c).sort(byTime);
      return `<section class="glass sched-court c${ci % 2}">
        <h3>${icon('court')}${esc(c)}</h3>
        ${ms.map((m) => `<div class="sched-row ${m.status}">
          <span class="time">${icon('clock')}${m.time ? esc(m.time) : '--:--'}</span>
          <span class="vs-line">
            <span class="ta">${teamShield(t, m.teamA)}<span>${esc(teamName(t, m.teamA) || 'TBD')}</span></span>
            <span class="vs">${m.status === 'pending' ? 'VS' : `${m.scoreA}-${m.scoreB}`}</span>
            <span class="tb"><span>${esc(teamName(t, m.teamB) || 'TBD')}</span>${teamShield(t, m.teamB)}</span>
          </span>
          <span class="tag hide-sm">${esc(roundName(t, m.round))}</span>
        </div>`).join('')}
      </section>`;
    }).join('')}</div>`;
  }

  // Court rows like the reference scoreboard: [Court] [current match] [next match].
  function renderCourtBoard(t) {
    const rows = courts(t).map((c, ci) => {
      const ms = t.matches.filter((m) => m.status !== 'bye' && courtLabel(m) === c).sort(byTime);
      const live = ms.filter((m) => m.status === 'live');
      const upcoming = ms.filter((m) => m.status === 'pending' && ready(m));
      const cur = live[0] || upcoming[0];
      const nxt = live[0] ? upcoming[0] : upcoming[1];
      if (!cur) return '';
      const big = (m, isLive) => `
        <div class="board-match ${isLive ? 'live' : ''}">
          <div class="bm-teams">
            <div class="bm-t">${teamShield(t, m.teamA)}<span>${esc(teamName(t, m.teamA))}</span><b>${isLive ? m.scoreA : ''}</b></div>
            <div class="bm-t">${teamShield(t, m.teamB)}<span>${esc(teamName(t, m.teamB))}</span><b>${isLive ? m.scoreB : ''}</b></div>
          </div>
          <div class="bm-time">${isLive ? '<span class="badge live">LIVE</span>' : ''}<span class="pill">${icon('clock')}${isLive ? timerHtml(m) : esc(m.time || fmtClock(m.timer.duration))}</span></div>
        </div>`;
      return `<div class="board-row">
        <div class="court-tile c${ci % 2}">${icon('court')}<span>${esc(c)}</span></div>
        ${big(cur, cur.status === 'live')}
        ${nxt ? `<div class="board-next"><div class="next-label">Next</div>${big(nxt, false)}</div>` : '<div class="board-next empty"></div>'}
      </div>`;
    }).filter(Boolean);
    return rows.length ? `<div class="board">${rows.join('')}</div>` : '<div class="glass empty-state">No matches waiting. 🏁</div>';
  }

  function renderResults(t) {
    const ms = t.matches.filter((m) => m.status === 'done').sort((a, b) => b.round - a.round || (b.time || '').localeCompare(a.time || ''));
    if (!ms.length) return '<div class="glass empty-state">No results yet.</div>';
    return `<div class="results">${ms.map((m) => `
      <div class="result-row glass">
        <span class="rt ${m.winner === m.teamA ? 'win' : ''}">${teamShield(t, m.teamA)}<span>${esc(teamName(t, m.teamA))}</span></span>
        <span class="rs">${m.scoreA} – ${m.scoreB}</span>
        <span class="rt r ${m.winner === m.teamB ? 'win' : ''}"><span>${esc(teamName(t, m.teamB))}</span>${teamShield(t, m.teamB)}</span>
      </div>`).join('')}</div>`;
  }

  /* ---------- sign-in ---------- */
  const TOKEN_KEY = 'tourney-token';
  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const setToken = (v) => { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch {} };

  async function isSignedIn() {
    if (!getToken()) return false;
    try {
      const r = await fetch('/api/me', { headers: { authorization: 'Bearer ' + getToken() } }).then((x) => x.json());
      if (!r.ok) setToken('');
      return r.ok;
    } catch { return false; }
  }

  function loginDialog() {
    let dlg = document.getElementById('loginDlg');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'loginDlg';
      dlg.innerHTML = `<form class="login-form" autocomplete="on">
        <div class="login-head">${icon('lock')}<div><h2>Organiser sign in</h2><p class="muted">Only the organiser can edit scores.</p></div></div>
        <label for="loginId">ID</label>
        <input id="loginId" name="username" autocomplete="username" autocapitalize="characters" required>
        <label for="loginPw">Password</label>
        <input id="loginPw" name="password" type="password" autocomplete="current-password" required>
        <p class="login-err" id="loginErr"></p>
        <div class="row end"><button type="button" value="cancel" class="btn ghost" id="loginCancel">Cancel</button><button class="btn primary" type="submit">Sign in</button></div>
      </form>`;
      document.body.appendChild(dlg);
    }
    return dlg;
  }

  function signIn() {
    const dlg = loginDialog();
    const form = dlg.querySelector('form');
    const err = dlg.querySelector('#loginErr');
    err.textContent = '';
    dlg.querySelector('#loginPw').value = '';
    dlg.showModal();
    return new Promise((resolve) => {
      const done = (v) => { form.onsubmit = null; dlg.querySelector('#loginCancel').onclick = null; dlg.close(); resolve(v); };
      dlg.querySelector('#loginCancel').onclick = () => done(false);
      dlg.oncancel = () => resolve(false);
      form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        err.textContent = '';
        try {
          const r = await fetch('/api/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: dlg.querySelector('#loginId').value, password: dlg.querySelector('#loginPw').value }),
          }).then((x) => x.json());
          if (r.ok) { setToken(r.token); done(true); } else err.textContent = r.error || 'Sign in failed';
        } catch { err.textContent = 'Network error'; }
        btn.disabled = false;
      };
    });
  }

  async function signOut() {
    await fetch('/api/logout', { method: 'POST', headers: { authorization: 'Bearer ' + getToken() } }).catch(() => {});
    setToken('');
  }

  function api(url, opts = {}) {
    return fetch(url, { ...opts, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + getToken(), ...(opts.headers || {}) } });
  }

  function action(tournamentId, type, payload) {
    return new Promise((resolve) => {
      socket.emit('action', { token: getToken(), tournamentId, type, payload }, (res) => resolve(res || { ok: false, error: 'No response' }));
    });
  }

  function toast(msg, kind = 'error') {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.className = 'show ' + kind;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.className = ''), 3000);
  }

  window.T = {
    socket, now, esc, remaining, fmtClock, fmtDuration, icon, shield, teamShield, teamName, teamColor, roundName, timerHtml,
    matchCard, renderBracket, renderStandings, renderRounds, renderSchedule, renderCourtBoard, renderResults, courts,
    getToken, isSignedIn, signIn, signOut, api, action, toast,
    setCurrent: (t) => (current = t),
  };
})();
