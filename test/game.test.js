'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/game');
const { Room, GameError } = require('../src/room');

const board = (...values) => G.layoutBoard(values.map((value, i) => ({ playerId: 'p' + i, value })));

test('mat positions per guess count (blockers)', () => {
  assert.deepEqual(G.positionsFor(7), [-3, -2, -1, 0, 1, 2, 3]);
  assert.deepEqual(G.positionsFor(6), [-3, -2, -1, 1, 2, 3]); // 2:1 blocked
  assert.deepEqual(G.positionsFor(5), [-2, -1, 0, 1, 2]); // both 5:1 blocked
  assert.deepEqual(G.positionsFor(2), [-1, 1]);
  assert.deepEqual(G.positionsFor(1), [0]);
});

test('guesses sort smallest to largest with the right odds', () => {
  const b = board(500, 20, 300, 100, 400);
  assert.deepEqual(b.map((s) => s.value), [20, 100, 300, 400, 500]);
  assert.deepEqual(b.map((s) => s.odds), [4, 3, 2, 3, 4]);
  assert.deepEqual(board(1, 2, 3, 4, 5, 6, 7).map((s) => s.odds), [5, 4, 3, 2, 3, 4, 5]);
  assert.deepEqual(board(1, 2, 3, 4, 5, 6).map((s) => s.odds), [5, 4, 3, 3, 4, 5]);
});

test('red and black are balanced on an even mat', () => {
  const colors = board(1, 2, 3, 4, 5, 6).map((s) => s.color);
  assert.equal(colors.filter((c) => c === 'red').length, 3);
});

test('closest without going over wins', () => {
  const b = board(100, 200, 300);
  assert.deepEqual(G.findWinners(b, 250).positions, [0]);
  assert.deepEqual(G.findWinners(b, 300).positions, [1]); // exact counts
  assert.deepEqual(G.findWinners(b, 9999).positions, [1]);
  assert.equal(G.findWinners(b, 99).tooHigh, true);
});

test('duplicate winning guesses: every space pays, each author gets the bonus', () => {
  const b = board(50, 50, 80); // p0@-1 (3:1), p1@0 (2:1), p2@1
  const r = G.settle(b, 60, {
    p0: [{ target: 's:-1', chips: 0 }, { target: 's:0', chips: 0 }],
    p1: [{ target: 's:1', chips: 0 }, { target: 'low', chips: 0 }],
    p2: [{ target: 'red', chips: 0 }, { target: 'black', chips: 0 }],
  }, 4);
  assert.deepEqual(r.winningPositions, [-1, 0]);
  assert.equal(r.players.p0.delta, 3 + 2 + 4);
  assert.equal(r.players.p1.delta, 4); // bonus only
  assert.equal(r.players.p2.delta, 2); // winning guess sits on a red and a black space
});

test('payout math: tokens are never lost, stacked chips are', () => {
  const b = board(10, 20, 30, 40, 50); // 20 sits at -1 (3:1, red)
  const r = G.settle(b, 25, {
    p0: [{ target: 's:-1', chips: 2 }, { target: 's:2', chips: 3 }],
    p1: [{ target: 'red', chips: 4 }, { target: 'black', chips: 1 }],
  }, 3);
  assert.equal(r.players.p0.bets[0].delta, 9); // (1 + 2) x 3
  assert.equal(r.players.p0.bets[1].delta, -3);
  assert.equal(r.players.p0.delta, 6);
  assert.equal(r.players.p1.delta, 5 - 1 + 3); // red wins 1:1, black loses, p1 wrote 20
});

test('all guesses too high: only the 6:1 space pays, no bonus, no color', () => {
  const b = board(389, 400, 500);
  const r = G.settle(b, 380, {
    p0: [{ target: 'low', chips: 1 }, { target: 's:-1', chips: 0 }],
    p1: [{ target: 'red', chips: 0 }, { target: 'black', chips: 0 }],
  }, 5);
  assert.equal(r.tooHigh, true);
  assert.equal(r.players.p0.delta, 12);
  assert.equal(r.players.p1.delta, 0);
  assert.deepEqual(r.winnerIds, []);
});

test('bet targets: only occupied spaces, the 6:1 space, and colors', () => {
  const b = board(1, 2, 3, 4, 5);
  assert.equal(G.targetOdds(b, 's:3'), null); // blocked with 5 guesses
  assert.equal(G.targetOdds(b, 's:2'), 4);
  assert.equal(G.targetOdds(b, 'low'), 6);
  assert.equal(G.targetOdds(b, 'red'), 1);
  assert.equal(G.targetOdds(b, 'nope'), null);
  assert.equal(G.targetOdds(b, { evil: 1 }), null);
});

function newRoom(n = 3) {
  const qs = Array.from({ length: 10 }, (_, i) => ({ q: 'Q' + i, a: 100 }));
  const room = new Room('TEST', qs);
  room.settings.timer = 0;
  const players = Array.from({ length: n }, (_, i) => room.join('P' + i));
  return { room, players };
}

test('a full game runs 7 rounds and tracks chips', () => {
  const { room, players: [a, b, c] } = newRoom();
  room.host({ type: 'start' });
  for (let round = 1; round <= 7; round++) {
    assert.equal(room.phase, 'guess');
    assert.equal(room.view(a).board, null); // guesses stay hidden
    room.player(a, { type: 'guess', value: '90' });
    room.player(b, { type: 'guess', value: '1,000' });
    room.player(c, { type: 'guess', value: '50.5' });
    assert.equal(room.phase, 'bet');
    assert.deepEqual(room.board.map((s) => s.value), [50.5, 90, 1000]);
    const allIn = a.chips;
    room.player(a, { type: 'bets', bets: [{ target: 's:0', chips: allIn }, { target: 'black', chips: 0 }], locked: true });
    room.player(b, { type: 'bets', bets: [{ target: 's:1', chips: 0 }, { target: 'low', chips: 0 }], locked: true });
    assert.throws(() => room.player(c, { type: 'bets', bets: [{ target: 's:0', chips: c.chips + 1 }, { target: 'red', chips: 0 }], locked: true }), GameError);
    assert.throws(() => room.player(c, { type: 'bets', bets: [{ target: 's:3', chips: 0 }, { target: 'red', chips: 0 }], locked: true }), GameError);
    room.host({ type: 'skip' }); // c never placed tokens -> auto-placed on own guess
    assert.equal(room.phase, 'reveal');
    assert.equal(room.result.auto[c.id], true);
    assert.equal(room.result.players[a.id].delta, (1 + allIn) * 2 + 1 + round);
    assert.equal(room.result.players[b.id].delta, 0);
    assert.equal(room.result.players[c.id].delta, 0);
    room.host({ type: 'next' });
  }
  assert.equal(room.phase, 'over');
  assert.ok(a.chips > 0 && b.chips === 0);
  room.host({ type: 'again' });
  assert.equal(room.phase, 'lobby');
  assert.equal(a.chips, 0);
});

test('room rules: joins, bad guesses, void rounds', () => {
  const { room, players: [a] } = newRoom(2);
  assert.equal(room.join('p0').name, 'p0 2'); // duplicate names get a suffix
  assert.throws(() => room.join('   '), GameError);
  room.host({ type: 'start' });
  assert.throws(() => room.join('Late'), GameError);
  for (const bad of ['', 'abc', '-5', '1e9', '1.2.3']) assert.throws(() => room.player(a, { type: 'guess', value: bad }), GameError);
  room.host({ type: 'skip' }); // nobody guessed
  assert.equal(room.phase, 'reveal');
  assert.equal(room.result.void, true);
});

test('vote to skip needs more than half the players', () => {
  const { room, players: [a, b, c, d] } = newRoom(4);
  room.host({ type: 'start' });
  const first = room.question;
  room.player(a, { type: 'guess', value: '5' });
  room.player(a, { type: 'voteSkip', on: true });
  room.player(b, { type: 'voteSkip', on: true });
  assert.equal(room.question, first); // 2 of 4 is not a majority
  assert.equal(room.view(c).skipNeeded, 3);
  room.player(b, { type: 'voteSkip', on: false }); // votes can be withdrawn
  room.player(c, { type: 'voteSkip', on: true });
  assert.equal(room.question, first);
  room.player(d, { type: 'voteSkip', on: true });
  assert.notEqual(room.question, first);
  assert.equal(room.phase, 'guess');
  assert.equal(room.round, 0); // same round number
  assert.equal(a.guess, null); // guesses reset for the new question
  assert.ok(room.players.every((p) => !p.skip));
  assert.equal(room.view(a).skipped, true);
  assert.equal(new Set(room.deck).size, 7); // replacement is never a repeat
  for (const p of [a, b, c, d]) room.player(p, { type: 'guess', value: '1' });
  assert.throws(() => room.player(a, { type: 'voteSkip', on: true }), GameError); // not during betting
  const two = newRoom(2).room;
  assert.equal(two.skipNeeded, 2);
  assert.equal(newRoom(7).room.skipNeeded, 4);
});

test('room caps at 7 players and needs 2 to start', () => {
  const { room } = newRoom(7);
  assert.throws(() => room.join('Eighth'), GameError);
  const solo = newRoom(1).room;
  assert.throws(() => solo.host({ type: 'start' }), GameError);
});

test('every question has a sane numeric answer', () => {
  const qs = require('../src/questions.json');
  assert.ok(qs.length >= 200);
  assert.equal(new Set(qs.map((q) => q.q)).size, qs.length);
  for (const q of qs) assert.ok(typeof q.q === 'string' && Number.isFinite(q.a) && q.a >= 0, q.q);
});
