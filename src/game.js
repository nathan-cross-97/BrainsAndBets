'use strict';
// Pure game rules. No I/O, no timers — everything here is unit tested.

const ROUNDS = 7;
const MAX_PLAYERS = 7;
const MIN_PLAYERS = 2;

// Mat positions run -3..3 around the middle space (0).
const ODDS = { 0: 2, 1: 3, 2: 4, 3: 5 }; // keyed by distance from the middle
const TOO_HIGH_ODDS = 6;
const COLOR_ODDS = 1;
const COLOR = { '-3': 'red', '-2': 'black', '-1': 'red', '0': 'black', '1': 'black', '2': 'red', '3': 'black' };

// Bonus paid to whoever wrote the winning guess, per round.
const BONUS = [1, 2, 3, 4, 5, 6, 7];

// Which mat positions are open for k guesses. Guesses fill outward from the
// middle: an odd count uses the middle space, an even count leaves it blocked.
// (5 guesses -> both 5:1 spaces blocked, 6 -> the 2:1 space blocked, 7 -> none.)
function positionsFor(k) {
  const out = [];
  const h = Math.floor(k / 2);
  for (let i = 0 - h; i <= h; i++) if (i !== 0 || k % 2 === 1) out.push(i + 0);
  return out;
}

// guesses: [{ playerId, value }] in the order they were submitted.
// Every guess gets its own space, smallest on the left. Equal guesses sit side by side.
function layoutBoard(guesses) {
  const sorted = guesses
    .map((g, i) => ({ ...g, i }))
    .sort((a, b) => a.value - b.value || a.i - b.i);
  const pos = positionsFor(sorted.length);
  return sorted.map((g, i) => ({
    pos: pos[i],
    odds: ODDS[Math.abs(pos[i])],
    color: COLOR[pos[i]],
    value: g.value,
    playerId: g.playerId,
  }));
}

// Closest guess without going over. Every space holding that guess wins.
function findWinners(board, answer) {
  let best = null;
  for (const s of board) if (s.value <= answer && (best === null || s.value > best)) best = s.value;
  if (best === null) return { tooHigh: true, value: null, positions: [], colors: [], playerIds: [] };
  const w = board.filter((s) => s.value === best);
  return {
    tooHigh: false,
    value: best,
    positions: w.map((s) => s.pos),
    colors: [...new Set(w.map((s) => s.color))],
    playerIds: w.map((s) => s.playerId),
  };
}

// Odds for a bet target, or null if you can't bet there.
// Targets: 'low' (all guesses too high), 'red', 'black', or 's:<pos>' for a space holding a guess.
function targetOdds(board, target) {
  if (target === 'low') return TOO_HIGH_ODDS;
  if (target === 'red' || target === 'black') return COLOR_ODDS;
  if (typeof target !== 'string' || !/^s:-?[0-3]$/.test(target)) return null;
  const pos = Number(target.slice(2));
  const space = board.find((s) => s.pos === pos);
  return space ? space.odds : null;
}

function betWins(target, win) {
  if (target === 'low') return win.tooHigh;
  if (target === 'red' || target === 'black') return win.colors.includes(target);
  return win.positions.includes(Number(target.slice(2)));
}

// Where a token goes if its owner never placed it: their own guess,
// otherwise the open space nearest the middle.
function defaultTarget(board, playerId) {
  const own = board.find((s) => s.playerId === playerId);
  if (own) return 's:' + own.pos;
  const mid = [...board].sort((a, b) => Math.abs(a.pos) - Math.abs(b.pos) || a.pos - b.pos)[0];
  return 's:' + mid.pos;
}

// bets: { [playerId]: [{ target, chips }, { target, chips }] } — all targets must be set.
// Each token is worth 1 and is never lost; chips stacked under it are at risk.
// A winning bet pays (1 + chips) x odds and keeps its chips. A losing bet loses its chips.
function settle(board, answer, bets, bonus) {
  const win = findWinners(board, answer);
  const players = {};
  for (const [pid, pair] of Object.entries(bets)) {
    const lines = pair.map((b) => {
      const odds = targetOdds(board, b.target);
      const stake = 1 + b.chips;
      const won = betWins(b.target, win);
      return { target: b.target, chips: b.chips, stake, odds, won, delta: won ? stake * odds : -b.chips };
    });
    const got = win.playerIds.includes(pid) ? bonus : 0;
    players[pid] = { bets: lines, bonus: got, delta: lines.reduce((n, l) => n + l.delta, 0) + got };
  }
  return { answer, tooHigh: win.tooHigh, winningValue: win.value, winningPositions: win.positions, winningColors: win.colors, winnerIds: win.playerIds, bonus, players };
}

module.exports = {
  ROUNDS, MAX_PLAYERS, MIN_PLAYERS, ODDS, TOO_HIGH_ODDS, COLOR_ODDS, COLOR, BONUS,
  positionsFor, layoutBoard, findWinners, targetOdds, betWins, defaultTarget, settle,
};
