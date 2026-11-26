'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Room, GameError } = require('./src/room');
const questions = require('./src/questions.json');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const ROOM_TTL = 6 * 60 * 60 * 1000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O

const rooms = new Map(); // code -> Room
const conns = new Map(); // code -> Set<{ res, player|null }>

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return null;
}

function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

function broadcast(room) {
  const set = conns.get(room.code);
  if (!set) return;
  for (const c of [...set]) {
    if (c.player && !room.players.includes(c.player)) { // removed by the host
      c.res.write(`data: ${JSON.stringify({ kicked: true })}\n\n`);
      c.res.end();
      set.delete(c);
      continue;
    }
    c.res.write(`data: ${JSON.stringify(room.view(c.player))}\n\n`);
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10000) { reject(new GameError('Request too large.')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new GameError('Bad request.')); }
    });
    req.on('error', reject);
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function serveFile(res, name) {
  const file = path.join(PUBLIC, name);
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 404, { error: 'Not found.' });
  fs.readFile(file, (err, buf) => {
    if (err) return json(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'GET') {
    if (p === '/' || /^\/j\/[A-Za-z]{4}$/.test(p)) return serveFile(res, 'index.html');
    if (p === '/host') return serveFile(res, 'host.html');
    if (p === '/api/info') {
      const ip = lanAddress();
      return json(res, 200, { lanOrigin: ip ? `http://${ip}:${PORT}` : null });
    }
    if (p === '/api/qr.svg') {
      const text = url.searchParams.get('text') || '';
      if (!text || text.length > 300) return json(res, 400, { error: 'Bad QR text.' });
      const svg = await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#15171a', light: '#ffffff' } });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      return res.end(svg);
    }
  }

  if (req.method === 'POST' && p === '/api/rooms') {
    const room = new Room(newCode(), questions);
    room.onChange = () => broadcast(room);
    rooms.set(room.code, room);
    return json(res, 200, { code: room.code, hostKey: room.hostKey });
  }

  const m = p.match(/^\/api\/rooms\/([A-Za-z]{4})\/(check|join|action|events)$/);
  if (m) {
    const room = rooms.get(m[1].toUpperCase());
    if (!room) return json(res, 404, { error: "Can't find that room. Check the code." });
    const verb = m[2];

    if (verb === 'events' && req.method === 'GET') {
      const isHost = url.searchParams.get('hostKey') === room.hostKey;
      const player = room.bySecret(url.searchParams.get('secret'));
      if (!isHost && !player) return json(res, 403, { error: 'Not in this room.' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      });
      res.write('retry: 1000\n\n');
      const c = { res, player: player || null };
      if (!conns.has(room.code)) conns.set(room.code, new Set());
      conns.get(room.code).add(c);
      if (player) player.conns++;
      req.on('close', () => {
        const set = conns.get(room.code);
        if (set) set.delete(c);
        if (player) player.conns = Math.max(0, player.conns - 1);
        if (rooms.get(room.code) === room) room.changed();
      });
      return room.changed(); // sends everyone (including this client) fresh state
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (verb === 'check') { // is a saved session still valid?
        const ok = body.hostKey ? body.hostKey === room.hostKey : !!room.bySecret(body.secret);
        return json(res, ok ? 200 : 403, ok ? { ok: true } : { error: 'Session expired.' });
      }
      if (verb === 'join') {
        const player = room.join(body.name);
        return json(res, 200, { secret: player.secret });
      }
      if (verb === 'action') {
        if (body.hostKey !== undefined) {
          if (body.hostKey !== room.hostKey) return json(res, 403, { error: 'Not the host.' });
          room.host(body);
        } else {
          const player = room.bySecret(body.secret);
          if (!player) return json(res, 403, { error: 'Not in this room.' });
          room.player(player, body);
        }
        return json(res, 200, { ok: true });
      }
    }
  }

  if (req.method === 'GET' && /^\/[\w.-]+\.(js|css|svg)$/.test(p)) return serveFile(res, p.slice(1));
  json(res, 404, { error: 'Not found.' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (res.headersSent) return res.end();
    if (err instanceof GameError) return json(res, 400, { error: err.message });
    console.error(err);
    json(res, 500, { error: 'Server error.' });
  });
});

// Keep phone connections alive, and sweep rooms nobody has touched in a while.
setInterval(() => {
  for (const set of conns.values()) for (const c of set) c.res.write(': ping\n\n');
  for (const [code, room] of rooms) {
    if (Date.now() - room.touched > ROOM_TTL) {
      room.destroy();
      for (const c of conns.get(code) || []) c.res.end();
      conns.delete(code);
      rooms.delete(code);
    }
  }
}, 15000).unref();

server.listen(PORT, '0.0.0.0', () => {
  const ip = lanAddress();
  console.log('\n  Brains & Bets is running.\n');
  console.log(`  Host screen (open on the big screen):  http://localhost:${PORT}/host`);
  if (ip) console.log(`  Players on the same Wi-Fi:             http://${ip}:${PORT}`);
  console.log('');
});
