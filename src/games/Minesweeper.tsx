import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

/* ------------------------------------------------------------------ */
/* Types & constants                                                   */
/* ------------------------------------------------------------------ */

type PresetId = 'associate' | 'counsel' | 'partner';

interface Preset {
  id: PresetId;
  label: string;
  rows: number;
  cols: number;
  mines: number;
}

const PRESETS: ReadonlyArray<Preset> = [
  { id: 'associate', label: 'Associate', rows: 9, cols: 9, mines: 10 },
  { id: 'counsel', label: 'Counsel', rows: 16, cols: 16, mines: 40 },
  { id: 'partner', label: 'Partner', rows: 16, cols: 30, mines: 99 },
];

interface Cell {
  mine: boolean;
  revealed: boolean;
  flagged: boolean;
  adjacent: number;
  exploded: boolean;
}

type Status = 'idle' | 'playing' | 'won' | 'lost';

type Board = Cell[][];

const BEST_KEY = 'circuitus_minesweeper_best';

/** House-palette number colors instead of the classic primaries. */
const NUM_COLOR: ReadonlyArray<string> = [
  '',
  'text-navy',
  'text-brass-dim',
  'text-claret',
  'text-navy-light',
  'text-claret-dark',
  'text-brass',
  'text-ink-soft',
  'text-ink-muted',
];

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

function emptyBoard(rows: number, cols: number): Board {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({
      mine: false,
      revealed: false,
      flagged: false,
      adjacent: 0,
      exploded: false,
    })),
  );
}

function cloneBoard(b: Board): Board {
  return b.map((row) => row.map((cell) => ({ ...cell })));
}

function neighbors(b: Board, r: number, c: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < b.length && nc >= 0 && nc < b[0].length) out.push([nr, nc]);
    }
  }
  return out;
}

/** Place mines, keeping the first-clicked cell (and its ring, if possible) clear. */
function placeMines(board: Board, mines: number, safeR: number, safeC: number): Board {
  const rows = board.length;
  const cols = board[0].length;
  const next = cloneBoard(board);
  const excluded = new Set<number>();
  excluded.add(safeR * cols + safeC);
  if (rows * cols - 9 >= mines) {
    for (const [nr, nc] of neighbors(next, safeR, safeC)) excluded.add(nr * cols + nc);
  }
  const open: number[] = [];
  for (let i = 0; i < rows * cols; i++) {
    if (!excluded.has(i)) open.push(i);
  }
  for (let i = open.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [open[i], open[j]] = [open[j], open[i]];
  }
  for (const idx of open.slice(0, mines)) {
    next[Math.floor(idx / cols)][idx % cols].mine = true;
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      next[r][c].adjacent = neighbors(next, r, c).filter(([nr, nc]) => next[nr][nc].mine).length;
    }
  }
  return next;
}

/** Reveal a set of cells (flood-filling zeros). Returns hitMine when a mine was opened. */
function revealCells(board: Board, targets: Array<[number, number]>): { board: Board; hitMine: boolean } {
  const next = cloneBoard(board);
  let hitMine = false;
  const queue: Array<[number, number]> = [...targets];
  while (queue.length > 0) {
    const item = queue.pop();
    if (!item) break;
    const [r, c] = item;
    const cell = next[r][c];
    if (cell.revealed || cell.flagged) continue;
    cell.revealed = true;
    if (cell.mine) {
      cell.exploded = true;
      hitMine = true;
      continue;
    }
    if (cell.adjacent === 0) {
      for (const [nr, nc] of neighbors(next, r, c)) {
        if (!next[nr][nc].revealed && !next[nr][nc].flagged) queue.push([nr, nc]);
      }
    }
  }
  return { board: next, hitMine };
}

function exposeAllMines(board: Board): Board {
  return board.map((row) =>
    row.map((cell) => (cell.mine ? { ...cell, revealed: true } : { ...cell })),
  );
}

function countRevealed(board: Board): number {
  let n = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell.revealed) n++;
    }
  }
  return n;
}

function countFlags(board: Board): number {
  let n = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell.flagged) n++;
    }
  }
  return n;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function loadBest(): Partial<Record<PresetId, number>> {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<PresetId, number>> = {};
    for (const p of PRESETS) {
      const v = parsed[p.id];
      if (typeof v === 'number' && v > 0) out[p.id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function Minesweeper() {
  const [presetId, setPresetId] = useState<PresetId>('associate');
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  const [board, setBoard] = useState<Board>(() => emptyBoard(9, 9));
  const [status, setStatus] = useState<Status>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [best, setBest] = useState<Partial<Record<PresetId, number>>>(loadBest);

  const longPressRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  const flagsUsed = countFlags(board);
  const flagsLeft = preset.mines - flagsUsed;

  useEffect(() => {
    if (status !== 'playing') return;
    const t = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(t);
  }, [status]);

  function resetTo(id: PresetId) {
    const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
    setPresetId(id);
    setBoard(emptyBoard(p.rows, p.cols));
    setStatus('idle');
    setElapsed(0);
  }

  function finishIfWon(b: Board): Board {
    if (countRevealed(b) === preset.rows * preset.cols - preset.mines) {
      setStatus('won');
      const t = elapsed;
      setBest((prev) => {
        const cur = prev[presetId];
        if (cur !== undefined && cur <= t) return prev;
        const next = { ...prev, [presetId]: t };
        try {
          localStorage.setItem(BEST_KEY, JSON.stringify(next));
        } catch {
          // storage unavailable — best times simply not retained
        }
        return next;
      });
      // Courtesy: flag every remaining mine on the cleared matrix.
      return b.map((row) =>
        row.map((cell) => (cell.mine && !cell.flagged ? { ...cell, flagged: true } : cell)),
      );
    }
    return b;
  }

  function handleReveal(r: number, c: number) {
    if (status === 'won' || status === 'lost') return;
    if (board[r][c].flagged || board[r][c].revealed) return;
    let b = board;
    if (status === 'idle') {
      b = placeMines(b, preset.mines, r, c);
      setStatus('playing');
    }
    const { board: revealed, hitMine } = revealCells(b, [[r, c]]);
    if (hitMine) {
      setBoard(exposeAllMines(revealed));
      setStatus('lost');
      return;
    }
    setBoard(finishIfWon(revealed));
  }

  function toggleFlag(r: number, c: number) {
    if (status === 'won' || status === 'lost') return;
    setBoard((prev) => {
      if (prev[r][c].revealed) return prev;
      const next = cloneBoard(prev);
      next[r][c].flagged = !next[r][c].flagged;
      return next;
    });
  }

  /** Chord: reveal unflagged neighbors of a satisfied number. */
  function chord(r: number, c: number) {
    if (status !== 'playing') return;
    const cell = board[r][c];
    if (!cell.revealed || cell.adjacent === 0) return;
    const around = neighbors(board, r, c);
    const flagged = around.filter(([nr, nc]) => board[nr][nc].flagged).length;
    if (flagged !== cell.adjacent) return;
    const targets = around.filter(([nr, nc]) => !board[nr][nc].flagged && !board[nr][nc].revealed);
    if (targets.length === 0) return;
    const { board: revealed, hitMine } = revealCells(board, targets);
    if (hitMine) {
      setBoard(exposeAllMines(revealed));
      setStatus('lost');
      return;
    }
    setBoard(finishIfWon(revealed));
  }

  function clearLongPress() {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLButtonElement>, r: number, c: number) {
    if (e.pointerType !== 'touch') return;
    clearLongPress();
    longPressRef.current = window.setTimeout(() => {
      longPressRef.current = null;
      suppressClickRef.current = true;
      toggleFlag(r, c);
    }, 450);
  }

  function handleClick(r: number, c: number) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const cell = board[r][c];
    if (cell.revealed) chord(r, c);
    else handleReveal(r, c);
  }

  function handleMouseDown(e: ReactMouseEvent<HTMLButtonElement>, r: number, c: number) {
    if (e.button === 1) {
      e.preventDefault();
      chord(r, c);
    }
  }

  const lost = status === 'lost';

  function cellContent(cell: Cell): string {
    if (cell.flagged && !cell.revealed) {
      return lost && !cell.mine ? '✗' : '⚑'; // '✗' marks a misfiled flag at loss
    }
    if (!cell.revealed) return '';
    if (cell.mine) return '✸';
    return cell.adjacent > 0 ? String(cell.adjacent) : '';
  }

  function cellClasses(cell: Cell): string {
    if (!cell.revealed) {
      const flag = cell.flagged ? 'text-claret' : 'text-transparent';
      return `bg-paper-warm hover:bg-paper border-rule-strong ${flag}`;
    }
    if (cell.mine) {
      return cell.exploded
        ? 'bg-claret text-paper border-claret-dark'
        : 'bg-paper-cool text-ink border-rule';
    }
    return `bg-paper-cool border-rule ${NUM_COLOR[cell.adjacent]}`;
  }

  return (
    <div className="flex flex-col items-center py-8 select-none">
      <p className="text-[10px] font-sans uppercase tracking-[0.2em] text-navy/60 mb-1">
        Diligence Exercise · Risk Assessment Matrix
      </p>
      <h2 className="font-serif text-navy text-xl font-bold mb-4">Risk Assessment Matrix</h2>

      <div className="flex items-center gap-4 mb-4 flex-wrap justify-center px-4">
        <div className="flex border border-border rounded overflow-hidden">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => resetTo(p.id)}
              className={`px-2.5 py-1 text-[9px] font-sans uppercase tracking-wider ${
                p.id === presetId
                  ? 'bg-navy text-paper'
                  : 'bg-white text-text-muted hover:bg-cream'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-[10px] font-mono text-text-muted">
          Liabilities: <span className="text-claret">{flagsLeft}</span>
        </span>
        <span className="text-[10px] font-mono text-text-muted">
          Time: <span className="text-navy">{fmtTime(elapsed)}</span>
        </span>
        {best[presetId] !== undefined && (
          <span className="text-[10px] font-mono text-text-muted">
            Best: <span className="text-brass">{fmtTime(best[presetId] ?? 0)}</span>
          </span>
        )}
        <button
          onClick={() => resetTo(presetId)}
          className="text-[10px] font-sans uppercase tracking-wider text-blue-600 hover:underline"
        >
          New Assessment
        </button>
      </div>

      <div className="max-w-full overflow-x-auto px-4">
        <div
          className="inline-block border-2 border-navy bg-rule"
          onContextMenu={(e) => e.preventDefault()}
        >
          {board.map((row, r) => (
            <div key={r} className="flex">
              {row.map((cell, c) => (
                <button
                  key={c}
                  onClick={() => handleClick(r, c)}
                  onDoubleClick={() => chord(r, c)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toggleFlag(r, c);
                  }}
                  onMouseDown={(e) => handleMouseDown(e, r, c)}
                  onPointerDown={(e) => handlePointerDown(e, r, c)}
                  onPointerUp={clearLongPress}
                  onPointerLeave={clearLongPress}
                  onPointerCancel={clearLongPress}
                  className={`w-[22px] h-[22px] border flex items-center justify-center font-mono text-[11px] font-bold leading-none ${cellClasses(cell)}`}
                  style={{ touchAction: 'manipulation' }}
                >
                  {cellContent(cell)}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {status === 'won' && (
        <div className="mt-5 border border-brass/40 bg-paper-cool rounded px-5 py-3 text-center">
          <p className="font-serif text-navy text-base">Matrix cleared — exposure assessed.</p>
          <p className="text-[10px] font-mono text-text-muted mt-0.5">
            {fmtTime(elapsed)}
            {best[presetId] === elapsed ? ' · new best for this tier' : ''}
          </p>
          <button
            onClick={() => resetTo(presetId)}
            className="mt-1.5 text-[10px] font-sans uppercase tracking-wider text-blue-600 hover:underline"
          >
            New assessment
          </button>
        </div>
      )}

      {status === 'lost' && (
        <div className="mt-5 border border-claret/40 bg-paper-cool rounded px-5 py-3 text-center">
          <p className="font-serif text-claret text-base">Undisclosed liability encountered.</p>
          <button
            onClick={() => resetTo(presetId)}
            className="mt-1.5 text-[10px] font-sans uppercase tracking-wider text-blue-600 hover:underline"
          >
            Reassess
          </button>
        </div>
      )}

      {status !== 'won' && status !== 'lost' && (
        <p className="mt-4 text-[10px] font-sans text-text-muted/70 text-center px-6">
          Click to examine a position. Right-click (or long-press) to flag a suspected liability.
          Double-click or middle-click a satisfied disclosure to examine its neighbors.
        </p>
      )}
    </div>
  );
}
