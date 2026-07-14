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
