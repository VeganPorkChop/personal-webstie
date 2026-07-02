/* ============================================================================
 * demos/scrabble.js — Scrabble best-move engine widget
 * A 15x15 premium board + a 7-tile rack. "Find best moves" runs the trie move
 * generator + ported scoring (ai/scrabble.js) and ranks the AI's plays; click
 * one to place it. Demonstrates premiums, cross-words and the 50-pt bingo bonus.
 *
 *   mount(container, opts?) → { destroy() }
 * ========================================================================== */
import * as S from '../ai/scrabble.js';

export function mount(container) {
  let board = S.emptyBoard();
  let rack = S.dealRack(7);
  let moves = [];
  let total = 0;

  container.innerHTML = '';
  const root = document.createElement('div');
  root.innerHTML = `
    <style>
      .sc-wrap{font-family:system-ui,Arial,sans-serif;color:#111;display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start}
      .sc-board{display:grid;grid-template-columns:repeat(15,26px);grid-template-rows:repeat(15,26px);gap:1px;background:#b9c2cc;padding:4px;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.2)}
      .sc-cell{background:#e9edf1;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#5b6875;border-radius:3px;position:relative}
      .sc-cell.TW{background:#e2564b;color:#fff}.sc-cell.DW{background:#f0a3a0;color:#fff}
      .sc-cell.TL{background:#4a86c7;color:#fff}.sc-cell.DL{background:#a9cbe8;color:#fff}
      .sc-cell.star{background:#f0a3a0;color:#fff}
      .sc-cell.tile{background:#f7e2ad;color:#3a2a12;font-size:14px;box-shadow:inset 0 -2px 0 rgba(0,0,0,.12)}
      .sc-cell.blank{color:#9a7b3a}
      .sc-cell.hl{outline:3px solid #16a34a;outline-offset:-3px;z-index:1}
      .sc-side{min-width:250px}
      .sc-rack{display:flex;gap:5px;margin:8px 0}
      .sc-rack .t{width:30px;height:30px;background:#f7e2ad;border-radius:5px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#3a2a12;box-shadow:inset 0 -2px 0 rgba(0,0,0,.15)}
      .sc-controls{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
      .sc-btn{border:2px solid #111;background:#111;color:#fff;border-radius:999px;padding:6px 12px;font-weight:700;cursor:pointer}
      .sc-btn.ghost{background:#fff;color:#111}
      .sc-moves{list-style:none;padding:0;margin:8px 0;max-height:260px;overflow:auto}
      .sc-moves li{display:flex;justify-content:space-between;gap:8px;padding:6px 8px;border:1px solid #e2e6ea;border-radius:8px;margin-bottom:5px;cursor:pointer}
      .sc-moves li:hover{background:#eff6ff}
      .sc-moves li .w{font-weight:700}
      .sc-moves li .s{color:#c0392b;font-weight:800}
      .sc-moves li.bingo{background:#fff7ed;border-color:#fdba74}
      .sc-in{width:130px;padding:5px;border:1px solid #c6cad2;border-radius:6px;text-transform:uppercase}
      .sc-total{font-weight:800;margin-top:8px}
    </style>
    <div class="sc-wrap">
      <div class="sc-board"></div>
      <div class="sc-side">
        <strong>Rack</strong>
        <div class="sc-rack"></div>
        <div class="sc-controls">
          <input class="sc-in" maxlength="7" placeholder="ABCDE?F">
          <button class="sc-btn ghost sc-set">Set</button>
          <button class="sc-btn ghost sc-deal">Deal</button>
        </div>
        <button class="sc-btn sc-find">Find best moves</button>
        <div class="sc-total">Total score: 0</div>
        <ol class="sc-moves"></ol>
      </div>
    </div>`;
  container.appendChild(root);

  const boardEl = root.querySelector('.sc-board');
  const rackEl = root.querySelector('.sc-rack');
  const movesEl = root.querySelector('.sc-moves');
  const totalEl = root.querySelector('.sc-total');
  const input = root.querySelector('.sc-in');

  const cells = [];
  for (let r = 0; r < S.SIZE; r++) {
    cells.push([]);
    for (let c = 0; c < S.SIZE; c++) {
      const el = document.createElement('div');
      const prem = S.PREMIUM[r + ',' + c];
      el.className = 'sc-cell' + (prem ? ' ' + prem : '') + (r === S.CENTER && c === S.CENTER ? ' star' : '');
      el.textContent = r === S.CENTER && c === S.CENTER ? '★' : (prem || '');
      boardEl.appendChild(el);
      cells[r].push(el);
    }
  }

  function renderBoard(highlight) {
    for (let r = 0; r < S.SIZE; r++) for (let c = 0; c < S.SIZE; c++) {
      const el = cells[r][c], v = board[r][c];
      const prem = S.PREMIUM[r + ',' + c];
      el.classList.remove('hl');
      if (v) {
        el.className = 'sc-cell tile' + (v === v.toLowerCase() ? ' blank' : '');
        el.textContent = v.toUpperCase();
      } else {
        el.className = 'sc-cell' + (prem ? ' ' + prem : '') + (r === S.CENTER && c === S.CENTER ? ' star' : '');
        el.textContent = r === S.CENTER && c === S.CENTER ? '★' : (prem || '');
      }
    }
    if (highlight) for (const p of highlight) cells[p.r][p.c].classList.add('hl');
  }

  function renderRack() {
    rackEl.innerHTML = '';
    for (const t of rack) {
      const el = document.createElement('div'); el.className = 't';
      el.textContent = t === '?' ? '·' : t; rackEl.appendChild(el);
    }
  }

  function renderMoves() {
    movesEl.innerHTML = '';
    if (!moves.length) { movesEl.innerHTML = '<li style="cursor:default;color:#6b7280">No legal moves for this rack.</li>'; return; }
    moves.forEach((m) => {
      const li = document.createElement('li');
      if (m.placements.length === 7) li.classList.add('bingo');
      const dir = m.horizontal ? '→' : '↓';
      li.innerHTML = `<span class="w">${m.word} ${dir}${m.placements.length === 7 ? ' · BINGO' : ''}</span><span class="s">${m.score}</span>`;
      li.addEventListener('mouseenter', () => renderBoard(m.placements));
      li.addEventListener('mouseleave', () => renderBoard());
      li.addEventListener('click', () => playMove(m));
      movesEl.appendChild(li);
    });
  }

  function playMove(m) {
    board = S.applyMove(board, m);
    total += m.score;
    totalEl.textContent = 'Total score: ' + total;
    // consume used tiles from the rack (blanks first for blank placements)
    for (const p of m.placements) {
      const want = p.isBlank ? '?' : p.letter;
      const idx = rack.indexOf(want);
      if (idx >= 0) rack.splice(idx, 1);
    }
    while (rack.length < 7) rack.push(S.dealRack(1)[0]);
    moves = [];
    renderBoard(); renderRack(); renderMoves();
  }

  function find() {
    const btn = root.querySelector('.sc-find');
    btn.textContent = 'Thinking…'; btn.disabled = true;
    setTimeout(() => {
      moves = S.bestMoves(board, rack, 10);
      renderMoves();
      if (moves[0]) renderBoard(moves[0].placements);
      btn.textContent = 'Find best moves'; btn.disabled = false;
    }, 20);
  }

  root.querySelector('.sc-find').addEventListener('click', find);
  root.querySelector('.sc-deal').addEventListener('click', () => { rack = S.dealRack(7); moves = []; renderRack(); renderMoves(); renderBoard(); });
  root.querySelector('.sc-set').addEventListener('click', () => {
    const v = input.value.toUpperCase().replace(/[^A-Z?]/g, '').slice(0, 7).split('');
    if (v.length) { rack = v; moves = []; renderRack(); renderMoves(); renderBoard(); }
  });

  renderBoard(); renderRack(); renderMoves();
  return { destroy() { container.innerHTML = ''; } };
}
