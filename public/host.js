'use strict';
// Big-screen UI: lobby with QR code, the question, the betting mat, results.
(() => {
  const app = document.getElementById('app');
  let code = null;
  let hostKey = null;
  let S = null;
  let joinUrl = '';
  let error = '';
  let es = null;

  const save = () => { try { localStorage.setItem('bb:host', JSON.stringify({ code, hostKey })); } catch { /* ignore */ } };
  const load = () => { try { return JSON.parse(localStorage.getItem('bb:host')); } catch { return null; } };

  async function init(fresh) {
    const saved = fresh ? null : load();
    if (saved && saved.code) {
      try { await post(`/api/rooms/${saved.code}/check`, { hostKey: saved.hostKey }); ({ code, hostKey } = saved); } catch { /* room is gone */ }
    }
    if (!code || fresh) {
      ({ code, hostKey } = await post('/api/rooms'));
      save();
    }
    let origin = location.origin;
    if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
      const info = await fetch('/api/info').then((r) => r.json()).catch(() => ({}));
      if (info.lanOrigin) origin = info.lanOrigin;
    }
    joinUrl = `${origin}/j/${code}`;
    connect();
  }

  function connect() {
    if (es) es.close();
    es = new EventSource(`/api/rooms/${code}/events?hostKey=${hostKey}`);
    es.onmessage = (ev) => {
      S = JSON.parse(ev.data);
      clockSkew = S.now - Date.now();
      render();
    };
    es.onerror = async () => {
      try { await post(`/api/rooms/${code}/check`, { hostKey }); } catch (e) {
        if (e.status === 403 || e.status === 404) { es.close(); S = null; init(true); } // server restarted: open a new room
      }
    };
  }

  async function act(data) {
    try { await post(`/api/rooms/${code}/action`, { hostKey, ...data }); error = ''; } catch (e) { error = e.message; render(); }
  }

  const errHTML = () => (error ? `<p class="error">${esc(error)}</p>` : '');
  const qr = () => `/api/qr.svg?text=${encodeURIComponent(joinUrl)}`;
  const shortUrl = () => joinUrl.replace(/^https?:\/\//, '');

  function header(label) {
    return `<header class="hbar">
      <span class="logo sm">Brains <span>&amp;</span> Bets</span>
      <span class="hmid">${S.phase !== 'lobby' && S.phase !== 'over' ? `<span class="pill">Question ${S.round} of ${S.rounds}</span>` : ''}<span class="pill soft">${label}</span>${timerHTML(S)}</span>
      <span class="pill code">Room <b>${S.code}</b></span>
    </header>`;
  }

  function status(done) {
    return `<ul class="chiplist big">${S.players.map((p) => `<li class="${done(p) ? 'done' : ''} ${p.connected ? '' : 'away'}">${dot(p)}${esc(p.name)}<span class="tick">${done(p) ? '✓' : p.connected ? '…' : 'offline'}</span></li>`).join('')}</ul>`;
  }

  function lobby() {
    const n = S.players.length;
    const timers = [[30, '30s'], [60, '60s'], [90, '90s'], [0, 'Off']];
    return `${header('Lobby')}<main class="hmain lobby">
      <section class="card join">
        <img class="qr" src="${qr()}" alt="QR code to join">
        <div><p class="muted">Scan to join, or go to</p><p class="url">${esc(shortUrl())}</p><p class="muted">Room code <b class="bigcode">${S.code}</b></p></div>
      </section>
      <section class="card stack">
        <h2>Players <span class="muted">${n}/7</span></h2>
        ${n ? `<ul class="chiplist big">${S.players.map((p) => `<li class="${p.connected ? '' : 'away'}">${dot(p)}${esc(p.name)}<button class="x" data-act="kick" data-id="${p.id}" title="Remove">×</button></li>`).join('')}</ul>` : '<p class="muted">Waiting for players to scan in…</p>'}
        <div class="setting"><span>Timer per phase</span><div class="seg">${timers.map(([v, l]) => `<button class="${S.settings.timer === v ? 'on' : ''}" data-act="timer" data-v="${v}">${l}</button>`).join('')}</div></div>
        ${errHTML()}
        <button class="btn primary xl" data-act="start" ${n < 2 ? 'disabled' : ''}>${n < 2 ? 'Need at least 2 players' : 'Start game'}</button>
        <details class="rules"><summary>How to play</summary>
          <ol>
            <li>Every answer is a number. Everyone secretly types a guess.</li>
            <li>Guesses line up smallest to largest on the mat. The middle pays 2:1, the edges up to 5:1.</li>
            <li>Bet both of your tokens — on any guess, on <b>All too high</b> (6:1), or on <b>Red</b>/<b>Black</b> (1:1).</li>
            <li>The closest guess <b>without going over</b> wins. Bets on it pay out, and whoever wrote it gets a bonus that grows each round.</li>
            <li>Stack chips you've won under a token to bet bigger. Tokens always come back; stacked chips are lost if the bet loses.</li>
            <li>Don't like a question? Vote to skip it — if more than half the players agree, it's swapped for a new one.</li>
            <li>Most chips after 7 questions wins.</li>
          </ol>
        </details>
      </section>
    </main>`;
  }

  function mat() {
    const r = S.result && !S.result.void ? S.result : null;
    const q = S.question;
    const toks = (t) => S.players.flatMap((p) => S.bets[p.id].filter((b) => b.target === t).map((b) => `<span class="tok" style="background:${p.color}" title="${esc(p.name)}">${1 + b.chips}</span>`)).join('');
    const cell = (t, cls, oddsN, title, sub, win) => `<div class="cell ${cls} ${r ? (win ? 'win' : 'dim') : ''}"><span class="odds">${oddsN}:1</span><b class="val">${title}</b><small>${sub}</small><div class="toks">${toks(t)}</div></div>`;
    let cells = cell('low', 'low', 6, 'All too high', 'every guess is over', r && r.tooHigh);
    for (let pos = -3; pos <= 3; pos++) {
      const s = S.board.find((x) => x.pos === pos);
      if (!s) { cells += '<div class="cell blocked"></div>'; continue; }
      cells += cell('s:' + pos, s.color, s.odds, fmt(s.value, q), esc(playerOf(S, s.playerId).name), r && r.winningPositions.includes(pos));
    }
    return `<div class="hmat">${cells}</div>
      <div class="hsides">
        ${cell('red', 'red side', 1, 'Red', 'winner on a red space', r && r.winningColors.includes('red'))}
        ${cell('black', 'black side', 1, 'Black', 'winner on a black space', r && r.winningColors.includes('black'))}
      </div>`;
  }

  function guess() {
    return `${header('Guessing')}<main class="hmain">
      ${S.skipped ? '<p class="notice">Question skipped by vote — here\'s a new one.</p>' : ''}
      <div class="card hq">${esc(S.question.text)}</div>
      <p class="hhint">Type your guess on your phone. Closest <b>without going over</b> wins · Bonus this round: <b>${S.bonus}</b></p>
      ${status((p) => p.guessed)}
      <p class="hhint">Skip votes: <b>${S.players.filter((p) => p.skip).length} of ${S.skipNeeded}</b> needed · vote on your phone</p>
      <div class="hactions">${errHTML()}<button class="btn ghost" data-act="skip">Close guessing</button></div>
    </main>`;
  }

  function bet() {
    return `${header('Betting')}<main class="hmain">
      <div class="card hq sm">${esc(S.question.text)}</div>
      ${mat()}
      ${status((p) => p.locked)}
      <div class="hactions">${errHTML()}<button class="btn ghost" data-act="skip">Close betting</button></div>
    </main>`;
  }

  function reveal() {
    const last = S.round >= S.rounds;
    return `${header('Result')}<main class="hmain">
      <div class="card hq sm">${esc(S.question.text)}</div>
      <div class="hanswer"><small>Answer</small><b>${fmt(S.result.answer, S.question)}</b><p class="outcome">${outcomeLine(S)}</p></div>
      ${S.board ? mat() : ''}
      <div class="hsplit">${standingsHTML(S)}<div class="hactions">${errHTML()}<button class="btn primary xl" data-act="next">${last ? 'Final results' : 'Next question'}</button></div></div>
    </main>`;
  }

  function over() {
    const w = winnersLine(S);
    return `${header('Final')}<main class="hmain narrow">
      <div class="card center"><p class="muted">After ${S.rounds} questions</p><h1 class="wintext">${w.text}</h1><p class="muted">${w.top} chips</p></div>
      ${standingsHTML(S)}
      <div class="hactions">${errHTML()}<button class="btn primary xl" data-act="again">Play again</button></div>
    </main>`;
  }

  function render() {
    if (!S) return paint(app, '<main class="hmain center"><p class="muted">Setting up your room…</p></main>');
    paint(app, { lobby, guess, bet, reveal, over }[S.phase]());
  }

  app.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const a = el.dataset.act;
    if (a === 'timer') act({ type: 'settings', timer: Number(el.dataset.v) });
    else if (a === 'kick') act({ type: 'kick', id: el.dataset.id });
    else act({ type: a });
  });

  render();
  init().catch((e) => paint(app, `<main class="hmain center"><p class="error">${esc(e.message)}</p></main>`));
})();
