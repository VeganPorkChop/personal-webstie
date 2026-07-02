/* ============================================================================
 * demos/connect_four.js — playable Connect Four widget
 * Mounts a board you play (yellow) against the AI (red) from ai/connect_four.js.
 * Used by both the doc page and the in-gallery sim overlay.
 *
 *   mount(container, opts?) → { destroy() }
 * ========================================================================== */
import * as C4 from '../ai/connect_four.js';

export function mount(container, opts = {}) {
  const HUMAN = -1, AI = 1;            // human = yellow, AI = red (matches play.py)
  let depth = opts.depth ?? 5;
  let board = C4.emptyBoard();
  let turn = HUMAN;
  let busy = false, over = false;
  let winLine = null;
  let evals = new Array(C4.COLS).fill(0);

  const CELL = 62, PAD = 8;
  const W = C4.COLS * CELL, H = C4.ROWS * CELL;

  container.innerHTML = '';
  const root = document.createElement('div');
  root.innerHTML = `
    <style>
      .cf-wrap{font-family:system-ui,Arial,sans-serif;color:#111;display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start}
      .cf-status{font-weight:700;margin:0 0 8px;min-height:1.4em}
      .cf-canvas{background:#1b3a8f;border-radius:12px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.25);touch-action:manipulation}
      .cf-side{min-width:210px}
      .cf-bars{display:flex;flex-direction:column;gap:5px;margin:8px 0}
      .cf-bar{display:flex;align-items:center;gap:8px;font-size:.8rem}
      .cf-bar .lab{width:14px;color:#6b7280;text-align:center}
      .cf-bar .track{flex:1;height:12px;background:#e6ebef;border-radius:6px;overflow:hidden}
      .cf-bar .fill{height:100%;width:0;background:linear-gradient(90deg,#ff8a5c,#ffc46b);transition:width .35s ease}
      .cf-bar.best .fill{background:linear-gradient(90deg,#c0392b,#e74c3c)}
      .cf-controls{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}
      .cf-btn{border:2px solid #111;background:#111;color:#fff;border-radius:999px;padding:6px 14px;font-weight:700;cursor:pointer}
      .cf-btn.ghost{background:#fff;color:#111}
      .cf-note{font-size:.82rem;color:#6b7280;margin-top:6px}
    </style>
    <div class="cf-wrap">
      <div>
        <p class="cf-status"></p>
        <canvas class="cf-canvas" width="${W}" height="${H}"></canvas>
      </div>
      <div class="cf-side">
        <strong>AI column evaluation</strong>
        <div class="cf-note">The search's score for each drop — the browser stand-in for the DQN's 7 Q-values.</div>
        <div class="cf-bars"></div>
        <div class="cf-controls">
          <button class="cf-btn cf-reset">New game</button>
          <label style="font-size:.82rem">Depth
            <select class="cf-depth">
              <option value="3">3 (fast)</option>
              <option value="5" selected>5</option>
              <option value="7">7 (strong)</option>
            </select>
          </label>
        </div>
      </div>
    </div>`;
  container.appendChild(root);

  const canvas = root.querySelector('.cf-canvas');
  const ctx = canvas.getContext('2d');
  const statusEl = root.querySelector('.cf-status');
  const barsEl = root.querySelector('.cf-bars');
  const depthSel = root.querySelector('.cf-depth');

  const barFills = [];
  for (let c = 0; c < C4.COLS; c++) {
    const row = document.createElement('div');
    row.className = 'cf-bar';
    row.innerHTML = `<span class="lab">${c + 1}</span><span class="track"><span class="fill"></span></span>`;
    barsEl.appendChild(row);
    barFills.push(row);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (let r = 0; r < C4.ROWS; r++) {
      for (let c = 0; c < C4.COLS; c++) {
        const cx = c * CELL + CELL / 2, cy = r * CELL + CELL / 2;
        const v = board[r][c];
        ctx.beginPath();
        ctx.arc(cx, cy, CELL / 2 - PAD, 0, Math.PI * 2);
        ctx.fillStyle = v === 0 ? '#0e214f' : v === AI ? '#e74c3c' : '#f1c40f';
        ctx.fill();
        if (winLine && winLine.some(([wr, wc]) => wr === r && wc === c)) {
          ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
        }
      }
    }
  }

  function updateBars() {
    const finite = evals.filter((v) => isFinite(v));
    const min = Math.min(...finite, 0), max = Math.max(...finite, 1);
    const best = C4.validCols(board).reduce((b, c) => (evals[c] > evals[b] ? c : b), C4.validCols(board)[0] ?? 0);
    for (let c = 0; c < C4.COLS; c++) {
      const valid = C4.dropRow(board, c) >= 0;
      const pct = valid && isFinite(evals[c]) ? ((evals[c] - min) / (max - min || 1)) * 100 : 0;
      barFills[c].querySelector('.fill').style.width = pct + '%';
      barFills[c].classList.toggle('best', valid && c === best && !over);
    }
  }

  function setStatus(msg) { statusEl.textContent = msg; }

  function endIfOver() {
    const w = C4.winner(board);
    if (w !== 0) {
      over = true; winLine = C4.winningLine(board, w); draw();
      setStatus(w === HUMAN ? 'You win! 🟡' : 'AI wins. 🔴');
      return true;
    }
    if (C4.isFull(board)) { over = true; setStatus('Draw.'); return true; }
    return false;
  }

  function aiMove() {
    busy = true; setStatus('AI is thinking…');
    setTimeout(() => {
      evals = C4.evaluateColumns(board, AI, { depth });
      updateBars();
      const col = C4.chooseMove(board, AI, { depth });
      board = C4.applyMove(board, col, AI);
      draw();
      busy = false;
      if (!endIfOver()) { turn = HUMAN; setStatus('Your turn — drop a yellow disc.'); }
    }, 220);
  }

  canvas.addEventListener('click', (e) => {
    if (busy || over || turn !== HUMAN) return;
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * C4.COLS);
    if (C4.dropRow(board, col) < 0) return;
    board = C4.applyMove(board, col, HUMAN);
    draw();
    if (!endIfOver()) { turn = AI; aiMove(); }
  });

  function reset() {
    board = C4.emptyBoard(); turn = HUMAN; busy = false; over = false; winLine = null;
    evals = new Array(C4.COLS).fill(0); updateBars(); draw();
    setStatus('Your turn — drop a yellow disc.');
  }
  root.querySelector('.cf-reset').addEventListener('click', reset);
  depthSel.addEventListener('change', () => { depth = +depthSel.value; });

  reset();
  return { destroy() { container.innerHTML = ''; } };
}
