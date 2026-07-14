/* Word Arena — player client */
'use strict';

const socket = io();
const $ = (id) => document.getElementById(id);

const roomCode = (location.pathname.match(/\/join\/([A-Za-z2-9]{4})/) || [])[1]?.toUpperCase();
$('top-code').textContent = roomCode || '';

let playerId = null;
let playerToken = null;
let lang = 'ru';
let status = 'lobby';

let tiles = [];
let keyEls = {};
let currentRow = 0;
let currentGuess = [];
let locked = false;
let done = false;

/* ---------------- join / rejoin ---------------- */

const storeKey = 'wa_player_' + roomCode;

function showView(name) {
  for (const v of ['view-name', 'view-lobby', 'view-game'])
    $(v).hidden = v !== 'view-' + name;
}

function setStatusChip(s) {
  const chip = $('top-status');
  chip.hidden = false;
  chip.classList.toggle('active', s === 'active');
  chip.textContent = s === 'lobby' ? 'Лобби' : s === 'active' ? '● Игра идёт' : 'Финиш';
}

$('btn-join').addEventListener('click', doJoin);
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

function doJoin() {
  const nickname = $('name-input').value;
  $('name-error').textContent = '';
  socket.emit('player:join', { roomCode, nickname }, (res) => {
    if (!res.ok) {
      $('name-error').textContent = WA.ERRORS[res.error] || 'Не удалось войти';
      return;
    }
    playerId = res.playerId;
    playerToken = res.playerToken;
    lang = res.lang;
    localStorage.setItem(storeKey, JSON.stringify({ playerId, playerToken }));
    startForStatus(res.status, []);
  });
}

socket.on('connect', () => {
  if (!roomCode) return;
  if (playerId && playerToken) return rejoin();
  const saved = localStorage.getItem(storeKey);
  if (saved) {
    ({ playerId, playerToken } = JSON.parse(saved));
    rejoin();
  }
});

function rejoin() {
  socket.emit('player:rejoin', { roomCode, playerId, playerToken }, (res) => {
    if (!res.ok) {
      playerId = playerToken = null;
      localStorage.removeItem(storeKey);
      showView('name');
      return;
    }
    lang = res.lang;
    startForStatus(res.status, res.ownGuesses || []);
    if (res.solved || res.failed) { done = true; locked = true; }
    if (res.status === 'finished' && res.leaderboard)
      showResults({ word: res.word, leaderboard: res.leaderboard });
  });
}

function startForStatus(s, ownGuesses) {
  status = s;
  setStatusChip(s);
  if (s === 'lobby') {
    showView('lobby');
  } else {
    enterGame(ownGuesses);
  }
}

/* ---------------- lobby ---------------- */

function renderLobby(players) {
  $('lobby-players').innerHTML = players.map((p) =>
    `<span class="chip">${WA.avatarHTML(p.nickname, p.hue, 24)}${escapeHTML(p.nickname)}</span>`
  ).join('');
}

/* ---------------- game ---------------- */

function enterGame(ownGuesses) {
  showView('game');
  tiles = WA.buildBoard($('board'));
  keyEls = WA.buildKeyboard($('keyboard'), lang, handleKey);
  currentRow = 0;
  currentGuess = [];
  locked = false;
  done = false;

  for (const g of ownGuesses) {
    const row = tiles[currentRow];
    g.word.split('').forEach((ch, i) => WA.setTile(row[i], ch, g.pattern[i]));
    WA.paintKeys(keyEls, g.word.split(''), g.pattern);
    currentRow++;
  }
}

function handleKey(key) {
  if (locked || done || status !== 'active') return;
  if (key === 'enter') return submitGuess();
  if (key === 'backspace') {
    if (currentGuess.length > 0) {
      currentGuess.pop();
      WA.setTile(tiles[currentRow][currentGuess.length], '', null);
    }
    return;
  }
  if (!WA.LETTER_RE[lang].test(key)) return;
  if (currentGuess.length >= WA.WORD_LENGTH) return;
  const ch = key === 'ё' ? 'е' : key;
  WA.setTile(tiles[currentRow][currentGuess.length], ch, 'tbd');
  currentGuess.push(ch);
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Enter') return handleKey('enter');
  if (e.key === 'Backspace') return handleKey('backspace');
  const k = e.key.toLowerCase();
  if (WA.LETTER_RE.en.test(k) || WA.LETTER_RE.ru.test(k)) handleKey(k);
});

function submitGuess() {
  if (currentGuess.length < WA.WORD_LENGTH) {
    WA.toast('Недостаточно букв');
    WA.shakeRow(tiles[currentRow][0].parentElement);
    return;
  }
  const word = currentGuess.join('');
  locked = true;
  socket.emit('player:guess', { word }, (res) => {
    if (!res.ok) {
      locked = false;
      WA.toast(WA.ERRORS[res.error] || 'Ошибка');
      WA.shakeRow(tiles[currentRow][0].parentElement);
      return;
    }
    const row = tiles[currentRow];
    const letters = word.split('');
    WA.revealRow(row, letters, res.pattern, () => {
      WA.paintKeys(keyEls, letters, res.pattern);
      if (res.solved) {
        done = true;
        WA.bounceRow(row);
        WA.toast(WIN_PHRASES[Math.min(currentRow, WIN_PHRASES.length - 1)], 2200);
      } else if (res.failed) {
        done = true;
        WA.toast(res.word ? res.word.toUpperCase() : 'Попытки закончились', 3000);
      } else {
        locked = false;
      }
      currentRow++;
      currentGuess = [];
    });
  });
}

const WIN_PHRASES = ['Гений!', 'Великолепно!', 'Впечатляюще!', 'Отлично!', 'Здорово!', 'Уф!'];

/* ---------------- rivals (real-time) ---------------- */

socket.on('board:update', ({ status: s, players }) => {
  if (s !== status) {
    status = s;
    setStatusChip(s);
  }
  if (status === 'lobby') renderLobby(players);
  renderRivals(players);
});

socket.on('game:started', ({ lang: l }) => {
  lang = l;
  status = 'active';
  setStatusChip(status);
  $('results-overlay').hidden = true;
  enterGame([]);
  WA.toast('Игра началась!', 1600);
});

socket.on('round:new', ({ lang: l }) => {
  lang = l;
  status = 'lobby';
  setStatusChip(status);
  $('results-overlay').hidden = true;
  showView('lobby');
  WA.toast('Новый раунд! Ждём старта', 2000);
});

function renderRivals(players) {
  const strip = $('rivals');
  const rivals = players.filter((p) => p.id !== playerId);
  if (status !== 'active' && status !== 'finished') { strip.innerHTML = ''; return; }
  strip.innerHTML = rivals.map((p) => {
    const cls = p.solved ? ' solved' : p.failed ? ' failed' : '';
    const dc = p.connected ? '' : ' disconnected';
    const icon = p.solved ? '✅' : p.failed ? '❌' : `${p.currentRow}/6`;
    return `<div class="rival${cls}${dc}">
      <div class="rival-head">
        ${WA.avatarHTML(p.nickname, p.hue, 24)}
        <span class="rival-name">${escapeHTML(p.nickname)}</span>
        <span class="rival-status">${icon}</span>
      </div>
      ${WA.rivalBoardHTML(p.patterns)}
    </div>`;
  }).join('');
}

/* ---------------- results ---------------- */

socket.on('game:over', showResults);

function showResults({ word, leaderboard }) {
  status = 'finished';
  setStatusChip(status);
  const me = leaderboard.find((p) => p.id === playerId);
  $('results-title').textContent =
    me && me.solved && leaderboard[0].id === playerId ? '🏆 Вы победили!'
    : me && me.solved ? 'Слово угадано!'
    : 'Итоги раунда';
  $('reveal-word').innerHTML = word.split('').map(
    (ch) => `<div class="tile" data-state="correct">${ch}</div>`
  ).join('');
  $('lb-list').innerHTML = leaderboard.map((p, i) => {
    const meta = p.solved
      ? `${p.rows}/6 · ${WA.fmtTime(p.timeMs)}`
      : p.failed ? 'не угадал' : `${p.rows}/6`;
    const isMe = p.id === playerId ? ' style="outline:1px solid var(--blurple);border-radius:6px"' : '';
    return `<li${isMe}>
      <span class="place">${i + 1}</span>
      ${WA.avatarHTML(p.nickname, p.hue, 24)}
      <span class="lb-name">${escapeHTML(p.nickname)}${p.id === playerId ? ' (вы)' : ''}</span>
      <span class="lb-meta">${meta}</span>
    </li>`;
  }).join('');
  setTimeout(() => { $('results-overlay').hidden = false; }, done ? 1800 : 600);
}

socket.on('kicked', () => {
  localStorage.removeItem(storeKey);
  document.body.innerHTML = '<div class="center-panel"><h2>Вас исключили из игры</h2><p class="muted">Обратитесь к ведущему.</p></div>';
});

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

if (!roomCode) {
  document.body.innerHTML = '<div class="center-panel"><h2>Некорректная ссылка</h2><p class="muted">Отсканируйте QR-код ведущего ещё раз.</p></div>';
}
