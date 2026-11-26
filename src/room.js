'use strict';
// One game room: players, phases, timers. Server-authoritative.
const crypto = require('crypto');
const G = require('./game');

const PLAYER_COLORS = ['#2563eb', '#d97706', '#059669', '#9333ea', '#db2777', '#0891b2', '#65a30d'];
const TIMER_CHOICES = [0, 30, 60, 90];
const MAX_GUESS = 1e15;

const token = () => crypto.randomBytes(16).toString('hex');

class GameError extends Error {}

class Room {
  constructor(code, questions) {
    this.code = code;
    this.hostKey = token();
    this.questions = questions;
    this.used = new Set();
    this.players = [];
    this.phase = 'lobby'; // lobby -> guess -> bet -> reveal -> (guess | over)
    this.round = 0;
    this.deck = [];
    this.board = null;
    this.result = null;
    this.deadline = null;
    this.timer = null;
    this.settings = { timer: 30 };
    this.seq = 0;
    this.touched = Date.now();
    this.onChange = null;
  }

  changed() {
    this.touched = Date.now();
    if (this.onChange) this.onChange();
  }

  bySecret(secret) {
    return typeof secret === 'string' ? this.players.find((p) => p.secret === secret) : undefined;
  }

  join(rawName) {
    if (this.phase !== 'lobby') throw new GameError('That game has already started.');
    if (this.players.length >= G.MAX_PLAYERS) throw new GameError(`Room is full (${G.MAX_PLAYERS} players max).`);
    let name = String(rawName || '').replace(/\s+/g, ' ').trim().slice(0, 14);
    if (!name) throw new GameError('Enter a name to join.');
    const taken = (n) => this.players.some((p) => p.name.toLowerCase() === n.toLowerCase());
    if (taken(name)) {
      let i = 2;
      while (taken(`${name} ${i}`)) i++;
      name = `${name} ${i}`;
    }
    const color = PLAYER_COLORS.find((c) => !this.players.some((p) => p.color === c));
    const p = { id: token().slice(0, 8), secret: token(), name, color, chips: 0, conns: 0, guess: null, guessAt: 0, bets: null, locked: false };
    this.players.push(p);
    this.changed();
    return p;
  }

  // ---- host actions ----
  host(msg) {
    switch (msg.type) {
      case 'settings': {
        if (this.phase !== 'lobby') throw new GameError('Settings can only change in the lobby.');
        const t = Number(msg.timer);
        if (!TIMER_CHOICES.includes(t)) throw new GameError('Invalid timer.');
        this.settings.timer = t;
        break;
      }
      case 'kick': {
        if (this.phase !== 'lobby') throw new GameError('Players can only be removed in the lobby.');
        this.players = this.players.filter((p) => p.id !== msg.id);
        break;
      }
      case 'start': {
        if (this.phase !== 'lobby') throw new GameError('The game has already started.');
        if (this.players.length < G.MIN_PLAYERS) throw new GameError(`You need at least ${G.MIN_PLAYERS} players.`);
        this.start();
        return;
      }
      case 'skip': {
        if (this.phase === 'guess') return this.closeGuess();
        if (this.phase === 'bet') return this.closeBet();
        throw new GameError('Nothing to close right now.');
      }
      case 'next': {
        if (this.phase !== 'reveal') throw new GameError('Not ready for the next question yet.');
        if (this.round + 1 >= G.ROUNDS) this.phase = 'over';
        else { this.round++; return this.beginGuess(); }
        break;
      }
      case 'again': {
        if (this.phase !== 'over') throw new GameError('The game is not over yet.');
        this.phase = 'lobby';
        this.round = 0;
        this.board = this.result = null;
        for (const p of this.players) p.chips = 0;
        break;
      }
      default:
        throw new GameError('Unknown action.');
    }
    this.changed();
  }

  // ---- player actions ----
  player(p, msg) {
    if (msg.type === 'guess') return this.submitGuess(p, msg.value);
    if (msg.type === 'bets') return this.setBets(p, msg.bets, msg.locked);
    throw new GameError('Unknown action.');
  }

  start() {
    let pool = this.questions.map((_, i) => i).filter((i) => !this.used.has(i));
    if (pool.length < G.ROUNDS) { this.used.clear(); pool = this.questions.map((_, i) => i); }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.deck = pool.slice(0, G.ROUNDS);
    this.deck.forEach((i) => this.used.add(i));
    for (const p of this.players) p.chips = 0;
    this.round = 0;
    this.beginGuess();
  }

  get question() { return this.questions[this.deck[this.round]]; }

  setTimer(fn) {
    clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
    if (fn && this.settings.timer > 0) {
      this.deadline = Date.now() + this.settings.timer * 1000;
      this.timer = setTimeout(fn, this.settings.timer * 1000 + 400); // small grace for slow phones
    }
  }

  beginGuess() {
    this.phase = 'guess';
    this.board = this.result = null;
    for (const p of this.players) { p.guess = null; p.bets = null; p.locked = false; }
    this.setTimer(() => this.closeGuess());
    this.changed();
  }

  submitGuess(p, raw) {
    if (this.phase !== 'guess') throw new GameError('Guessing is closed.');
    const text = String(raw == null ? '' : raw).replace(/[,\s]/g, '');
    if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) throw new GameError('Enter a number.');
    const value = Number(text);
    if (!Number.isFinite(value) || value > MAX_GUESS) throw new GameError('That number is too big.');
    p.guess = value;
    p.guessAt = ++this.seq;
    if (this.players.every((q) => q.guess !== null)) return this.closeGuess();
    this.changed();
  }

  closeGuess() {
    if (this.phase !== 'guess') return;
    const guesses = this.players
      .filter((p) => p.guess !== null)
      .sort((a, b) => a.guessAt - b.guessAt)
      .map((p) => ({ playerId: p.id, value: p.guess }));
    if (!guesses.length) { // nobody answered: void round, nothing changes hands
      this.setTimer(null);
      this.phase = 'reveal';
      this.result = { void: true, answer: this.question.a, players: {} };
      return this.changed();
    }
    this.board = G.layoutBoard(guesses);
    this.phase = 'bet';
    for (const p of this.players) {
      p.bets = [{ target: null, chips: 0 }, { target: null, chips: 0 }];
      p.locked = false;
    }
    this.setTimer(() => this.closeBet());
    this.changed();
  }

  setBets(p, bets, locked) {
    if (this.phase !== 'bet') throw new GameError('Betting is closed.');
    if (!Array.isArray(bets) || bets.length !== 2) throw new GameError('Invalid bets.');
    let total = 0;
    const clean = bets.map((b) => {
      const target = b && b.target != null ? b.target : null;
      if (target !== null && G.targetOdds(this.board, target) === null) throw new GameError("You can't bet there.");
      const chips = target === null ? 0 : Number(b.chips || 0);
      if (!Number.isInteger(chips) || chips < 0) throw new GameError('Invalid chip amount.');
      total += chips;
      return { target, chips };
    });
    if (total > p.chips) throw new GameError("You don't have that many chips.");
    if (locked && clean.some((b) => b.target === null)) throw new GameError('Place both tokens first.');
    p.bets = clean;
    p.locked = !!locked;
    if (this.players.every((q) => q.locked)) return this.closeBet();
    this.changed();
  }

  closeBet() {
    if (this.phase !== 'bet') return;
    this.setTimer(null);
    const bets = {};
    const auto = {};
    for (const p of this.players) {
      // Both tokens must be bet every round — place any that were left off the mat.
      bets[p.id] = p.bets.map((b) => {
        if (b.target !== null) return b;
        auto[p.id] = true;
        return { target: G.defaultTarget(this.board, p.id), chips: 0 };
      });
      p.bets = bets[p.id];
      p.locked = true;
    }
    this.result = G.settle(this.board, this.question.a, bets, G.BONUS[this.round]);
    this.result.auto = auto;
    for (const p of this.players) p.chips += this.result.players[p.id].delta;
    this.phase = 'reveal';
    this.changed();
  }

  // What one client is allowed to see. `me` is a player, or null for the host screen.
  view(me) {
    const live = this.phase === 'guess' || this.phase === 'bet' || this.phase === 'reveal';
    const mat = this.phase === 'bet' || this.phase === 'reveal';
    const q = live ? this.question : null;
    return {
      code: this.code,
      phase: this.phase,
      round: this.round + 1,
      rounds: G.ROUNDS,
      bonus: G.BONUS[this.round],
      now: Date.now(),
      deadline: this.deadline,
      settings: this.settings,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, color: p.color, chips: p.chips,
        connected: p.conns > 0, guessed: p.guess !== null, locked: p.locked,
      })),
      question: q ? { text: q.q, year: !!q.year } : null,
      board: mat ? this.board : null,
      bets: mat && this.board ? Object.fromEntries(this.players.map((p) => [p.id, p.bets])) : null,
      result: this.phase === 'reveal' ? this.result : null,
      me: me ? { id: me.id, guess: live ? me.guess : null } : null,
    };
  }

  destroy() { clearTimeout(this.timer); }
}

module.exports = { Room, GameError, TIMER_CHOICES };
