'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const WORD_LENGTH = 5;
const MAX_ROWS = 6;
const MAX_PLAYERS = 50;

/* ---------------- dictionaries ----------------
   Downloaded automatically on first start, so the repo stays tiny. */

const WORDS_DIR = path.join(__dirname, 'words');
const WORD_SOURCES = {
  'en_answers.txt':
    'https://gist.githubusercontent.com/cfreshman/a03ef2cba789d8cf00c08f767e0fad7b/raw/',
  'en_guesses.txt':
    'https://gist.githubusercontent.com/cfreshman/cdcdf777450c5b5301e439061d29694c/raw/',
  'ru_guesses.txt':
    'https://raw.githubusercontent.com/mediahope/Wordle-Russian-Dictionary/main/Russian.txt',
};

async function ensureDictionaries() {
  fs.mkdirSync(WORDS_DIR, { recursive: true });
  for (const [file, url] of Object.entries(WORD_SOURCES)) {
    const p = path.join(WORDS_DIR, file);
    if (fs.existsSync(p) && fs.statSync(p).size > 1000) continue;
    try {
      console.log(`[dict] downloading ${file} ...`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(p, await res.text());
    } catch (e) {
      console.warn(`[dict] could not download ${file}: ${e.message}`);
      console.warn('[dict] validation will be skipped for that language');
    }
  }
}

function loadWordSet(file) {
  const p = path.join(WORDS_DIR, file);
  if (!fs.existsSync(p)) return new Set();
  const set = new Set();
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const w = line.trim().toLowerCase().replace(/ё/g, 'е');
    if (/^[а-я]{5}$/.test(w) || /^[a-z]{5}$/.test(w)) set.add(w);
  }
  return set;
}

const DICTS = { en: new Set(), ru: new Set() };

/* ---------------- helpers ---------------- */

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rooms = new Map();

function makeRoomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

const token = () => crypto.randomBytes(16).toString('hex');

function normalizeWord(raw) {
  return String(raw || '').trim().toLowerCase().replace(/ё/g, 'е');
}

function detectLang(word) {
  if (/^[а-я]+$/.test(word)) return 'ru';
  if (/^[a-z]+$/.test(word)) return 'en';
  return null;
}

/** Classic two-pass Wordle scoring (handles duplicate letters). */
function scoreGuess(secret, guess) {
  const result = Array(WORD_LENGTH).fill('absent');
  const remaining = {};
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === secret[i]) result[i] = 'correct';
    else remaining[secret[i]] = (remaining[secret[i]] || 0) + 1;
  }
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] !== 'correct' && remaining[guess[i]] > 0) {
      result[i] = 'present';
      remaining[guess[i]]--;
    }
  }
  return result;
}

function avatarHue(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 360;
}

/* ---------------- room state views ---------------- */

function maskedPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    nickname: p.nickname,
    hue: p.hue,
    connected: p.connected,
    currentRow: p.guesses.length,
    patterns: p.guesses.map((g) => g.pattern),
    solved: p.solved,
    failed: p.failed,
    timeMs: p.timeMs,
  }));
}

function fullPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    nickname: p.nickname,
    hue: p.hue,
    connected: p.connected,
    currentRow: p.guesses.length,
    guesses: p.guesses,
    solved: p.solved,
    failed: p.failed,
    timeMs: p.timeMs,
  }));
}

function leaderboard(room) {
  const rank = [...room.players.values()].map((p) => ({
    id: p.id,
    nickname: p.nickname,
    hue: p.hue,
    solved: p.solved,
    failed: p.failed,
    rows: p.guesses.length,
    timeMs: p.timeMs,
  }));
  rank.sort((a, b) => {
    if (a.solved !== b.solved) return a.solved ? -1 : 1;
    if (a.solved && b.solved) {
      if (a.rows !== b.rows) return a.rows - b.rows;
      return (a.timeMs ?? Infinity) - (b.timeMs ?? Infinity);
    }
    return b.rows - a.rows;
  });
  return rank;
}

function emitState(room) {
  io.to(`room:${room.code}`).emit('board:update', {
    status: room.status,
    players: maskedPlayers(room),
  });
  if (room.adminSocketId) {
    io.to(room.adminSocketId).emit('admin:board', {
      status: room.status,
      secretWord: room.secretWord,
      lang: room.lang,
      players: fullPlayers(room),
    });
  }
}

function maybeFinishGame(room) {
  if (room.status !== 'active') return;
  const players = [...room.players.values()];
  if (players.length > 0 && players.every((p) => p.solved || p.failed)) {
    endGame(room);
  }
}

function endGame(room) {
  if (room.status === 'finished') return;
  room.status = 'finished';
  room.endedAt = Date.now();
  const payload = { word: room.secretWord, leaderboard: leaderboard(room) };
  io.to(`room:${room.code}`).emit('game:over', payload);
  if (room.adminSocketId) io.to(room.adminSocketId).emit('game:over', payload);
}

/* ---------------- express ---------------- */

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/join/:code', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'join.html'))
);
app.get('/admin/:code', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// QR encodes the join URL built from whatever host the admin page is on,
// so it works on localhost, LAN and production without configuration.
app.get('/qr/:code.png', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  if (!/^[A-Z2-9]{4}$/.test(code)) return res.status(400).end();
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const url = `${proto}://${req.get('host')}/join/${code}`;
  try {
    const png = await QRCode.toBuffer(url, {
      type: 'png',
      width: 480,
      margin: 1,
      color: { dark: '#0f0f10', light: '#ffffff' },
    });
    res.type('png').send(png);
  } catch {
    res.status(500).end();
  }
});

/* ---------------- socket.io ---------------- */

io.on('connection', (socket) => {
  socket.on('admin:create', (data, cb = () => {}) => {
    const word = normalizeWord(data && data.word);
    if (word.length !== WORD_LENGTH)
      return cb({ ok: false, error: 'bad_length' });
    const lang = detectLang(word);
    if (!lang) return cb({ ok: false, error: 'bad_chars' });

    const room = {
      code: makeRoomCode(),
      adminToken: token(),
      adminSocketId: socket.id,
      secretWord: word,
      lang,
      validateGuesses: data && data.validateGuesses !== false,
      status: 'lobby',
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      players: new Map(),
    };
    rooms.set(room.code, room);
    socket.data.adminOf = room.code;
    cb({ ok: true, roomCode: room.code, adminToken: room.adminToken, lang });
  });

  socket.on('admin:rejoin', ({ roomCode, adminToken }, cb = () => {}) => {
    const room = rooms.get(String(roomCode || '').toUpperCase());
    if (!room || room.adminToken !== adminToken)
      return cb({ ok: false, error: 'not_found' });
    room.adminSocketId = socket.id;
    socket.data.adminOf = room.code;
    cb({
      ok: true,
      roomCode: room.code,
      status: room.status,
      lang: room.lang,
      secretWord: room.secretWord,
    });
    emitState(room);
  });

  function adminRoom(socket, adminToken) {
    const room = rooms.get(socket.data.adminOf);
    return room && room.adminToken === adminToken ? room : null;
  }

  socket.on('admin:start', ({ adminToken }, cb = () => {}) => {
    const room = adminRoom(socket, adminToken);
    if (!room) return cb({ ok: false });
    if (room.status !== 'lobby') return cb({ ok: false, error: 'bad_state' });
    room.status = 'active';
    room.startedAt = Date.now();
    io.to(`room:${room.code}`).emit('game:started', {
      startedAt: room.startedAt,
      lang: room.lang,
      wordLength: WORD_LENGTH,
      maxRows: MAX_ROWS,
    });
    cb({ ok: true });
    emitState(room);
  });

  socket.on('admin:newRound', ({ adminToken, word }, cb = () => {}) => {
    const room = adminRoom(socket, adminToken);
    if (!room) return cb({ ok: false });
    const w = normalizeWord(word);
    if (w.length !== WORD_LENGTH) return cb({ ok: false, error: 'bad_length' });
    const lang = detectLang(w);
    if (!lang) return cb({ ok: false, error: 'bad_chars' });

    room.secretWord = w;
    room.lang = lang;
    room.status = 'lobby';
    room.startedAt = null;
    room.endedAt = null;
    for (const p of room.players.values()) {
      p.guesses = [];
      p.solved = false;
      p.failed = false;
      p.timeMs = null;
    }
    io.to(`room:${room.code}`).emit('round:new', { lang });
    cb({ ok: true, lang });
    emitState(room);
  });

  socket.on('admin:end', ({ adminToken }, cb = () => {}) => {
    const room = adminRoom(socket, adminToken);
    if (!room) return cb({ ok: false });
    endGame(room);
    cb({ ok: true });
  });

  socket.on('admin:kick', ({ adminToken, playerId }, cb = () => {}) => {
    const room = adminRoom(socket, adminToken);
    if (!room) return cb({ ok: false });
    const player = room.players.get(playerId);
    if (!player) return cb({ ok: false });
    room.players.delete(playerId);
    if (player.socketId) {
      io.to(player.socketId).emit('kicked');
      const s = io.sockets.sockets.get(player.socketId);
      if (s) s.leave(`room:${room.code}`);
    }
    cb({ ok: true });
    emitState(room);
    maybeFinishGame(room);
  });

  socket.on('player:join', ({ roomCode, nickname }, cb = () => {}) => {
    const room = rooms.get(String(roomCode || '').toUpperCase());
    if (!room) return cb({ ok: false, error: 'not_found' });
    if (room.status === 'finished')
      return cb({ ok: false, error: 'finished' });
    if (room.players.size >= MAX_PLAYERS)
      return cb({ ok: false, error: 'full' });

    const name = String(nickname || '').trim().slice(0, 20);
    if (name.length < 1) return cb({ ok: false, error: 'bad_name' });
    const taken = [...room.players.values()].some(
      (p) => p.nickname.toLowerCase() === name.toLowerCase()
    );
    if (taken) return cb({ ok: false, error: 'name_taken' });

    const player = {
      id: token().slice(0, 12),
      playerToken: token(),
      socketId: socket.id,
      nickname: name,
      hue: avatarHue(name),
      connected: true,
      guesses: [],
      solved: false,
      failed: false,
      timeMs: null,
    };
    room.players.set(player.id, player);
    socket.data.playerOf = room.code;
    socket.data.playerId = player.id;
    socket.join(`room:${room.code}`);

    cb({
      ok: true,
      playerId: player.id,
      playerToken: player.playerToken,
      status: room.status,
      lang: room.lang,
      wordLength: WORD_LENGTH,
      maxRows: MAX_ROWS,
    });
    emitState(room);
  });

  socket.on(
    'player:rejoin',
    ({ roomCode, playerId, playerToken }, cb = () => {}) => {
      const room = rooms.get(String(roomCode || '').toUpperCase());
      const player = room && room.players.get(playerId);
      if (!player || player.playerToken !== playerToken)
        return cb({ ok: false, error: 'not_found' });
      player.socketId = socket.id;
      player.connected = true;
      socket.data.playerOf = room.code;
      socket.data.playerId = player.id;
      socket.join(`room:${room.code}`);
      cb({
        ok: true,
        status: room.status,
        lang: room.lang,
        wordLength: WORD_LENGTH,
        maxRows: MAX_ROWS,
        ownGuesses: player.guesses,
        solved: player.solved,
        failed: player.failed,
        word: room.status === 'finished' ? room.secretWord : undefined,
        leaderboard: room.status === 'finished' ? leaderboard(room) : undefined,
      });
      emitState(room);
    }
  );

  socket.on('player:guess', ({ word }, cb = () => {}) => {
    const room = rooms.get(socket.data.playerOf);
    const player = room && room.players.get(socket.data.playerId);
    if (!room || !player) return cb({ ok: false, error: 'not_found' });
    if (room.status !== 'active')
      return cb({ ok: false, error: 'not_active' });
    if (player.solved || player.failed)
      return cb({ ok: false, error: 'already_done' });
    if (player.guesses.length >= MAX_ROWS)
      return cb({ ok: false, error: 'no_rows' });

    const guess = normalizeWord(word);
    if (guess.length !== WORD_LENGTH)
      return cb({ ok: false, error: 'bad_length' });
    if (detectLang(guess) !== room.lang)
      return cb({ ok: false, error: 'bad_chars' });
    if (
      room.validateGuesses &&
      DICTS[room.lang].size > 0 &&
      guess !== room.secretWord &&
      !DICTS[room.lang].has(guess)
    )
      return cb({ ok: false, error: 'not_in_dict' });

    const pattern = scoreGuess(room.secretWord, guess);
    player.guesses.push({ word: guess, pattern });

    if (guess === room.secretWord) {
      player.solved = true;
      player.timeMs = Date.now() - room.startedAt;
    } else if (player.guesses.length >= MAX_ROWS) {
      player.failed = true;
      player.timeMs = Date.now() - room.startedAt;
    }

    cb({
      ok: true,
      pattern,
      row: player.guesses.length - 1,
      solved: player.solved,
      failed: player.failed,
      word: player.failed ? room.secretWord : undefined,
    });
    emitState(room);
    maybeFinishGame(room);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.playerOf);
    if (room) {
      const player = room.players.get(socket.data.playerId);
      if (player && player.socketId === socket.id) {
        player.connected = false;
        player.socketId = null;
        emitState(room);
      }
    }
    const adminRoomRef = rooms.get(socket.data.adminOf);
    if (adminRoomRef && adminRoomRef.adminSocketId === socket.id) {
      adminRoomRef.adminSocketId = null;
    }
  });
});

/* ---------------- housekeeping ---------------- */

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const empty =
      !room.adminSocketId &&
      [...room.players.values()].every((p) => !p.connected);
    const idleLimit = empty ? 30 * 60 * 1000 : 24 * 60 * 60 * 1000;
    if (now - room.createdAt > idleLimit && (empty || now - room.createdAt > 24 * 60 * 60 * 1000)) {
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000);

/* ---------------- start ---------------- */

(async () => {
  await ensureDictionaries();
  DICTS.en = new Set([...loadWordSet('en_answers.txt'), ...loadWordSet('en_guesses.txt')]);
  DICTS.ru = loadWordSet('ru_guesses.txt');
  console.log(`[dict] en: ${DICTS.en.size} words, ru: ${DICTS.ru.size} words`);
  server.listen(PORT, () =>
    console.log(`Word Arena listening on http://localhost:${PORT}`)
  );
})();
