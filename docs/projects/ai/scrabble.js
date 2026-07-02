/* ============================================================================
 * scrabble.js — Scrabble move engine (browser reimplementation)
 * ----------------------------------------------------------------------------
 * The real project (C:\Users\graha\ML projects\scrabble) is a full engine:
 * 15x15 premium board, a GADDAG move generator (Appel–Jacobson) over TWL06
 * (178k words), full cross-word + bingo scoring, and a ScrabbleNet value net.
 *
 * This module reproduces the engine with a trie-based generator (same
 * anchor + cross-check ideas as GADDAG) over a bundled TWL06 subset, and PORTS
 * the real scoring verbatim from `board.py` + `scoring.py` (premiums, all
 * cross-words, 50-pt bingo). The neural value net is replaced by ranking on raw
 * score — swap `rankMoves()` to plug a smarter evaluator back in.
 *
 * ── How to optimize (this is the file to edit) ──────────────────────────────
 *   • `rankMoves()` — change how candidate moves are ordered (score → equity).
 *   • Dictionary lives in ai/words.js (regenerate from a bigger TWL06 slice).
 *
 * ── Public interface (consumed by demos/scrabble.js) ────────────────────────
 *   SIZE, CENTER, TILE_SCORES, PREMIUM, TILE_DISTRIBUTION
 *   emptyBoard()                      → (null|string)[15][15]  (lowercase=blank)
 *   dealRack(n)                       → string[] rack ('?' = blank)
 *   bestMoves(board, rack, topN)      → Move[] ranked best-first
 *   applyMove(board, move)            → new board with the move placed
 *   Move = { word, placements:[{r,c,letter,isBlank}], row, col, horizontal, score, cells }
 * ========================================================================== */

import { WORDS } from './words.js';

export const SIZE = 15;
export const CENTER = 7;

export const TILE_SCORES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10, '?': 0,
};
export const TILE_DISTRIBUTION = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
  N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, '?': 2,
};

// Premium squares — built from the top-left quadrant by 4-fold symmetry (board.py).
const _QUAD = {
  '0,0': 'TW', '0,3': 'DL', '0,7': 'TW', '1,1': 'DW', '1,5': 'TL',
  '2,2': 'DW', '2,6': 'DL', '3,0': 'DL', '3,3': 'DW', '4,4': 'DW',
  '5,1': 'TL', '5,5': 'TL', '6,2': 'DL', '6,6': 'DL', '7,0': 'TW', '7,3': 'DL', '7,7': 'DW',
};
export const PREMIUM = (() => {
  const m = {};
  for (const [rc, kind] of Object.entries(_QUAD)) {
    const [r, c] = rc.split(',').map(Number);
    for (const row of [r, 14 - r]) for (const col of [c, 14 - c]) m[row + ',' + col] = kind;
  }
  return m;
})();

export function emptyBoard() {
  return Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
}
export function cloneBoard(board) { return board.map((row) => row.slice()); }

export function dealRack(n = 7) {
  const bag = [];
  for (const [L, cnt] of Object.entries(TILE_DISTRIBUTION)) for (let i = 0; i < cnt; i++) bag.push(L);
  const rack = [];
  for (let i = 0; i < n && bag.length; i++) rack.push(bag.splice((Math.random() * bag.length) | 0, 1)[0]);
  return rack;
}

// ── Trie (lazy, built once from the bundled dictionary) ─────────────────────
let _root = null;
function trie() {
  if (_root) return _root;
  _root = { c: {}, t: false };
  for (const w of WORDS) {                 // dictionary is lowercase; index the trie in UPPERCASE
    let node = _root;
    for (const ch of w) { const u = ch.toUpperCase(); node = node.c[u] || (node.c[u] = { c: {}, t: false }); }
    node.t = true;
  }
  return _root;
}

const up = (cell) => (cell == null ? null : cell.toUpperCase());
const isBlankCell = (cell) => cell != null && cell === cell.toLowerCase();

function boardEmpty(board) {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (board[r][c]) return false;
  return true;
}

function collectWord(board, r, c, horizontal) {
  const dr = horizontal ? 0 : 1, dc = horizontal ? 1 : 0;
  let sr = r, sc = c;
  while (sr - dr >= 0 && sc - dc >= 0 && board[sr - dr][sc - dc]) { sr -= dr; sc -= dc; }
  const cells = [];
  while (sr < SIZE && sc < SIZE && board[sr][sc]) { cells.push([sr, sc]); sr += dr; sc += dc; }
  return cells;
}

// Cross-check: for a horizontal move, which letters are legal at an empty (r,c)
// given the vertical neighbours? Returns a Set, or null if no cross word forms.
function crossAllowed(board, r, c, horizontal) {
  const dr = horizontal ? 1 : 0, dc = horizontal ? 0 : 1;   // perpendicular axis
  let pre = '', suf = '';
  let rr = r - dr, cc = c - dc;
  while (rr >= 0 && cc >= 0 && board[rr][cc]) { pre = up(board[rr][cc]) + pre; rr -= dr; cc -= dc; }
  rr = r + dr; cc = c + dc;
  while (rr < SIZE && cc < SIZE && board[rr][cc]) { suf += up(board[rr][cc]); rr += dr; cc += dc; }
  if (!pre && !suf) return null;                            // no perpendicular word
  const allowed = new Set();
  for (let i = 65; i <= 90; i++) {
    const L = String.fromCharCode(i);
    if (WORDS.has((pre + L + suf).toLowerCase())) allowed.add(L);
  }
  return allowed;
}
function hasPerp(board, r, c, horizontal) {
  const dr = horizontal ? 1 : 0, dc = horizontal ? 0 : 1;
  return (r - dr >= 0 && c - dc >= 0 && board[r - dr][c - dc]) ||
         (r + dr < SIZE && c + dc < SIZE && board[r + dr][c + dc]);
}

// ── Move generation (per-line DFS with trie pruning + cross-checks) ─────────
export function generateMoves(board, rack) {
  const first = boardEmpty(board);
  const rc = {};
  for (const t of rack) rc[t] = (rc[t] || 0) + 1;
  const moves = [];

  for (const horizontal of [true, false]) {
    for (let line = 0; line < SIZE; line++) {
      const cellAt = (i) => (horizontal ? board[line][i] : board[i][line]);
      const coord = (i) => (horizontal ? [line, i] : [i, line]);

      for (let start = 0; start < SIZE; start++) {
        if (start > 0 && cellAt(start - 1) != null) continue;   // don't truncate a word on the left

        const dfs = (idx, node, placements, connected, center) => {
          if (idx >= SIZE) {
            if (node.t && placements.length && (first ? center : connected)) record(placements);
            return;
          }
          const cell = cellAt(idx);
          if (cell != null) {                                    // forced existing letter
            const child = node.c[up(cell)];
            if (child) dfs(idx + 1, child, placements, true, center);
            return;
          }
          // could the word end just before this empty square?
          if (node.t && placements.length && (first ? center : connected)) record(placements);

          const [r, c] = coord(idx);
          const allow = crossAllowed(board, r, c, horizontal);
          const perp = allow != null;                            // cross word forms here
          const isC = r === CENTER && c === CENTER;
          for (const L in node.c) {
            if (allow && !allow.has(L)) continue;
            const child = node.c[L];
            if (rc[L] > 0) {
              rc[L]--; placements.push({ r, c, letter: L, isBlank: false });
              dfs(idx + 1, child, placements, connected || perp, center || isC);
              placements.pop(); rc[L]++;
            } else if (rc['?'] > 0) {
              rc['?']--; placements.push({ r, c, letter: L, isBlank: true });
              dfs(idx + 1, child, placements, connected || perp, center || isC);
              placements.pop(); rc['?']++;
            }
          }
        };

        const record = (placements) => {
          const tmp = cloneBoard(board);
          for (const p of placements) tmp[p.r][p.c] = p.isBlank ? p.letter.toLowerCase() : p.letter;
          const cells = collectWord(tmp, placements[0].r, placements[0].c, horizontal);
          const word = cells.map(([r, c]) => up(tmp[r][c])).join('');
          moves.push({
            word, placements: placements.map((x) => ({ ...x })),
            row: cells[0][0], col: cells[0][1], horizontal,
            cells, score: scoreMove(board, placements, horizontal),
          });
        };

        dfs(start, trie(), [], false, false);
      }
    }
  }
  return dedupe(moves);
}

function dedupe(moves) {
  const seen = new Set();
  const out = [];
  for (const m of moves) {
    const key = m.placements.map((p) => p.r + ',' + p.c + p.letter).sort().join('|') + (m.horizontal ? 'H' : 'V');
    if (seen.has(key)) continue;
    seen.add(key); out.push(m);
  }
  return out;
}

// ── Scoring (ported verbatim from board.py + scoring.py) ────────────────────
function scoreWord(board, cells, newSquares) {
  let raw = 0, wordMult = 1;
  for (const [r, c] of cells) {
    const cell = board[r][c];
    let base = isBlankCell(cell) ? 0 : (TILE_SCORES[up(cell)] || 0);
    if (newSquares.has(r + ',' + c)) {
      const prem = PREMIUM[r + ',' + c];
      if (prem === 'DL') base *= 2;
      else if (prem === 'TL') base *= 3;
      else if (prem === 'DW') wordMult *= 2;
      else if (prem === 'TW') wordMult *= 3;
    }
    raw += base;
  }
  return raw * wordMult;
}

export function scoreMove(board, placements, horizontal) {
  const tmp = cloneBoard(board);
  for (const p of placements) tmp[p.r][p.c] = p.isBlank ? p.letter.toLowerCase() : p.letter;
  const newSquares = new Set(placements.map((p) => p.r + ',' + p.c));
  let total = 0;
  const scored = new Set();

  const main = collectWord(tmp, placements[0].r, placements[0].c, horizontal);
  const mkey = main.map((x) => x.join(',')).sort().join('|');
  if (main.length > 1) { total += scoreWord(tmp, main, newSquares); scored.add(mkey); }

  for (const p of placements) {
    const cross = collectWord(tmp, p.r, p.c, !horizontal);
    const key = cross.map((x) => x.join(',')).sort().join('|');
    if (cross.length > 1 && !scored.has(key)) { total += scoreWord(tmp, cross, newSquares); scored.add(key); }
  }
  if (placements.length === 7) total += 50;                  // bingo
  return total;
}

export function applyMove(board, move) {
  const next = cloneBoard(board);
  for (const p of move.placements) next[p.r][p.c] = p.isBlank ? p.letter.toLowerCase() : p.letter;
  return next;
}

// ── Ranking (swap this for an equity/model-based evaluator) ─────────────────
export function rankMoves(moves) {
  return moves.slice().sort((a, b) => b.score - a.score);
}

export function bestMoves(board, rack, topN = 8) {
  return rankMoves(generateMoves(board, rack)).slice(0, topN);
}
