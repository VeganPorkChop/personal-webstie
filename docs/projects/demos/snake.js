/* ============================================================================
 * demos/snake.js — Snake widget you can WATCH or PLAY
 * Watch the AI (ai/snake.js) or take over with arrow keys / WASD. Shows the live
 * 11-feature DQN state and the flood-fill "survival" region the AI reasons over.
 *
 *   mount(container, opts?) → { destroy() }
 * ========================================================================== */
import * as SNK from '../ai/snake.js';

export function mount(container, opts = {}) {
  const COLS = opts.cols ?? 20, ROWS = opts.rows ?? 14, CELL = opts.cell ?? 22;
  const W = COLS * CELL, H = ROWS * CELL;
  let game = SNK.newGame(COLS, ROWS);
  let mode = 'watch';                 // 'watch' | 'play'
  let running = true;
  let stepMs = 90;
  let best = 0;
  let showFlood = true;
  let timer = null;
  let pendingDir = null;              // queued direction in play mode

  container.innerHTML = '';
  const root = document.createElement('div');
  root.innerHTML = `
    <style>
      .sk-wrap{font-family:system-ui,Arial,sans-serif;color:#111;display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start}
      .sk-canvas{background:#0d1424;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.25)}
      .sk-status{font-weight:700;margin:0 0 8px}
      .sk-side{min-width:230px;font-size:.85rem}
      .sk-controls{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 12px}
      .sk-btn{border:2px solid #111;background:#fff;color:#111;border-radius:999px;padding:6px 12px;font-weight:700;cursor:pointer}
      .sk-btn.on{background:#111;color:#fff}
      .sk-row{display:flex;align-items:center;gap:8px;margin:4px 0}
      .sk-feat{display:grid;grid-template-columns:1fr auto;gap:2px 8px;margin-top:6px}
      .sk-feat .k{color:#374151}
      .sk-dot{display:inline-block;width:12px;height:12px;border-radius:50%;background:#cbd5e1}
      .sk-dot.on{background:#e74c3c}
      .sk-dot.dir{background:#2563eb}
      .sk-dot.food{background:#f59e0b}
      .sk-legend{font-size:.78rem;color:#6b7280;margin-top:8px;line-height:1.5}
    </style>
    <div class="sk-wrap">
      <div>
        <p class="sk-status"></p>
        <canvas class="sk-canvas" width="${W}" height="${H}"></canvas>
      </div>
      <div class="sk-side">
        <div class="sk-controls">
          <button class="sk-btn sk-watch on">Watch AI</button>
          <button class="sk-btn sk-play">Play yourself</button>
          <button class="sk-btn sk-pause">Pause</button>
          <button class="sk-btn sk-reset">Reset</button>
        </div>
        <div class="sk-row">Speed <input class="sk-speed" type="range" min="30" max="220" value="90" style="flex:1"></div>
        <div class="sk-row"><label><input class="sk-flood" type="checkbox" checked> show survival flood-fill</label></div>
        <strong>DQN state vector (live)</strong>
        <div class="sk-feat"></div>
        <div class="sk-legend">
          <span class="sk-dot on" style="vertical-align:middle"></span> danger &nbsp;
          <span class="sk-dot dir" style="vertical-align:middle"></span> heading &nbsp;
          <span class="sk-dot food" style="vertical-align:middle"></span> food dir<br>
          The blue-tinted cells are the flood-fill region the AI checks so it never boxes itself in.
        </div>
      </div>
    </div>`;
  container.appendChild(root);

  const canvas = root.querySelector('.sk-canvas');
  const ctx = canvas.getContext('2d');
  const statusEl = root.querySelector('.sk-status');
  const featEl = root.querySelector('.sk-feat');

  const FEATURES = [
    ['danger straight', 'dangerStraight', 'on'], ['danger right', 'dangerRight', 'on'], ['danger left', 'dangerLeft', 'on'],
    ['moving left', 'dirLeft', 'dir'], ['moving right', 'dirRight', 'dir'], ['moving up', 'dirUp', 'dir'], ['moving down', 'dirDown', 'dir'],
    ['food left', 'foodLeft', 'food'], ['food right', 'foodRight', 'food'], ['food up', 'foodUp', 'food'], ['food down', 'foodDown', 'food'],
  ];
  const dots = {};
  for (const [label, key, cls] of FEATURES) {
    const k = document.createElement('span'); k.className = 'k'; k.textContent = label;
    const v = document.createElement('span'); const dot = document.createElement('span');
    dot.className = 'sk-dot ' + cls; v.appendChild(dot);
    featEl.appendChild(k); featEl.appendChild(v); dots[key] = { dot, cls };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,.04)';
    for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, H); ctx.stroke(); }
    for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(W, y * CELL); ctx.stroke(); }

    // flood-fill region for the move the AI would make next
    if (showFlood && !game.dead) {
      const region = SNK.floodFillRegion(game, mode === 'watch' ? SNK.chooseAction(game) : 0);
      ctx.fillStyle = 'rgba(59,130,246,.16)';
      for (const kk of region) { const [x, y] = kk.split(',').map(Number); ctx.fillRect(x * CELL, y * CELL, CELL, CELL); }
    }
    // food
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(game.food.x * CELL + 3, game.food.y * CELL + 3, CELL - 6, CELL - 6);
    // snake
    game.snake.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? '#34d399' : '#10b981';
      ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
    });
  }

  function updateInspector() {
    const st = SNK.stateVector(game);
    for (const [, key] of FEATURES) dots[key].dot.classList.toggle('on-lit', false);
    for (const [, key, cls] of FEATURES) {
      const on = !!st[key];
      const d = dots[key].dot;
      d.style.opacity = on ? '1' : '.25';
    }
  }

  function setStatus() {
    statusEl.textContent = game.dead
      ? `Game over — length ${game.snake.length} (score ${game.score}). Best ${best}.`
      : `${mode === 'watch' ? 'Watching the AI' : 'You’re driving'} — score ${game.score} · best ${best}`;
  }

  function tick() {
    if (!running || game.dead) return;
    if (mode === 'watch') SNK.step(game, SNK.chooseAction(game));
    else {
      if (pendingDir) { SNK.stepDir(game, pendingDir); pendingDir = null; }
      else SNK.step(game, 0);
    }
    best = Math.max(best, game.score);
    draw(); updateInspector(); setStatus();
    if (game.dead && mode === 'watch') setTimeout(() => { if (running) reset(); }, 1400);
  }

  function loop() { clearInterval(timer); timer = setInterval(tick, stepMs); }

  function reset() {
    game = SNK.newGame(COLS, ROWS); pendingDir = null;
    draw(); updateInspector(); setStatus(); loop();
  }

  // ── controls ──
  const btnWatch = root.querySelector('.sk-watch'), btnPlay = root.querySelector('.sk-play');
  const btnPause = root.querySelector('.sk-pause'), btnReset = root.querySelector('.sk-reset');
  function setMode(m) {
    mode = m;
    btnWatch.classList.toggle('on', m === 'watch');
    btnPlay.classList.toggle('on', m === 'play');
    reset();
  }
  btnWatch.addEventListener('click', () => setMode('watch'));
  btnPlay.addEventListener('click', () => setMode('play'));
  btnPause.addEventListener('click', () => {
    running = !running; btnPause.textContent = running ? 'Pause' : 'Resume';
    btnPause.classList.toggle('on', !running); if (running) loop();
  });
  btnReset.addEventListener('click', reset);
  root.querySelector('.sk-speed').addEventListener('input', (e) => { stepMs = 250 - (+e.target.value); loop(); });
  root.querySelector('.sk-flood').addEventListener('change', (e) => { showFlood = e.target.checked; draw(); });

  const KEYMAP = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', w: 'U', s: 'D', a: 'L', d: 'R' };
  function onKey(e) {
    if (mode !== 'play') return;
    const dir = KEYMAP[e.key] || KEYMAP[e.key.toLowerCase?.()];
    if (dir) { pendingDir = dir; e.preventDefault(); }
  }
  window.addEventListener('keydown', onKey);

  reset();
  return {
    destroy() {
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      container.innerHTML = '';
    },
  };
}
