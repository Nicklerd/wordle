/* Word Arena — shared board / keyboard rendering (NYT mechanics) */
'use strict';

const WA = (() => {
  const WORD_LENGTH = 5;
  const MAX_ROWS = 6;

  const FLIP_MS = 250;      // FlipIn + FlipOut, 250ms each (NYT original)
  const STAGGER_MS = 300;   // per-tile reveal stagger (NYT original)
  const BOUNCE_STAGGER = 100;

  const KB_LAYOUTS = {
    en: [
      ['q','w','e','r','t','y','u','i','o','p'],
      ['a','s','d','f','g','h','j','k','l'],
      ['enter','z','x','c','v','b','n','m','backspace'],
    ],
    ru: [
      ['й','ц','у','к','е','н','г','ш','щ','з','х'],
      ['ф','ы','в','а','п','р','о','л','д','ж','э'],
      ['enter','я','ч','с','м','и','т','ь','б','ю','backspace'],
    ],
  };

  const LETTER_RE = { en: /^[a-z]$/, ru: /^[а-яё]$/ };

  /* ---------- full-size board ---------- */

  function buildBoard(el) {
    el.innerHTML = '';
    const tiles = [];
    for (let r = 0; r < MAX_ROWS; r++) {
      const row = document.createElement('div');
      row.className = 'row';
      const rowTiles = [];
      for (let c = 0; c < WORD_LENGTH; c++) {
        const t = document.createElement('div');
        t.className = 'tile';
        row.appendChild(t);
        rowTiles.push(t);
      }
      el.appendChild(row);
      tiles.push(rowTiles);
    }
    return tiles;
  }

  function setTile(tile, letter, state) {
    tile.textContent = letter || '';
    if (state) tile.dataset.state = state;
    else delete tile.dataset.state;
  }

  /** Staggered flip reveal of one row. */
  function revealRow(rowTiles, letters, pattern, onDone) {
    rowTiles.forEach((tile, i) => {
      setTimeout(() => {
        tile.classList.add('flip-in');
        tile.addEventListener('animationend', function onIn() {
          tile.removeEventListener('animationend', onIn);
          tile.classList.remove('flip-in');
          setTile(tile, letters[i], pattern[i]);
          tile.classList.add('flip-out');
          tile.addEventListener('animationend', function onOut() {
            tile.removeEventListener('animationend', onOut);
            tile.classList.remove('flip-out');
            if (i === rowTiles.length - 1 && onDone) onDone();
          });
        });
      }, STAGGER_MS * i);
    });
  }

  function bounceRow(rowTiles) {
    rowTiles.forEach((tile, i) => {
      tile.style.animationDelay = `${BOUNCE_STAGGER * i}ms`;
      tile.classList.add('bounce');
      tile.addEventListener('animationend', () => {
        tile.classList.remove('bounce');
        tile.style.animationDelay = '';
      }, { once: true });
    });
  }

  function shakeRow(rowEl) {
    rowEl.classList.add('shake');
    rowEl.addEventListener('animationend', () => rowEl.classList.remove('shake'), { once: true });
  }

  /* ---------- keyboard ---------- */

  const KEY_LABELS = { enter: 'ввод', backspace: '⌫' };
  const STATE_RANK = { absent: 0, present: 1, correct: 2 };

  function buildKeyboard(el, lang, onKey) {
    el.innerHTML = '';
    const keyEls = {};
    for (const rowKeys of KB_LAYOUTS[lang]) {
      const row = document.createElement('div');
      row.className = 'kb-row';
      for (const k of rowKeys) {
        const btn = document.createElement('button');
        btn.className = 'key' + (k.length > 1 ? ' wide' : '');
        btn.textContent = KEY_LABELS[k] || k;
        btn.dataset.key = k;
        btn.addEventListener('click', () => onKey(k));
        row.appendChild(btn);
        keyEls[k] = btn;
      }
      el.appendChild(row);
    }
    return keyEls;
  }

  /** Upgrade key colors: absent < present < correct, never downgrade. */
  function paintKeys(keyEls, letters, pattern) {
    letters.forEach((ch, i) => {
      const key = keyEls[ch];
      if (!key) return;
      const next = pattern[i];
      const cur = key.dataset.state;
      if (!cur || STATE_RANK[next] > STATE_RANK[cur]) key.dataset.state = next;
    });
  }

  /* ---------- mini boards (rivals / admin) ---------- */

  function miniBoardHTML(rowsHTMLBuilder) {
    let html = '<div class="mini-board">';
    for (let r = 0; r < MAX_ROWS; r++) {
      html += '<div class="mini-row">';
      for (let c = 0; c < WORD_LENGTH; c++) html += rowsHTMLBuilder(r, c);
      html += '</div>';
    }
    return html + '</div>';
  }

  /** Colors only — what rivals see. */
  function rivalBoardHTML(patterns) {
    return miniBoardHTML((r, c) => {
      const state = patterns[r] ? patterns[r][c] : '';
      return `<span class="mini-tile ${state}"></span>`;
    });
  }

  /** Letters + colors — what the host sees. */
  function fullBoardHTML(guesses) {
    return miniBoardHTML((r, c) => {
      const g = guesses[r];
      const state = g ? g.pattern[c] : '';
      const ch = g ? g.word[c] : '';
      return `<span class="mini-tile ${state}">${ch}</span>`;
    });
  }

  /* ---------- misc ---------- */

  function avatarHTML(nickname, hue, size) {
    const initial = (nickname || '?').trim()[0].toUpperCase();
    const s = size ? `width:${size}px;height:${size}px;font-size:${Math.round(size * .46)}px;` : '';
    return `<span class="avatar" style="background:hsl(${hue} 55% 45%);${s}">${initial}</span>`;
  }

  function fmtTime(ms) {
    if (ms == null) return '';
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  let toastEl;
  function toast(msg, ms = 1400) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast-stack';
      document.body.appendChild(toastEl);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    toastEl.prepend(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 350); }, ms);
  }

  const ERRORS = {
    bad_length: 'Недостаточно букв',
    bad_chars: 'Используйте буквы нужного языка',
    not_in_dict: 'Слова нет в словаре',
    not_active: 'Игра ещё не началась',
    already_done: 'Вы уже закончили',
    not_found: 'Игра не найдена',
    name_taken: 'Имя уже занято',
    bad_name: 'Введите имя',
    full: 'Комната заполнена',
    finished: 'Игра уже завершена',
    bad_state: 'Недоступно в текущем состоянии',
  };

  return {
    WORD_LENGTH, MAX_ROWS, FLIP_MS, STAGGER_MS, LETTER_RE, ERRORS,
    buildBoard, setTile, revealRow, bounceRow, shakeRow,
    buildKeyboard, paintKeys,
    rivalBoardHTML, fullBoardHTML, avatarHTML, fmtTime, toast,
  };
})();
