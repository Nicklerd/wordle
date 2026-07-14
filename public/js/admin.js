/* Word Arena — landing + host panel */
'use strict';

const socket = io();
const $ = (id) => document.getElementById(id);

let adminToken = null;
let roomCode = null;

/* ---------------- landing demo row ---------------- */

(() => {
  const demo = [
    ['а', 'present'], ['р', 'correct'], ['е', 'absent'], ['н', 'correct'], ['а', 'correct'],
  ];
  const row = $('demo-row');
  if (!row) return;
  demo.forEach(([ch, state], i) => {
    const t = document.createElement('div');
    t.className = 'tile';
    t.textContent = ch;
    row.appendChild(t);
    setTimeout(() => {
      t.classList.add('flip-in');
      t.addEventListener('animationend', function onIn() {
        t.removeEventListener('animationend', onIn);
        t.classList.remove('flip-in');
        t.dataset.state = state;
        t.classList.add('flip-out');
      });
    }, 400 + 300 * i);
  });
})();

/* ---------------- landing actions ---------------- */

$('btn-create').addEventListener('click', () => {
  const word = $('secret-input').value;
  const validateGuesses = $('validate-check').checked;
  $('create-error').textContent = '';
  socket.emit('admin:create', { word, validateGuesses }, (res) => {
    if (!res.ok) {
      $('create-error').textContent =
        res.error === 'bad_length' ? 'Нужно ровно 5 букв'
        : res.error === 'bad_chars' ? 'Только русские или только английские буквы'
        : 'Не удалось создать игру';
      return;
    }
    adminToken = res.adminToken;
    roomCode = res.roomCode;
    localStorage.setItem('wa_admin_' + roomCode, adminToken);
    history.replaceState(null, '', '/admin/' + roomCode);
    enterAdmin('lobby', $('secret-input').value);
  });
});

$('secret-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-create').click();
});

$('btn-goto-join').addEventListener('click', () => {
  const code = $('code-input').value.trim().toUpperCase();
  if (!/^[A-Z2-9]{4}$/.test(code)) {
    $('join-error').textContent = 'Код — 4 символа';
    return;
  }
  location.href = '/join/' + code;
});
$('code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-goto-join').click();
});

/* ---------------- admin view ---------------- */

function enterAdmin(status, secretWord) {
  $('view-landing').hidden = true;
  $('view-admin').hidden = false;
  $('top-code').hidden = false;
  $('top-code').textContent = roomCode;
  $('admin-code').textContent = roomCode;
  $('qr-img').src = '/qr/' + roomCode + '.png';
  const joinUrl = location.origin + '/join/' + roomCode;
  $('join-url').textContent = joinUrl;
  $('join-url').href = joinUrl;
  if (secretWord) $('secret-badge').textContent = secretWord;
  setStatus(status);
}

function setStatus(status) {
  const chip = $('top-status');
  chip.hidden = false;
  chip.classList.toggle('active', status === 'active');
  chip.textContent =
    status === 'lobby' ? 'Лобби — ждём игроков'
    : status === 'active' ? '● Игра идёт'
    : 'Игра завершена';
  $('btn-start').hidden = status !== 'lobby';
  $('btn-end').hidden = status !== 'active';
  $('btn-new-round').hidden = status === 'active';
}

$('btn-start').addEventListener('click', () => {
  socket.emit('admin:start', { adminToken }, (res) => {
    if (!res.ok) WA.toast(WA.ERRORS[res.error] || 'Ошибка');
  });
});

$('btn-end').addEventListener('click', () => {
  if (confirm('Завершить игру и показать всем результаты?'))
    socket.emit('admin:end', { adminToken });
});

function openRoundModal() {
  $('round-word').value = '';
  $('round-error').textContent = '';
  $('round-overlay').hidden = false;
  $('round-word').focus();
}
$('btn-new-round').addEventListener('click', openRoundModal);
$('btn-results-new-round').addEventListener('click', () => {
  $('results-overlay').hidden = true;
  openRoundModal();
});
$('btn-round-cancel').addEventListener('click', () => { $('round-overlay').hidden = true; });
$('btn-results-close').addEventListener('click', () => { $('results-overlay').hidden = true; });

$('btn-round-go').addEventListener('click', () => {
  socket.emit('admin:newRound', { adminToken, word: $('round-word').value }, (res) => {
    if (!res.ok) {
      $('round-error').textContent =
        res.error === 'bad_length' ? 'Нужно ровно 5 букв'
        : res.error === 'bad_chars' ? 'Только русские или только английские буквы'
        : 'Ошибка';
      return;
    }
    $('secret-badge').textContent = $('round-word').value.toLowerCase().replace(/ё/g, 'е');
    $('round-overlay').hidden = true;
    $('results-overlay').hidden = true;
    setStatus('lobby');
  });
});
$('round-word').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-round-go').click();
});

/* ---------------- live boards ---------------- */

socket.on('admin:board', ({ status, players, secretWord }) => {
  setStatus(status);
  if (secretWord) $('secret-badge').textContent = secretWord;
  const panel = $('admin-players');
  if (players.length === 0) {
    panel.innerHTML = '<div class="empty-hint">Пока никто не подключился.<br>Покажите QR-код участникам 👆</div>';
    return;
  }
  panel.innerHTML = players.map((p) => {
    const cls = p.solved ? ' solved' : p.failed ? ' failed' : '';
    const dc = p.connected ? '' : ' disconnected';
    const statusIcon = p.solved ? '✅' : p.failed ? '❌' : p.connected ? `${p.currentRow}/6` : '⚠️';
    return `<div class="player-card${cls}${dc}">
      <div class="rival-head">
        ${WA.avatarHTML(p.nickname, p.hue)}
        <span class="rival-name" title="${p.nickname}">${escapeHTML(p.nickname)}</span>
        <span class="rival-status">${statusIcon}</span>
        <button class="kick-btn" data-kick="${p.id}" title="Выгнать">✕</button>
      </div>
      <div class="admin-board">${WA.fullBoardHTML(p.guesses)}</div>
      ${p.timeMs != null ? `<div style="font-size:12px;color:var(--text-muted);margin-top:6px">⏱ ${WA.fmtTime(p.timeMs)}</div>` : ''}
    </div>`;
  }).join('');

  panel.querySelectorAll('[data-kick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (confirm('Выгнать игрока?'))
        socket.emit('admin:kick', { adminToken, playerId: btn.dataset.kick });
    });
  });
});

socket.on('game:over', ({ word, leaderboard }) => {
  setStatus('finished');
  $('reveal-word').innerHTML = word.split('').map(
    (ch) => `<div class="tile" data-state="correct">${ch}</div>`
  ).join('');
  $('lb-list').innerHTML = leaderboard.map((p, i) => {
    const meta = p.solved
      ? `${p.rows}/6 · ${WA.fmtTime(p.timeMs)}`
      : p.failed ? 'не угадал' : `${p.rows}/6 · не закончил`;
    return `<li>
      <span class="place">${i + 1}</span>
      ${WA.avatarHTML(p.nickname, p.hue, 24)}
      <span class="lb-name">${escapeHTML(p.nickname)}</span>
      <span class="lb-meta">${meta}</span>
    </li>`;
  }).join('');
  $('results-overlay').hidden = false;
});

/* ---------------- rejoin on refresh ---------------- */

function tryRejoin() {
  const m = location.pathname.match(/^\/admin\/([A-Z2-9]{4})$/i);
  if (!m) return;
  const code = m[1].toUpperCase();
  const saved = localStorage.getItem('wa_admin_' + code);
  if (!saved) { history.replaceState(null, '', '/'); return; }
  socket.emit('admin:rejoin', { roomCode: code, adminToken: saved }, (res) => {
    if (!res.ok) { history.replaceState(null, '', '/'); return; }
    adminToken = saved;
    roomCode = code;
    enterAdmin(res.status, res.secretWord);
  });
}
socket.on('connect', () => {
  if (adminToken && roomCode) {
    socket.emit('admin:rejoin', { roomCode, adminToken }, () => {});
  } else {
    tryRejoin();
  }
});

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
