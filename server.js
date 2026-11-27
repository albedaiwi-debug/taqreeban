// تقريباً — Arabic Fermi-style estimation party game
// One Node server: serves the host screen + phone screens and runs every game live over Socket.io.
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { scoreGuess, missPenalty, average } = require('./lib/scoring');

const PORT = process.env.PORT || 3000;
const QUESTIONS_PER_ROUND = 10;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // drop rooms idle for 6 hours
const MAX_PLAYERS = 40;

const TEAM_PRESETS = [
  { name: 'الصقور', color: '#e4572e' },
  { name: 'النمور', color: '#2e86de' },
  { name: 'الذئاب', color: '#17a589' },
  { name: 'النسور', color: '#a55eea' },
  { name: 'الفهود', color: '#f5a623' },
  { name: 'الأسود', color: '#e84393' },
];

function loadQuestions() {
  const file = path.join(__dirname, 'data', 'questions.json');
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  return all.filter((q) => q.verified && q.answer > 0);
}
let QUESTIONS = loadQuestions();
console.log(`Loaded ${QUESTIONS.length} verified questions`);

const app = express();
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/fonts', express.static(path.join(__dirname, 'node_modules/@fontsource/ibm-plex-sans-arabic/files'), { maxAge: '30d' }));
app.get('/', (req, res) => res.redirect('/host'));

function publicBase(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

app.get('/qr/:code.svg', async (req, res) => {
  const code = String(req.params.code).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  const url = `${publicBase(req)}/play?r=${code}`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
});
app.get('/api/join-url/:code', (req, res) => {
  const code = String(req.params.code).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  res.json({ url: `${publicBase(req)}/play?r=${code}`, base: publicBase(req) });
});
app.get('/healthz', (req, res) => res.send('ok'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });

/** @type {Map<string, any>} */
const rooms = new Map();

const rid = (n = 16) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
// Letters only, no look-alikes (I/O), easy to read out loud.
function newRoomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do code = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
  while (rooms.has(code));
  return code;
}

function pickQuestions(room) {
  let pool = QUESTIONS.filter((q) => !room.usedIds.has(q.id));
  if (pool.length < QUESTIONS_PER_ROUND) {
    room.usedIds.clear();
    pool = QUESTIONS.slice();
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, QUESTIONS_PER_ROUND);
  picked.forEach((q) => room.usedIds.add(q.id));
  return picked;
}

function makeTeams(count) {
  return TEAM_PRESETS.slice(0, count).map((t, i) => ({ id: `t${i + 1}`, ...t }));
}

function createRoom() {
  const room = {
    code: newRoomCode(),
    hostToken: rid(),
    hostSockets: new Set(),
    settings: { mode: 'solo', timer: 30, teamCount: 2 },
    teams: makeTeams(2),
    players: new Map(),
    questions: [],
    qIndex: -1,
    phase: 'lobby', // lobby | ready | question | reveal | leaderboard | final
    guesses: new Map(), // playerId -> number (current question)
    participants: new Set(), // players expected to answer the current question
    history: [], // per question: { results: Map(playerId -> {guess, multiple, missed}) , teamScores }
    endsAt: 0,
    timer: null,
    usedIds: new Set(),
    lastActive: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

const connectedPlayers = (room) => [...room.players.values()].filter((p) => p.sockets.size > 0);

// ---------- scoring ----------
function finalizeQuestion(room) {
  const q = room.questions[room.qIndex];
  const results = new Map();
  for (const pid of room.participants) {
    if (room.guesses.has(pid)) {
      const g = room.guesses.get(pid);
      results.set(pid, { guess: g, multiple: scoreGuess(g, q.answer), missed: false });
    }
  }
  const penalty = missPenalty([...results.values()].map((r) => r.multiple));
  for (const pid of room.participants) {
    if (!results.has(pid)) results.set(pid, { guess: null, multiple: penalty, missed: true });
  }
  const teamScores = {};
  if (room.settings.mode === 'team') {
    for (const t of room.teams) {
      const ms = [...results.entries()].filter(([pid]) => room.players.get(pid)?.teamId === t.id).map(([, r]) => r.multiple);
      if (ms.length) teamScores[t.id] = average(ms);
    }
  }
  room.history[room.qIndex] = { results, teamScores, penalty };
}

function standings(room) {
  const solo = [...room.players.values()]
    .map((p) => {
      const ms = room.history.filter(Boolean).map((h) => h.results.get(p.id)?.multiple).filter((m) => m != null);
      return { id: p.id, name: p.name, teamId: p.teamId, avg: ms.length ? average(ms) : null, played: ms.length };
    })
    .filter((s) => s.played > 0)
    .sort((a, b) => a.avg - b.avg);
  let teams = [];
  if (room.settings.mode === 'team') {
    teams = room.teams
      .map((t) => {
        const ms = room.history.filter(Boolean).map((h) => h.teamScores[t.id]).filter((m) => m != null);
        return { id: t.id, name: t.name, color: t.color, avg: ms.length ? average(ms) : null, played: ms.length };
      })
      .filter((t) => t.played > 0)
      .sort((a, b) => a.avg - b.avg);
  }
  return { solo, teams };
}

// ---------- state views ----------
function publicQuestion(q, withAnswer) {
  if (!q) return null;
  const base = { id: q.id, text: q.text, unit: q.unit, category: q.category };
  if (!withAnswer) return base;
  return { ...base, answer: q.answer, year: q.year, source: q.source, napkin: q.napkin };
}

function hostView(room) {
  const q = room.questions[room.qIndex];
  const showAnswer = room.phase === 'reveal';
  const view = {
    role: 'host',
    code: room.code,
    phase: room.phase,
    settings: room.settings,
    teams: room.teams,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, teamId: p.teamId, online: p.sockets.size > 0 })),
    qIndex: room.qIndex,
    total: room.questions.length || QUESTIONS_PER_ROUND,
    question: room.phase === 'question' || room.phase === 'reveal' ? publicQuestion(q, showAnswer) : null,
    remainingMs: room.phase === 'question' ? Math.max(0, room.endsAt - Date.now()) : 0,
    answeredIds: room.phase === 'question' ? [...room.guesses.keys()] : [],
    expected: room.participants.size,
    questionBank: QUESTIONS.length,
  };
  if (room.phase === 'reveal') {
    const h = room.history[room.qIndex];
    view.reveal = {
      penalty: h.penalty,
      results: [...h.results.entries()]
        .map(([pid, r]) => ({ id: pid, name: room.players.get(pid)?.name, teamId: room.players.get(pid)?.teamId, ...r }))
        .sort((a, b) => a.multiple - b.multiple),
      teamScores: h.teamScores,
    };
  }
  if (room.phase === 'leaderboard' || room.phase === 'final' || room.phase === 'reveal') view.standings = standings(room);
  return view;
}

function playerView(room, p) {
  const q = room.questions[room.qIndex];
  const view = {
    role: 'player',
    code: room.code,
    me: { id: p.id, name: p.name, teamId: p.teamId },
    phase: room.phase,
    mode: room.settings.mode,
    timerSec: room.settings.timer,
    teams: room.teams,
    qIndex: room.qIndex,
    total: room.questions.length || QUESTIONS_PER_ROUND,
    question: room.phase === 'question' || room.phase === 'reveal' ? publicQuestion(q, room.phase === 'reveal') : null,
    remainingMs: room.phase === 'question' ? Math.max(0, room.endsAt - Date.now()) : 0,
    canAnswer: room.phase === 'question' && room.participants.has(p.id),
    myGuess: room.phase === 'question' ? room.guesses.get(p.id) ?? null : null,
  };
  if (room.phase === 'reveal') {
    const h = room.history[room.qIndex];
    const r = h.results.get(p.id);
    if (r) {
      const sorted = [...h.results.values()].map((x) => x.multiple).sort((a, b) => a - b);
      view.myResult = { ...r, rank: sorted.indexOf(r.multiple) + 1, of: sorted.length };
    }
    if (room.settings.mode === 'team' && p.teamId && h.teamScores[p.teamId] != null) view.myTeamScore = h.teamScores[p.teamId];
  }
  if (room.phase === 'leaderboard' || room.phase === 'final') {
    const s = standings(room);
    view.standings = s;
  }
  return view;
}

function broadcast(room) {
  room.lastActive = Date.now();
  const hv = hostView(room);
  for (const sid of room.hostSockets) io.to(sid).emit('state', hv);
  for (const p of room.players.values()) {
    if (!p.sockets.size) continue;
    const pv = playerView(room, p);
    for (const sid of p.sockets) io.to(sid).emit('state', pv);
  }
}

// ---------- phase transitions ----------
function startQuestion(room) {
  room.phase = 'question';
  room.guesses = new Map();
  room.participants = new Set(connectedPlayers(room).map((p) => p.id));
  room.endsAt = Date.now() + room.settings.timer * 1000;
  clearTimeout(room.timer);
  room.timer = setTimeout(() => reveal(room), room.settings.timer * 1000 + 300);
  broadcast(room);
}

function reveal(room) {
  if (room.phase !== 'question') return;
  clearTimeout(room.timer);
  finalizeQuestion(room);
  room.phase = 'reveal';
  broadcast(room);
}

function maybeEarlyReveal(room) {
  const pending = [...room.participants].filter((pid) => !room.guesses.has(pid) && room.players.get(pid)?.sockets.size);
  if (room.participants.size && pending.length === 0) setTimeout(() => reveal(room), 800);
}

function ensureTeamsAssigned(room) {
  if (room.settings.mode !== 'team') return;
  const valid = new Set(room.teams.map((t) => t.id));
  for (const p of room.players.values()) {
    if (!valid.has(p.teamId)) {
      const counts = room.teams.map((t) => ({ id: t.id, n: [...room.players.values()].filter((x) => x.teamId === t.id).length }));
      counts.sort((a, b) => a.n - b.n);
      p.teamId = counts[0].id;
    }
  }
}

// ---------- sockets ----------
io.on('connection', (socket) => {
  let ctx = null; // { room, role, playerId }

  const isHost = () => ctx && ctx.role === 'host' && rooms.get(ctx.room.code) === ctx.room;

  socket.on('host:create', (_, ack) => {
    const room = createRoom();
    room.hostSockets.add(socket.id);
    ctx = { room, role: 'host' };
    ack?.({ ok: true, code: room.code, hostToken: room.hostToken });
    broadcast(room);
  });

  socket.on('host:resume', ({ code, hostToken } = {}, ack) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room || room.hostToken !== hostToken) return ack?.({ ok: false });
    room.hostSockets.add(socket.id);
    ctx = { room, role: 'host' };
    ack?.({ ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('host:settings', (s = {}) => {
    if (!isHost() || ctx.room.phase !== 'lobby') return;
    const room = ctx.room;
    if (s.mode === 'solo' || s.mode === 'team') room.settings.mode = s.mode;
    if ([30, 45, 60].includes(Number(s.timer))) room.settings.timer = Number(s.timer);
    if (s.teamCount) {
      const n = Math.max(2, Math.min(TEAM_PRESETS.length, Number(s.teamCount)));
      room.settings.teamCount = n;
      room.teams = makeTeams(n);
      const valid = new Set(room.teams.map((t) => t.id));
      for (const p of room.players.values()) if (!valid.has(p.teamId)) p.teamId = null;
    }
    broadcast(room);
  });

  socket.on('host:kick', ({ playerId } = {}) => {
    if (!isHost()) return;
    const p = ctx.room.players.get(playerId);
    if (!p) return;
    for (const sid of p.sockets) io.to(sid).emit('kicked');
    ctx.room.players.delete(playerId);
    ctx.room.participants.delete(playerId);
    broadcast(ctx.room);
  });

  socket.on('host:start', () => {
    if (!isHost()) return;
    const room = ctx.room;
    if (room.phase !== 'lobby' && room.phase !== 'final') return;
    if (!connectedPlayers(room).length) return;
    ensureTeamsAssigned(room);
    room.questions = pickQuestions(room);
    room.history = [];
    room.qIndex = 0;
    room.phase = 'ready';
    broadcast(room);
  });

  socket.on('host:go', () => {
    // Starts the timer for the current question.
    if (!isHost() || ctx.room.phase !== 'ready') return;
    startQuestion(ctx.room);
  });

  socket.on('host:reveal', () => {
    if (!isHost()) return;
    reveal(ctx.room);
  });

  socket.on('host:next', () => {
    if (!isHost()) return;
    const room = ctx.room;
    if (room.phase === 'reveal') {
      room.phase = room.qIndex >= room.questions.length - 1 ? 'final' : 'leaderboard';
    } else if (room.phase === 'leaderboard') {
      room.qIndex += 1;
      room.phase = 'ready';
    }
    broadcast(room);
  });

  socket.on('host:lobby', () => {
    // Back to lobby for a new round (keeps players and teams).
    if (!isHost()) return;
    const room = ctx.room;
    clearTimeout(room.timer);
    room.phase = 'lobby';
    room.qIndex = -1;
    room.history = [];
    room.questions = [];
    broadcast(room);
  });

  socket.on('player:join', ({ code, name, playerId } = {}, ack) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return ack?.({ ok: false, error: 'no-room' });
    let p = playerId && room.players.get(playerId);
    if (!p) {
      const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 16);
      if (!clean) return ack?.({ ok: false, error: 'no-name' });
      if (room.players.size >= MAX_PLAYERS) return ack?.({ ok: false, error: 'full' });
      let final = clean;
      let n = 2;
      const taken = new Set([...room.players.values()].map((x) => x.name));
      while (taken.has(final)) final = `${clean} ${n++}`;
      p = { id: rid(8), name: final, teamId: null, sockets: new Set() };
      room.players.set(p.id, p);
    }
    p.sockets.add(socket.id);
    ctx = { room, role: 'player', playerId: p.id };
    ack?.({ ok: true, playerId: p.id, code: room.code });
    broadcast(room);
  });

  socket.on('player:team', ({ teamId } = {}) => {
    if (!ctx || ctx.role !== 'player') return;
    const room = ctx.room;
    if (room.phase !== 'lobby' && room.phase !== 'final') return;
    if (!room.teams.some((t) => t.id === teamId)) return;
    const p = room.players.get(ctx.playerId);
    if (p) p.teamId = teamId;
    broadcast(room);
  });

  socket.on('player:guess', ({ value } = {}, ack) => {
    if (!ctx || ctx.role !== 'player') return ack?.({ ok: false });
    const room = ctx.room;
    const v = Number(value);
    if (room.phase !== 'question' || !room.participants.has(ctx.playerId)) return ack?.({ ok: false, error: 'closed' });
    if (!Number.isFinite(v) || v <= 0 || v > 1e18) return ack?.({ ok: false, error: 'bad' });
    room.guesses.set(ctx.playerId, v);
    ack?.({ ok: true });
    broadcast(room);
    maybeEarlyReveal(room);
  });

  socket.on('player:leave', () => {
    if (!ctx || ctx.role !== 'player') return;
    const room = ctx.room;
    room.players.delete(ctx.playerId);
    room.participants.delete(ctx.playerId);
    ctx = null;
    broadcast(room);
  });

  socket.on('disconnect', () => {
    if (!ctx) return;
    const room = ctx.room;
    if (ctx.role === 'host') room.hostSockets.delete(socket.id);
    else room.players.get(ctx.playerId)?.sockets.delete(socket.id);
    broadcast(room);
    if (room.phase === 'question') maybeEarlyReveal(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) if (now - room.lastActive > ROOM_TTL_MS) { clearTimeout(room.timer); rooms.delete(code); }
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log(`تقريباً running on http://localhost:${PORT}`));
