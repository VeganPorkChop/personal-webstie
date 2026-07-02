/* ============================================================================
 * snake.js — Snake AI (browser reimplementation)
 * ----------------------------------------------------------------------------
 * The real project (C:\Users\graha\ML projects\snake_game) is a Deep-Q linear
 * net that reads an 11-feature state and chooses straight / right / left, with
 * a flood-fill "survival mask" that vetoes any move which would trap the snake.
 *
 * The trained weights can't run here, but the two pure-algorithm pieces DO port
 * verbatim: `survival.py`'s flood fill and `simple_agent.py`'s food heuristic.
 * So this is the real decision logic minus the learned tie-breaking.
 *
 * ── How to optimize (this is the file to edit) ──────────────────────────────
 *   • `SURVIVAL_MARGIN` — how much buffer space a move must leave (>1 = safer).
 *   • Replace `chooseAction()` to try a different policy (e.g. plug in a model
 *     that scores the three actions; keep `survivalMask()` as a safety net).
 *
 * ── Public interface (consumed by demos/snake.js) ───────────────────────────
 *   CW = ['R','D','L','U']              clockwise direction order
 *   newGame(cols, rows)              → game state object
 *   step(game, actionIdx)            → { dead, ate, score } (mutates game)
 *   stepDir(game, dir)              → step by absolute direction (player mode)
 *   chooseAction(game)               → 0 straight | 1 right | 2 left  (the AI)
 *   nextHead(game, actionIdx)        → {x,y} resulting head cell
 *   survivalMask(game)               → [safeStraight, safeRight, safeLeft]
 *   floodFillRegion(game, actionIdx) → Set("x,y") of reachable cells (overlay)
 *   stateVector(game)                → the 11 danger/direction/food features
 * ========================================================================== */

export const CW = ['R', 'D', 'L', 'U'];
const DELTA = { R: [1, 0], L: [-1, 0], U: [0, -1], D: [0, 1] };

export const SURVIVAL_MARGIN = 1.2;   // flood-fill buffer (matches the real default)

export function newGame(cols = 24, rows = 18) {
  const cx = Math.floor(cols / 2), cy = Math.floor(rows / 2);
  const game = {
    cols, rows, dir: 'R',
    snake: [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }],
    food: null, score: 0, dead: false, steps: 0,
  };
  placeFood(game);
  return game;
}

function key(p) { return p.x + ',' + p.y; }

export function placeFood(game) {
  const occupied = new Set(game.snake.map(key));
  const free = [];
  for (let y = 0; y < game.rows; y++)
    for (let x = 0; x < game.cols; x++)
      if (!occupied.has(x + ',' + y)) free.push({ x, y });
  game.food = free.length ? free[(Math.random() * free.length) | 0] : null;
}

function inBounds(game, p) {
  return p.x >= 0 && p.x < game.cols && p.y >= 0 && p.y < game.rows;
}

// Absolute direction that results from a relative action (0 straight,1 right,2 left).
function actionToDir(game, actionIdx) {
  const i = CW.indexOf(game.dir);
  if (actionIdx === 0) return CW[i];
  if (actionIdx === 1) return CW[(i + 1) % 4];
  return CW[(i + 3) % 4];
}

export function nextHead(game, actionIdx) {
  const d = DELTA[actionToDir(game, actionIdx)];
  const h = game.snake[0];
  return { x: h.x + d[0], y: h.y + d[1] };
}

// Advance the game by a relative action. Mutates and returns an outcome.
export function step(game, actionIdx) {
  if (game.dead) return { dead: true, ate: false, score: game.score };
  const dir = actionToDir(game, actionIdx);
  game.dir = dir;
  const head = nextHead(game, 0);   // 0 = straight, dir already updated

  const ate = game.food && head.x === game.food.x && head.y === game.food.y;
  // Body to test against: if not eating, the tail cell frees up this step.
  const body = new Set(game.snake.slice(0, ate ? game.snake.length : -1).map(key));
  if (!inBounds(game, head) || body.has(key(head))) {
    game.dead = true;
    return { dead: true, ate: false, score: game.score };
  }
  game.snake.unshift(head);
  if (ate) { game.score++; placeFood(game); }
  else game.snake.pop();
  game.steps++;
  return { dead: false, ate, score: game.score };
}

// Player mode: move by absolute direction (ignores 180° reversals).
export function stepDir(game, dir) {
  const i = CW.indexOf(game.dir);
  const j = CW.indexOf(dir);
  const diff = (j - i + 4) % 4;
  let action = 0;
  if (diff === 1) action = 1;
  else if (diff === 3) action = 2;
  else if (diff === 2) action = 0;   // can't reverse — keep going straight
  return step(game, action);
}

// ── Flood fill (ported from survival.py) ────────────────────────────────────
function floodCount(game, head, returnSet = false) {
  if (!inBounds(game, head)) return returnSet ? new Set() : 0;
  const ate = game.food && head.x === game.food.x && head.y === game.food.y;
  const body = new Set(game.snake.slice(0, ate ? game.snake.length : -1).map(key));
  if (body.has(key(head))) return returnSet ? new Set() : 0;

  const limit = game.snake.length;
  const visited = new Set([key(head)]);
  const queue = [head];
  while (queue.length) {
    if (!returnSet && visited.size > limit) return visited.size;
    const pt = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nb = { x: pt.x + dx, y: pt.y + dy };
      const k = key(nb);
      if (visited.has(k) || !inBounds(game, nb) || body.has(k)) continue;
      visited.add(k);
      queue.push(nb);
    }
  }
  return returnSet ? visited : visited.size;
}

export function floodFillRegion(game, actionIdx) {
  return floodCount(game, nextHead(game, actionIdx), true);
}

export function survivalMask(game, margin = SURVIVAL_MARGIN) {
  const threshold = game.snake.length * margin;
  const mask = [0, 1, 2].map((i) => floodCount(game, nextHead(game, i)) >= threshold);
  if (!mask.some(Boolean)) return [true, true, true];   // nothing to lose
  return mask;
}

// ── The AI ──────────────────────────────────────────────────────────────────
// The trained DQN learns to chase food without trapping itself. Reproduced here
// explicitly and robustly: BFS toward the food, but only commit to a step if the
// snake can still reach its own TAIL afterward (guarantees an escape route). If
// no safe path to food exists, follow open space (the survival flood fill) until
// one opens up. This is why the demo snake plays long, deliberate games.

// BFS over free cells; `blocked` is a Set of "x,y" obstacle keys. Returns the
// first-step head cell along a shortest path from `start` to `goal`, or null.
function bfsStep(game, start, goal, blocked) {
  const gk = goal.x + ',' + goal.y;
  const prev = new Map();
  const seen = new Set([start.x + ',' + start.y]);
  const q = [start];
  while (q.length) {
    const p = q.shift();
    if (p.x + ',' + p.y === gk) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nb = { x: p.x + dx, y: p.y + dy }, k = nb.x + ',' + nb.y;
      if (seen.has(k) || !inBounds(game, nb) || blocked.has(k)) continue;
      seen.add(k); prev.set(k, p); q.push(nb);
    }
  }
  if (!seen.has(gk)) return null;
  let cur = goal;
  while (prev.get(cur.x + ',' + cur.y) &&
         !(prev.get(cur.x + ',' + cur.y).x === start.x && prev.get(cur.x + ',' + cur.y).y === start.y)) {
    cur = prev.get(cur.x + ',' + cur.y);
  }
  return cur;   // the cell one step from the head toward the goal
}

// Can the snake still reach its tail after taking `actionIdx`? (escape-route test)
function tailReachable(game, actionIdx) {
  const h = nextHead(game, actionIdx);
  if (!inBounds(game, h)) return false;
  const ate = game.food && h.x === game.food.x && h.y === game.food.y;
  const newSnake = [h, ...game.snake.slice(0, ate ? game.snake.length : -1)];
  const tail = newSnake[newSnake.length - 1];
  if (h.x === tail.x && h.y === tail.y) return true;
  const blocked = new Set(newSnake.slice(1, -1).map(key));  // body minus head and tail
  if (blocked.has(key(h))) return false;                     // immediate self-collision
  return !!bfsStep(game, h, tail, blocked);
}

// Convert an absolute target neighbour cell to a relative action index.
function cellToAction(game, target) {
  for (const i of [0, 1, 2]) {
    const h = nextHead(game, i);
    if (h.x === target.x && h.y === target.y) return i;
  }
  return null;
}

export function chooseAction(game) {
  const head = game.snake[0];

  // 1) Head toward food along a free path — take the step if it keeps the tail
  //    reachable afterward (the rigorous safety guarantee; the survival mask alone
  //    over-vetoes and makes the snake orbit).
  const bodyBlocked = new Set(game.snake.slice(0, -1).map(key));   // tail will move
  const stepCell = bfsStep(game, head, game.food, bodyBlocked);
  if (stepCell) {
    const a = cellToAction(game, stepCell);
    if (a !== null && tailReachable(game, a)) return a;
  }

  // 2) No tail-safe path to food right now — stall productively by chasing the tail
  //    in the most open space. Ranked: tail-reachable, then space, then toward tail.
  const tail = game.snake[game.snake.length - 1];
  const lexGreater = (a, b) => {
    for (let i = 0; i < a.length; i++) { if (a[i] > b[i]) return true; if (a[i] < b[i]) return false; }
    return false;
  };
  let best = 0, bestKey = [-1, -1, -Infinity, -Infinity];
  for (const i of [0, 1, 2]) {
    const h = nextHead(game, i);
    const space = floodCount(game, h, true).size;                  // 0 = immediately fatal
    const tr = tailReachable(game, i) ? 1 : 0;
    const towardTail = -(Math.abs(h.x - tail.x) + Math.abs(h.y - tail.y));
    const key = [space > 0 ? 1 : 0, tr, space, towardTail];
    if (lexGreater(key, bestKey)) { bestKey = key; best = i; }
  }
  return best;
}

// ── The real 11-feature DQN state (for the live inspector panel) ─────────────
export function stateVector(game) {
  const h = game.snake[0];
  const body = new Set(game.snake.slice(1).map(key));
  const hit = (p) => !inBounds(game, p) || body.has(key(p));
  const P = (x, y) => ({ x, y });
  const pl = P(h.x - 1, h.y), pr = P(h.x + 1, h.y), pu = P(h.x, h.y - 1), pd = P(h.x, h.y + 1);
  const dl = game.dir === 'L', dr = game.dir === 'R', du = game.dir === 'U', dd = game.dir === 'D';

  const dangerStraight = (dr && hit(pr)) || (dl && hit(pl)) || (du && hit(pu)) || (dd && hit(pd));
  const dangerRight = (du && hit(pr)) || (dd && hit(pl)) || (dl && hit(pu)) || (dr && hit(pd));
  const dangerLeft = (dd && hit(pr)) || (du && hit(pl)) || (dr && hit(pu)) || (dl && hit(pd));

  return {
    dangerStraight, dangerRight, dangerLeft,
    dirLeft: dl, dirRight: dr, dirUp: du, dirDown: dd,
    foodLeft: game.food.x < h.x, foodRight: game.food.x > h.x,
    foodUp: game.food.y < h.y, foodDown: game.food.y > h.y,
  };
}
