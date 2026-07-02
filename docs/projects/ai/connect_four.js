/* ============================================================================
 * connect_four.js — Connect Four AI (browser reimplementation)
 * ----------------------------------------------------------------------------
 * The real project (C:\Users\graha\ML projects\connect_four) is a Deep-Q CNN
 * trained by self-play. GitHub Pages can't run PyTorch, so this module plays
 * the SAME game with a minimax + alpha-beta search whose evaluation reuses the
 * real project's reward-shaping ideas (threats, forks, center preference).
 *
 * ── How to optimize (this is the file to edit) ──────────────────────────────
 *   • WEIGHTS below tune the static evaluation (three-in-a-rows, forks, ...).
 *   • DEFAULT_DEPTH controls search strength (higher = stronger, slower).
 *   • Swap out `evaluate()` entirely to drop in a different heuristic, or wire
 *     in a real model's Q-values by replacing `evaluateColumns()`.
 *
 * ── Public interface (consumed by demos/connect_four.js) ────────────────────
 *   ROWS, COLS                         board dimensions (6 x 7)
 *   emptyBoard()                     → number[6][7] of 0
 *   validCols(board)                 → number[]   playable columns
 *   dropRow(board, col)              → row index a piece would land in, or -1
 *   applyMove(board, col, player)    → new board with the piece dropped
 *   winner(board)                    → 1 | -1 | 0 (0 = none), + winningLine()
 *   winningLine(board, player)       → [[r,c]..] of the winning four, or null
 *   isFull(board)                    → boolean
 *   chooseMove(board, player, opts)  → best column for `player` (1 or -1)
 *   evaluateColumns(board, player)   → number[7] score per column (Q-value bars)
 * ========================================================================== */

export const ROWS = 6;
export const COLS = 7;

// Evaluation weights — tweak these to change the AI's "personality".
const WEIGHTS = {
  win: 100000,        // a completed four
  three: 50,          // our open three (3 pieces + 1 empty in a window)
  two: 8,             // our developing two
  oppThree: 80,       // block: opponent open three (weighted higher than ours)
  oppTwo: 6,
  center: 4,          // per piece in the center column
  fork: 120,          // two simultaneous threes = usually unstoppable
};
const DEFAULT_DEPTH = 5;

export function emptyBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function validCols(board) {
  const cols = [];
  for (let c = 0; c < COLS; c++) if (board[0][c] === 0) cols.push(c);
  return cols;
}

export function dropRow(board, col) {
  if (col < 0 || col >= COLS || board[0][col] !== 0) return -1;
  for (let r = ROWS - 1; r >= 0; r--) if (board[r][col] === 0) return r;
  return -1;
}

export function applyMove(board, col, player) {
  const next = cloneBoard(board);
  const r = dropRow(next, col);
  if (r >= 0) next[r][col] = player;
  return next;
}

export function isFull(board) {
  return validCols(board).length === 0;
}

// Every 4-in-a-line window on the board (horizontal, vertical, both diagonals).
function* windows(board) {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS - 3; c++)
      yield [board[r][c], board[r][c + 1], board[r][c + 2], board[r][c + 3]];
  for (let r = 0; r < ROWS - 3; r++)
    for (let c = 0; c < COLS; c++)
      yield [board[r][c], board[r + 1][c], board[r + 2][c], board[r + 3][c]];
  for (let r = 0; r < ROWS - 3; r++)
    for (let c = 0; c < COLS - 3; c++)
      yield [board[r][c], board[r + 1][c + 1], board[r + 2][c + 2], board[r + 3][c + 3]];
  for (let r = 3; r < ROWS; r++)
    for (let c = 0; c < COLS - 3; c++)
      yield [board[r][c], board[r - 1][c + 1], board[r - 2][c + 2], board[r - 3][c + 3]];
}

function countWindow(win, player, target) {
  let p = 0, e = 0;
  for (const v of win) { if (v === player) p++; else if (v === 0) e++; }
  return p === target && e === 4 - target;
}

function countThreats(board, player, n) {
  let count = 0;
  for (const w of windows(board)) if (countWindow(w, player, n)) count++;
  return count;
}

export function winner(board) {
  for (const w of windows(board)) {
    if (w[0] !== 0 && w[0] === w[1] && w[1] === w[2] && w[2] === w[3]) return w[0];
  }
  return 0;
}

export function winningLine(board, player) {
  const lines = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS - 3; c++)
      lines.push([[r, c], [r, c + 1], [r, c + 2], [r, c + 3]]);
  for (let r = 0; r < ROWS - 3; r++)
    for (let c = 0; c < COLS; c++)
      lines.push([[r, c], [r + 1, c], [r + 2, c], [r + 3, c]]);
  for (let r = 0; r < ROWS - 3; r++)
    for (let c = 0; c < COLS - 3; c++)
      lines.push([[r, c], [r + 1, c + 1], [r + 2, c + 2], [r + 3, c + 3]]);
  for (let r = 3; r < ROWS; r++)
    for (let c = 0; c < COLS - 3; c++)
      lines.push([[r, c], [r - 1, c + 1], [r - 2, c + 2], [r - 3, c + 3]]);
  for (const line of lines) {
    if (line.every(([r, c]) => board[r][c] === player)) return line;
  }
  return null;
}

// Static evaluation from `player`'s point of view (positive = good for player).
export function evaluate(board, player) {
  const opp = -player;
  let score = 0;

  const myThree = countThreats(board, player, 3);
  const myTwo = countThreats(board, player, 2);
  const opThree = countThreats(board, opp, 3);
  const opTwo = countThreats(board, opp, 2);

  score += myThree * WEIGHTS.three + myTwo * WEIGHTS.two;
  score -= opThree * WEIGHTS.oppThree + opTwo * WEIGHTS.oppTwo;
  if (myThree >= 2) score += WEIGHTS.fork;      // fork bonus
  if (opThree >= 2) score -= WEIGHTS.fork;      // opponent fork is deadly

  const center = (COLS - 1) / 2 | 0;
  for (let r = 0; r < ROWS; r++) {
    if (board[r][center] === player) score += WEIGHTS.center;
    else if (board[r][center] === opp) score -= WEIGHTS.center;
  }
  return score;
}

function negamax(board, depth, alpha, beta, player) {
  const win = winner(board);
  if (win !== 0) {
    // Prefer faster wins / slower losses by folding depth into the score.
    return (win === player ? WEIGHTS.win : -WEIGHTS.win) * (depth + 1);
  }
  const cols = validCols(board);
  if (depth === 0 || cols.length === 0) return evaluate(board, player);

  // Try center-out for better alpha-beta pruning.
  cols.sort((a, b) => Math.abs(a - 3) - Math.abs(b - 3));
  let best = -Infinity;
  for (const col of cols) {
    const child = applyMove(board, col, player);
    const val = -negamax(child, depth - 1, -beta, -alpha, -player);
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// Per-column scores from `player`'s perspective — used for the Q-value-style bars.
export function evaluateColumns(board, player, opts = {}) {
  const depth = opts.depth ?? DEFAULT_DEPTH;
  const scores = new Array(COLS).fill(-Infinity);
  for (const col of validCols(board)) {
    const child = applyMove(board, col, player);
    const w = winner(child);
    if (w === player) { scores[col] = WEIGHTS.win * (depth + 2); continue; }
    scores[col] = -negamax(child, depth - 1, -Infinity, Infinity, -player);
  }
  return scores;
}

export function chooseMove(board, player, opts = {}) {
  const cols = validCols(board);
  if (cols.length === 0) return -1;
  const scores = evaluateColumns(board, player, opts);
  let bestCol = cols[0], bestVal = -Infinity;
  // Center-preferring tie-break keeps play sharp.
  const order = cols.slice().sort((a, b) => Math.abs(a - 3) - Math.abs(b - 3));
  for (const col of order) {
    if (scores[col] > bestVal) { bestVal = scores[col]; bestCol = col; }
  }
  return bestCol;
}
