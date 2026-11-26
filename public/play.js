'use strict';
// Phone UI: join, guess, bet, see results.
(() => {
  const app = document.getElementById('app');
  const m = location.pathname.match(/^\/j\/([A-Za-z]{4})$/);
  let code = m ? m[1].toUpperCase() : null;
  let secret = null;
  let S = null; // latest state from the server
  let es = null;
  let error = '';
  let offline = false;
  let lastCheck = 0;
  // Local, per-phase UI state. Bets live here while you edit and are pushed to the server on every change.
  const L = { key: '', bets: null, locked: false, active: 0, editing: false };

  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };
  const api = (verb) => `/api/rooms/${code}/${verb}`;
  const me = () => playerOf(S, S.me.id);

  // ---------- connection ----------
  async function init() {
    if (code) {
      const saved = store.get('bb:' + code);
      if (saved) {
        try { await post(api('check'), { secret: saved }); secret = saved; return connect(); } catch { store.del('bb:' + code); }
      }
    }
    render();
  }

  function leave(msg) {
    if (es) es.close();
    es = null; S = null; secret = null;
    if (code) store.del('bb:' + code);
    error = msg || '';
    render();
  }

  function connect() {
    if (es) es.close();
    es = new EventSource(`${api('events')}?secret=${secret}`);
    es.onopen = () => { offline = false; if (S) render(); };
    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.kicked) return leave('The host removed you from the room.');
      S = data;
      offline = false;
      clockSkew = S.now - Date.now();
      const key = S.phase + ':' + S.qn;
      if (key !== L.key) {
        L.key = key;
        const typing = document.getElementById('guess');
        if (typing) typing.value = ''; // don't carry a half-typed guess into a new question
        L.editing = false;
        L.active = 0;
        L.bets = S.bets ? S.bets[S.me.id].map((b) => ({ ...b })) : null;
        L.locked = me().locked;
        error = '';
      }
      render();
    };
    es.onerror = async () => {
      offline = true;
      if (S) render();
      if (Date.now() - lastCheck < 3000) return;
      lastCheck = Date.now();
      try { await post(api('check'), { secret }); } catch (e) {
        if (e.status === 403 || e.status === 404) leave('That game has ended.');
      }
    };
  }

  async function act(data) {
    try { await post(api('action'), { secret, ...data }); error = ''; } catch (e) {
      error = e.message;
      if (data.type === 'bets' && S && S.bets) { // fall back to what the server has
        L.bets = S.bets[S.me.id].map((b) => ({ ...b }));
        L.locked = me().locked;
      }
      render();
    }
  }
  const pushBets = () => act({ type: 'bets', bets: L.bets, locked: L.locked });

  // ---------- screens ----------
  const errHTML = () => (error ? `<p class="error">${esc(error)}</p>` : '');

  function joinScreen() {
    const name = esc(store.get('bb:name') || '');
    return `<main class="phone center">
      <h1 class="logo">Brains <span>&amp;</span> Bets</h1>
      <p class="tag">Guess the number. Bet on who's closest.</p>
      <form class="card stack" data-form="join">
        ${code ? `<p class="roomline">Joining room <b>${code}</b></p>` : `<label>Room code<input id="code" class="codein" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" required></label>`}
        <label>Your name<input id="name" maxlength="14" autocomplete="off" placeholder="Name" value="${name}" required></label>
        ${errHTML()}
        <button class="btn primary">Join game</button>
      </form>
      <a class="quiet" href="/host">Host a game on this screen →</a>
    </main>`;
  }

  function top(label) {
    const p = me();
    return `<header class="bar">
      <span class="pill">${S.phase === 'lobby' ? 'Room ' + S.code : `Q${S.round}/${S.rounds}`}</span>
      <span class="phase">${label}${timerHTML(S)}</span>
      <span class="wallet">${dot(p)}<b>${p.chips}</b> chips</span>
    </header>${offline ? '<div class="offline">Reconnecting…</div>' : ''}`;
  }

  function lobbyScreen() {
    return `${top('Lobby')}<main class="phone">
      <div class="card center"><h2>You're in, ${esc(me().name)}!</h2><p class="muted">Waiting for the host to start the game.</p></div>
      <h3>Players · ${S.players.length}</h3>
      <ul class="chiplist">${S.players.map((p) => `<li>${dot(p)}${esc(p.name)}</li>`).join('')}</ul>
    </main>`;
  }

  function waitingList(done, verb) {
    const left = S.players.filter((p) => !done(p));
    return left.length ? `<p class="muted center">Waiting on ${left.map((p) => esc(p.name)).join(', ')}…</p>` : `<p class="muted center">Everyone has ${verb}.</p>`;
  }

  function skipButton() {
    const votes = S.players.filter((p) => p.skip).length;
    const mine = me().skip;
    return `<button class="btn ghost skip ${mine ? 'on' : ''}" data-act="skip">${mine ? 'Voted to skip' : 'Vote to skip'} · ${votes}/${S.skipNeeded}</button>`;
  }

  function guessScreen() {
    const mine = S.me.guess;
    const body = mine === null || L.editing
      ? `<form class="stack" data-form="guess">
          <input id="guess" class="bigin" inputmode="decimal" autocomplete="off" placeholder="Your guess" required>
          ${errHTML()}
          <button class="btn primary">Submit guess</button>
        </form>`
      : `<div class="center"><p class="muted">Your guess</p><p class="huge">${fmt(mine, S.question)}</p>
          <button class="btn ghost" data-act="edit">Change it</button></div>${waitingList((p) => p.guessed, 'guessed')}`;
    return `${top('Guess')}<main class="phone">
      ${S.skipped ? '<p class="notice">Question skipped by vote — here\'s a new one.</p>' : ''}
      <div class="card question">${esc(S.question.text)}</div>
      ${body}
      ${skipButton()}
      <p class="hint">Closest <b>without going over</b> wins. Bonus this round: ${S.bonus} chip${S.bonus === 1 ? "" : "s"}.</p>
    </main>`;
  }

  function betScreen() {
    const p = me();
    const q = S.question;
    const row = (t, title, sub, odds, cls) => {
      const mineTok = L.bets.map((b, i) => (b.target === t ? `<span class="mytok">${i + 1}${b.chips ? `<small>+${b.chips}</small>` : ''}</span>` : '')).join('');
      const others = S.players.filter((o) => o.id !== p.id).flatMap((o) => S.bets[o.id].filter((b) => b.target === t).map(() => dot(o))).join('');
      return `<button class="space ${cls} ${mineTok ? 'picked' : ''}" data-act="place" data-t="${t}" ${L.locked ? 'disabled' : ''}>
        <span class="info"><b>${title}</b><small>${sub}</small></span>
        <span class="toks">${others}${mineTok}</span>
        <span class="odds">${odds}:1</span>
      </button>`;
    };
    const spaces = S.board.map((s) => {
      const o = playerOf(S, s.playerId);
      return row('s:' + s.pos, fmt(s.value, q), s.playerId === p.id ? 'Your guess' : esc(o.name), s.odds, s.color);
    }).join('');
    const tokens = L.bets.map((b, i) => {
      const room = p.chips - L.bets[1 - i].chips;
      const stepper = p.chips > 0 && b.target && !L.locked
        ? `<div class="stepper"><button data-act="chip" data-i="${i}" data-d="-1" ${b.chips <= 0 ? 'disabled' : ''}>−</button><span>+${b.chips}</span><button data-act="chip" data-i="${i}" data-d="1" ${b.chips >= room ? 'disabled' : ''}>+</button><button class="max" data-act="chip" data-i="${i}" data-d="max" ${b.chips >= room ? 'disabled' : ''}>Max</button></div>`
        : '';
      return `<div class="token ${L.active === i && !L.locked ? 'active' : ''}" data-act="tok" data-i="${i}">
        <span class="mytok">${i + 1}</span>
        <span class="info"><b>${b.target ? esc(targetLabel(S, b.target)) : 'Not placed'}</b><small>${b.target ? `Betting ${1 + b.chips} at ${oddsOf(b.target)}:1` : 'Tap a space below'}</small></span>
        ${stepper}
      </div>`;
    }).join('');
    const ready = L.bets.every((b) => b.target);
    return `${top('Bet')}<main class="phone">
      <div class="card question small">${esc(q.text)}</div>
      <div class="tokens">${tokens}</div>
      <div class="mat">
        ${row('low', 'All too high', 'Every guess is over the answer', 6, 'low')}
        ${spaces}
        <div class="sides">
          ${row('red', 'Red', 'Winner on a red space', 1, 'red side')}
          ${row('black', 'Black', 'Winner on a black space', 1, 'black side')}
        </div>
      </div>
      ${errHTML()}
      ${L.locked
        ? `<button class="btn ghost" data-act="unlock">Change bets</button>${waitingList((o) => o.locked, 'locked in')}`
        : `<button class="btn primary" data-act="lock" ${ready ? '' : 'disabled'}>${ready ? 'Lock in bets' : 'Place both tokens'}</button>`}
      <p class="hint">Both tokens must be bet. Tokens are never lost — chips you stack on them are.</p>
    </main>`;
  }

  function oddsOf(t) {
    if (t === 'low') return 6;
    if (t === 'red' || t === 'black') return 1;
    const s = S.board.find((x) => 's:' + x.pos === t);
    return s ? s.odds : 0;
  }

  function revealScreen() {
    const r = S.result;
    const mine = r.players[S.me.id];
    let lines = '';
    if (mine) {
      lines = mine.bets.map((b, i) => `<li class="${b.won ? 'won' : 'lost'}"><span class="mytok">${i + 1}</span><span class="info"><b>${esc(targetLabel(S, b.target))}</b><small>${b.won ? `${b.stake} × ${b.odds}:1` : b.chips ? `Lost ${b.chips} chip${b.chips > 1 ? 's' : ''}` : 'No win'}</small></span><span class="delta ${b.delta > 0 ? 'up' : b.delta < 0 ? 'down' : ''}">${b.delta > 0 ? '+' : ''}${b.delta}</span></li>`).join('');
      if (mine.bonus) lines += `<li class="won"><span class="mytok star">★</span><span class="info"><b>Winning guess bonus</b><small>You wrote the closest guess</small></span><span class="delta up">+${mine.bonus}</span></li>`;
      if (r.auto && r.auto[S.me.id]) lines += '<li class="note">Unplaced tokens were put on the mat for you.</li>';
    }
    const last = S.round >= S.rounds;
    return `${top('Result')}<main class="phone">
      <div class="card question small">${esc(S.question.text)}</div>
      <div class="answer"><small>Answer</small><b>${fmt(r.answer, S.question)}</b></div>
      <p class="outcome">${outcomeLine(S)}</p>
      ${lines ? `<ul class="betlines">${lines}</ul>` : ''}
      <h3>Standings</h3>${standingsHTML(S, S.me.id)}
      <p class="muted center">${last ? 'Waiting for the host to show final results…' : 'Waiting for the host to start the next question…'}</p>
    </main>`;
  }

  function overScreen() {
    const w = winnersLine(S);
    const iWon = w.winners.some((p) => p.id === S.me.id);
    return `${top('Final')}<main class="phone">
      <div class="card center"><p class="muted">${iWon ? 'You did it!' : 'Game over'}</p><h2 class="wintext">${w.text}</h2><p class="muted">${w.top} chips</p></div>
      <h3>Final standings</h3>${standingsHTML(S, S.me.id)}
      <p class="muted center">The host can start another game.</p>
    </main>`;
  }

  function render() {
    let html;
    if (!S) html = joinScreen();
    else if (S.phase === 'lobby') html = lobbyScreen();
    else if (S.phase === 'guess') html = guessScreen();
    else if (S.phase === 'bet') html = betScreen();
    else if (S.phase === 'reveal') html = revealScreen();
    else html = overScreen();
    paint(app, html);
  }

  // ---------- events ----------
  app.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const kind = ev.target.dataset.form;
    if (kind === 'join') {
      const name = document.getElementById('name').value.trim();
      const codeEl = document.getElementById('code');
      const c = (codeEl ? codeEl.value : code).trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(c)) { error = 'Room codes are 4 letters.'; return render(); }
      try {
        const r = await post(`/api/rooms/${c}/join`, { name });
        code = c; secret = r.secret; error = '';
        store.set('bb:' + code, secret);
        store.set('bb:name', name);
        history.replaceState(null, '', '/j/' + code);
        connect();
      } catch (e) { error = e.message; render(); }
    }
    if (kind === 'guess') {
      const v = document.getElementById('guess').value;
      L.editing = false;
      try { await post(api('action'), { secret, type: 'guess', value: v }); error = ''; } catch (e) { error = e.message; L.editing = true; render(); }
    }
  });

  app.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled || !S) return;
    const act_ = el.dataset.act;
    if (act_ === 'edit') { L.editing = true; error = ''; return render(); }
    if (act_ === 'skip') return act({ type: 'voteSkip', on: !me().skip });
    if (S.phase !== 'bet') return;
    const p = me();
    if (act_ === 'chip') {
      ev.stopPropagation();
      const i = Number(el.dataset.i);
      const room = p.chips - L.bets[1 - i].chips;
      const b = L.bets[i];
      b.chips = el.dataset.d === 'max' ? room : Math.min(room, Math.max(0, b.chips + Number(el.dataset.d)));
      L.active = i;
    } else if (act_ === 'tok') {
      if (L.locked) return;
      L.active = Number(el.dataset.i);
      return render();
    } else if (act_ === 'place') {
      L.bets[L.active].target = el.dataset.t;
      if (!L.bets[1 - L.active].target) L.active = 1 - L.active;
    } else if (act_ === 'lock') {
      if (!L.bets.every((b) => b.target)) return;
      L.locked = true;
    } else if (act_ === 'unlock') {
      L.locked = false;
    } else return;
    render();
    pushBets();
  });

  init();
})();
