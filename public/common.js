'use strict';
// Helpers shared by the host screen and the phone UI.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Years read better without a thousands separator.
const fmt = (v, q) => (q && q.year ? String(v) : Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 }));

async function post(url, data) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Something went wrong.'); e.status = r.status; throw e; }
  return j;
}

// Countdown: any element with [data-deadline] ticks down against the server's clock.
let clockSkew = 0;
function tickTimers() {
  document.querySelectorAll('[data-deadline]').forEach((el) => {
    const left = Math.max(0, Math.ceil((Number(el.dataset.deadline) - (Date.now() + clockSkew)) / 1000));
    el.textContent = left;
    el.classList.toggle('low', left <= 5);
  });
}
setInterval(tickTimers, 200);
const timerHTML = (S) => (S.deadline ? `<span class="timer" data-deadline="${S.deadline}"></span>` : '');

// Re-render without losing what someone is typing.
function paint(el, html) {
  const a = document.activeElement;
  const keep = a && a.id && el.contains(a) ? { id: a.id, value: a.value, start: a.selectionStart, end: a.selectionEnd } : null;
  el.innerHTML = html;
  if (keep) {
    const n = document.getElementById(keep.id);
    if (n) {
      n.value = keep.value;
      n.focus();
      try { n.setSelectionRange(keep.start, keep.end); } catch { /* not a text field */ }
    }
  }
  tickTimers();
}

const playerOf = (S, id) => S.players.find((p) => p.id === id);
const dot = (p) => `<i class="dot" style="background:${p.color}"></i>`;

function targetLabel(S, t) {
  if (t === 'low') return 'All too high';
  if (t === 'red') return 'Red';
  if (t === 'black') return 'Black';
  const s = S.board.find((x) => 's:' + x.pos === t);
  return s ? fmt(s.value, S.question) : '—';
}

function standingsHTML(S, meId) {
  const res = S.phase === 'reveal' && S.result ? S.result.players : null;
  const rows = [...S.players].sort((a, b) => b.chips - a.chips);
  return `<ol class="standings">${rows.map((p) => {
    const d = res && res[p.id] ? res[p.id].delta : null;
    const delta = d === null ? '' : `<span class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d}</span>`;
    const rank = 1 + rows.filter((o) => o.chips > p.chips).length;
    return `<li class="${p.id === meId ? 'me' : ''}"><span class="rank">${rank}</span>${dot(p)}<span class="name">${esc(p.name)}${p.id === meId ? ' <em>you</em>' : ''}</span>${delta}<span class="chips">${p.chips}</span></li>`;
  }).join('')}</ol>`;
}

function winnersLine(S) {
  const top = Math.max(...S.players.map((p) => p.chips));
  const w = S.players.filter((p) => p.chips === top);
  const names = w.map((p) => esc(p.name));
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1] : names[0];
  return { winners: w, text: w.length > 1 ? `${list} tie for the win` : `${list} wins`, top };
}

// One-line summary of how the round resolved.
function outcomeLine(S) {
  const r = S.result;
  if (r.void) return 'Nobody guessed — no chips change hands.';
  if (r.tooHigh) return 'Every guess was too high. Only <b>All too high</b> pays, 6 to 1.';
  const who = r.winnerIds.map((id) => esc(playerOf(S, id).name)).join(' & ');
  return `Closest without going over: <b>${fmt(r.winningValue, S.question)}</b> by ${who} · +${r.bonus} bonus${r.winnerIds.length > 1 ? ' each' : ''}`;
}
