import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  MoreVertical,
  Play,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { deleteMatter, getAllMatters, saveMatter } from '@/lib/storage';
import type { MatterCard, MatterStage } from '@/types';

/* ------------------------------------------------------------------ */
/* Constants & helpers                                                 */
/* ------------------------------------------------------------------ */

const TIMEKEEPER_KEY = 'circuitus_timekeeper';

const STAGES: ReadonlyArray<{ id: MatterStage; label: string }> = [
  { id: 'pending', label: 'Pending Review' },
  { id: 'preparation', label: 'In Preparation' },
  { id: 'filed', label: 'Filed & Closed' },
];

const STAGE_AFTER: Record<MatterStage, MatterStage | null> = {
  pending: 'preparation',
  preparation: 'filed',
  filed: null,
};

const STAGE_BEFORE: Record<MatterStage, MatterStage | null> = {
  pending: null,
  preparation: 'pending',
  filed: 'preparation',
};

interface TimekeeperState {
  activeMatterId: string | null;
  /** Epoch ms when the running entry began; null when the clock is stopped. */
  startedAt: number | null;
}

interface DragState {
  id: string;
  srcStage: MatterStage;
  srcIndex: number;
  x: number;
  y: number;
  offX: number;
  offY: number;
  width: number;
}

interface DropTarget {
  stage: MatterStage;
  index: number;
}

function loadTimekeeper(): TimekeeperState {
  try {
    const raw = localStorage.getItem(TIMEKEEPER_KEY);
    if (!raw) return { activeMatterId: null, startedAt: null };
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      activeMatterId: typeof p.activeMatterId === 'string' ? p.activeMatterId : null,
      startedAt: typeof p.startedAt === 'number' ? p.startedAt : null,
    };
  } catch {
    return { activeMatterId: null, startedAt: null };
  }
}

/** Next docket-style number, derived from the highest sequence already issued. */
function nextMatterNumber(existing: MatterCard[]): string {
  let max = 100;
  for (const m of existing) {
    const match = /^M-\d{4}-(\d+)$/.exec(m.matterNumber);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `M-2026-${String(max + 1).padStart(4, '0')}`;
}

function fmtHMS(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Billing tenths: ceil to the next 6-minute (0.1 hr) increment. */
function billedTenths(seconds: number): number {
  return Math.ceil(seconds / 360);
}

function fmtHours(seconds: number): string {
  return (billedTenths(seconds) / 10).toFixed(1);
}

function byOrder(a: MatterCard, b: MatterCard): number {
  return a.order - b.order || a.createdAt.localeCompare(b.createdAt);
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function MattersPage() {
  const [matters, setMatters] = useState<MatterCard[]>([]);
  const [composer, setComposer] = useState<Record<MatterStage, string>>({
    pending: '',
    preparation: '',
    filed: '',
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmStrike, setConfirmStrike] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const [timer, setTimer] = useState<TimekeeperState>(loadTimekeeper);
  const [now, setNow] = useState(() => Date.now());

  const didDragRef = useRef(false);
  const dropRef = useRef<DropTarget | null>(null);
  const moveToRef = useRef<(id: string, destStage: MatterStage, index: number) => void>(() => {});

  const running = timer.startedAt !== null;
  const elapsed = running
    ? Math.max(0, Math.floor((now - (timer.startedAt ?? 0)) / 1000))
    : 0;

  const columns = useMemo(() => {
    const by: Record<MatterStage, MatterCard[]> = { pending: [], preparation: [], filed: [] };
    for (const m of matters) by[m.stage].push(m);
    for (const { id } of STAGES) by[id].sort(byOrder);
    return by;
  }, [matters]);

  const editing = useMemo(
    () => matters.find((m) => m.id === editingId) ?? null,
    [matters, editingId],
  );

  const billable = useMemo(
    () => matters.filter((m) => m.stage !== 'filed').sort(byOrder),
    [matters],
  );

  /* ----- effects ----- */

  // Initial load; drop a stale Timekeeper selection (struck or filed matter).
  useEffect(() => {
    void getAllMatters().then((all) => {
      setMatters(all);
      setTimer((t) => {
        if (!t.activeMatterId) return t;
        const m = all.find((x) => x.id === t.activeMatterId);
        if (!m || m.stage === 'filed') return { activeMatterId: null, startedAt: null };
        return t;
      });
    });
  }, []);

  // Persist Timekeeper state so a reload resumes the running clock.
  useEffect(() => {
    try {
      if (timer.activeMatterId === null && timer.startedAt === null) {
        localStorage.removeItem(TIMEKEEPER_KEY);
      } else {
        localStorage.setItem(TIMEKEEPER_KEY, JSON.stringify(timer));
      }
    } catch {
      // Storage unavailable — the clock still runs for this visit.
    }
  }, [timer]);

  // 1-second display tick, only while the clock is running. `now` is already
  // fresh on both entry paths (mount initializer, startClock), so the interval
  // alone keeps the readout current.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  /* ----- mutations (every one persists immediately) ----- */

  function addMatter(stage: MatterStage) {
    const title = composer[stage].trim();
    if (!title) return;
    const nowIso = new Date().toISOString();
    const col = columns[stage];
    const card: MatterCard = {
      id: crypto.randomUUID(),
      title,
      notes: '',
      stage,
      matterNumber: nextMatterNumber(matters),
      billedSeconds: 0,
      order: (col[0]?.order ?? 1) - 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    setMatters((prev) => [...prev, card]);
    setComposer((prev) => ({ ...prev, [stage]: '' }));
    void saveMatter(card);
  }

  function updateCard(id: string, patch: Partial<Pick<MatterCard, 'title' | 'notes' | 'billedSeconds'>>) {
    const card = matters.find((m) => m.id === id);
    if (!card) return;
    const next: MatterCard = { ...card, ...patch, updatedAt: new Date().toISOString() };
    setMatters((prev) => prev.map((m) => (m.id === id ? next : m)));
    void saveMatter(next);
  }

  function strikeMatter(id: string) {
    if (timer.activeMatterId === id) setTimer({ activeMatterId: null, startedAt: null });
    setMatters((prev) => prev.filter((m) => m.id !== id));
    setEditingId(null);
    void deleteMatter(id);
  }

  /**
   * Move a card to `destStage` at `index`, where `index` is a position in the
   * destination column *without* the moving card. Orders in the destination
   * column are re-normalized to sequential integers and persisted.
   */
  function moveTo(id: string, destStage: MatterStage, index: number) {
    const card = matters.find((m) => m.id === id);
    if (!card) return;
    const nowIso = new Date().toISOString();

    // Filing a matter retires it from the Timekeeper; a running clock is
    // stopped and its elapsed time banked first.
    let extraSeconds = 0;
    if (destStage === 'filed' && timer.activeMatterId === id) {
      if (timer.startedAt !== null) {
        extraSeconds = Math.max(0, Math.floor((Date.now() - timer.startedAt) / 1000));
      }
      setTimer({ activeMatterId: null, startedAt: null });
    }

    const moved: MatterCard = {
      ...card,
      stage: destStage,
      billedSeconds: card.billedSeconds + extraSeconds,
      updatedAt: nowIso,
    };
    const dest = matters.filter((m) => m.stage === destStage && m.id !== id).sort(byOrder);
    const clamped = Math.max(0, Math.min(index, dest.length));
    dest.splice(clamped, 0, moved);

    const changed = new Map<string, MatterCard>();
    dest.forEach((m, i) => {
      if (m.id === id) changed.set(id, { ...moved, order: i });
      else if (m.order !== i) changed.set(m.id, { ...m, order: i });
    });
    setMatters((prev) => prev.map((m) => changed.get(m.id) ?? m));
    for (const m of changed.values()) void saveMatter(m);
  }
  // Latest version for window-level pointer listeners created mid-drag.
  useEffect(() => {
    moveToRef.current = moveTo;
  });

  function advance(m: MatterCard) {
    const next = STAGE_AFTER[m.stage];
    if (next) moveTo(m.id, next, 0);
  }

  function retreat(m: MatterCard) {
    const prev = STAGE_BEFORE[m.stage];
    if (prev) moveTo(m.id, prev, 0);
  }

  function nudge(m: MatterCard, dir: -1 | 1) {
    const idx = columns[m.stage].findIndex((c) => c.id === m.id);
    if (idx < 0) return;
    // Index is in without-the-card space: up inserts at idx-1, down at idx+1.
    moveTo(m.id, m.stage, Math.max(0, idx + dir));
  }

  /* ----- Timekeeper ----- */

  function startClock() {
    if (running || !timer.activeMatterId) return;
    const startedAt = Date.now();
    setNow(startedAt);
    setTimer((t) => ({ ...t, startedAt }));
  }

  function stopClock() {
    if (timer.startedAt === null) return;
    const seconds = Math.max(0, Math.floor((Date.now() - timer.startedAt) / 1000));
    const id = timer.activeMatterId;
    setTimer((t) => ({ ...t, startedAt: null }));
    if (id && seconds > 0) updateCard(id, {
      billedSeconds: (matters.find((m) => m.id === id)?.billedSeconds ?? 0) + seconds,
    });
  }

  /* ----- drag & drop (pointer events, no library) ----- */

  function startDrag(
    e: ReactPointerEvent<HTMLDivElement>,
    card: MatterCard,
    srcIndex: number,
  ) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input, textarea, select, a')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const offX = startX - rect.left;
    const offY = startY - rect.top;
    const width = rect.width;
    const { id, stage: srcStage } = card;
    let dragging = false;

    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        dragging = true;
        didDragRef.current = true;
        setMenuId(null);
      }
      setDrag({ id, srcStage, srcIndex, x: ev.clientX, y: ev.clientY, offX, offY, width });
      const colEl = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest('[data-col]');
      if (!colEl) {
        dropRef.current = null;
        setDropTarget(null);
        return;
      }
      const stage = colEl.getAttribute('data-col') as MatterStage;
      const cardEls = colEl.querySelectorAll('[data-card-id]');
      let index = cardEls.length;
      for (let i = 0; i < cardEls.length; i++) {
        const r = cardEls[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          index = i;
          break;
        }
      }
      const target: DropTarget = { stage, index };
      dropRef.current = target;
      setDropTarget(target);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const target = dropRef.current;
      dropRef.current = null;
      setDrag(null);
      setDropTarget(null);
      if (dragging && target) {
        // The rendered column still contains the dragged card; convert the
        // visual index to without-the-card space before applying.
        let index = target.index;
        if (target.stage === srcStage && index > srcIndex) index -= 1;
        moveToRef.current(id, target.stage, index);
      }
      // Let the synthetic click (which fires before timers) see didDrag=true.
      window.setTimeout(() => {
        didDragRef.current = false;
      }, 0);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function openMatter(id: string) {
    if (didDragRef.current) return;
    setConfirmStrike(false);
    setConfirmClear(false);
    setEditingId(id);
  }

  /* ----- derived Timekeeper display data ----- */

  const dragCard = drag ? matters.find((m) => m.id === drag.id) ?? null : null;

  const recordRows = matters
    .map((m) => ({
      matter: m,
      seconds: m.billedSeconds + (running && timer.activeMatterId === m.id ? elapsed : 0),
    }))
    .filter((r) => r.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);
  const totalTenths = recordRows.reduce((acc, r) => acc + billedTenths(r.seconds), 0);

  /* ----- render ----- */

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-hidden">
      {/* Masthead */}
      <div className="text-center pt-5 pb-4 border-b border-border flex-shrink-0 px-6">
        <p className="text-[10px] font-serif uppercase tracking-[0.2em] text-navy/60">
          Practice Management · Docket Control
        </p>
        <h1 className="font-serif font-bold text-2xl text-navy mt-0.5">Matters</h1>
        <p className="text-[10px] font-mono text-text-muted mt-1">
          Active matters · workflow board · contemporaneous time records
        </p>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Board */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-4 px-5 py-4 h-full min-w-[700px]">
            {STAGES.map(({ id: stage, label }) => {
              const cards = columns[stage];
              const isFiledCol = stage === 'filed';
              return (
                <div
                  key={stage}
                  className="flex-1 min-w-[215px] flex flex-col border border-border bg-sidebar-bg"
                >
                  <div className="px-3 py-2 border-b border-border flex items-baseline justify-between flex-shrink-0">
                    <h3 className="text-[10px] font-sans font-semibold uppercase tracking-[0.15em] text-text-muted">
                      {label}
                    </h3>
                    <span className="text-[10px] font-mono text-text-muted/70">{cards.length}</span>
                  </div>
                  <div className="px-2 pt-2 flex-shrink-0">
                    <input
                      type="text"
                      value={composer[stage]}
                      onChange={(e) =>
                        setComposer((prev) => ({ ...prev, [stage]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addMatter(stage);
                      }}
                      placeholder="Open new matter…"
                      className="w-full bg-white border border-border px-2 py-1.5 text-xs font-sans text-text-main placeholder-text-muted/60 focus:outline-none focus:border-gold/60"
                    />
                  </div>
                  <div data-col={stage} className="flex-1 overflow-y-auto px-2 py-2">
                    {cards.length === 0 && dropTarget?.stage !== stage && (
                      <p className="text-[10px] font-sans text-text-muted/60 text-center pt-6 leading-relaxed px-3">
                        No matters at this stage.
                      </p>
                    )}
                    {cards.map((m, i) => {
                      const isDragSource = drag?.id === m.id;
                      return (
                        <Fragment key={m.id}>
                          {dropTarget?.stage === stage && dropTarget.index === i && (
                            <div className="h-[2px] bg-brass mb-1.5" />
                          )}
                          <div
                            data-card-id={m.id}
                            onClick={() => openMatter(m.id)}
                            onPointerDown={(e) => startDrag(e, m, i)}
                            className={`relative bg-white border border-border px-3 py-2 mb-1.5 cursor-grab select-none shadow-sheet transition-opacity ${
                              isFiledCol ? 'opacity-70' : ''
                            } ${isDragSource ? 'opacity-30' : ''}`}
                            style={{ touchAction: 'none' }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-serif text-[13px] font-bold text-navy leading-snug">
                                {m.title}
                              </p>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMenuId((prev) => (prev === m.id ? null : m.id));
                                }}
                                className="p-0.5 -mr-1 text-text-muted hover:text-navy flex-shrink-0"
                                title="Matter actions"
                                aria-label={`Actions for ${m.matterNumber}`}
                              >
                                <MoreVertical className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[9px] font-mono text-text-muted">
                                {m.matterNumber}
                              </span>
                              {m.billedSeconds > 0 && (
                                <span className="text-[9px] font-mono text-brass">
                                  {fmtHours(m.billedSeconds)} hrs
                                </span>
                              )}
                              {isFiledCol && (
                                <span className="text-[9px] font-serif text-claret border border-claret/40 px-1 leading-tight -rotate-2">
                                  § Filed
                                </span>
                              )}
                            </div>
                            {m.notes.trim() !== '' && (
                              <p className="mt-1 text-[10px] font-sans text-text-muted leading-snug line-clamp-2">
                                {m.notes}
                              </p>
                            )}

                            {menuId === m.id && (
                              <>
                                <div
                                  className="fixed inset-0 z-10 cursor-default"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMenuId(null);
                                  }}
                                />
                                <div
                                  className="absolute right-1 top-6 z-20 bg-white border border-border shadow-sheet py-1 w-36"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {STAGE_AFTER[m.stage] && (
                                    <button
                                      onClick={() => {
                                        setMenuId(null);
                                        advance(m);
                                      }}
                                      className="w-full flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-sans text-text-main hover:bg-cream text-left"
                                    >
                                      <ArrowRight className="w-3 h-3 text-text-muted" /> Advance stage
                                    </button>
                                  )}
                                  {STAGE_BEFORE[m.stage] && (
                                    <button
                                      onClick={() => {
                                        setMenuId(null);
                                        retreat(m);
                                      }}
                                      className="w-full flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-sans text-text-main hover:bg-cream text-left"
                                    >
                                      <ArrowLeft className="w-3 h-3 text-text-muted" /> Return stage
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      setMenuId(null);
                                      nudge(m, -1);
                                    }}
                                    disabled={i === 0}
                                    className="w-full flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-sans text-text-main hover:bg-cream text-left disabled:text-text-muted/40 disabled:hover:bg-transparent"
                                  >
                                    <ArrowUp className="w-3 h-3 text-text-muted" /> Move up
                                  </button>
                                  <button
                                    onClick={() => {
                                      setMenuId(null);
                                      nudge(m, 1);
                                    }}
                                    disabled={i === cards.length - 1}
                                    className="w-full flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-sans text-text-main hover:bg-cream text-left disabled:text-text-muted/40 disabled:hover:bg-transparent"
                                  >
                                    <ArrowDown className="w-3 h-3 text-text-muted" /> Move down
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </Fragment>
                      );
                    })}
                    {dropTarget?.stage === stage && dropTarget.index >= cards.length && (
                      <div className="h-[2px] bg-brass" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Timekeeper rail */}
        <aside className="w-64 flex-shrink-0 border-l border-border bg-sidebar-bg overflow-y-auto">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[10px] font-serif uppercase tracking-[0.2em] text-navy/60">
              Timekeeper
            </p>
            <h3 className="font-serif text-sm font-bold text-navy mt-0.5">Billing Record</h3>
          </div>

          <div className="px-4 py-3 border-b border-border">
            <label
              htmlFor="tk-matter"
              className="block text-[10px] font-sans font-semibold uppercase tracking-[0.15em] text-text-muted mb-1.5"
            >
              Active Matter
            </label>
            <select
              id="tk-matter"
              value={timer.activeMatterId ?? ''}
              onChange={(e) =>
                setTimer((t) => ({ ...t, activeMatterId: e.target.value || null }))
              }
              disabled={running}
              className="w-full bg-white border border-border px-2 py-1.5 text-[11px] font-sans text-text-main focus:outline-none focus:border-gold/60 disabled:opacity-60"
            >
              <option value="">Select a matter…</option>
              {billable.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.matterNumber} — {m.title}
                </option>
              ))}
            </select>

            <button
              onClick={running ? stopClock : startClock}
              disabled={!running && !timer.activeMatterId}
              className={`mt-2.5 w-full flex items-center justify-center gap-1.5 text-[11px] font-sans font-medium px-3 py-1.5 transition-colors ${
                running
                  ? 'bg-claret text-white hover:bg-claret-dark'
                  : 'bg-navy text-white hover:bg-navy-light disabled:bg-navy/30'
              }`}
            >
              {running ? (
                <>
                  <Square className="w-3 h-3" /> Stop the Clock
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" /> Start the Clock
                </>
              )}
            </button>

            {running && (
              <div className="mt-3 border border-border bg-white px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-brass animate-pulse" aria-hidden />
                  <span className="font-mono text-lg text-navy tabular-nums">
                    {fmtHMS(elapsed)}
                  </span>
                </div>
                <p className="text-[10px] font-mono text-text-muted mt-0.5">
                  {fmtHours(elapsed)} hrs · 6-min increments
                </p>
              </div>
            )}
          </div>

          <div className="px-4 py-3">
            <h4 className="text-[10px] font-sans font-semibold uppercase tracking-[0.15em] text-text-muted mb-2">
              Today&rsquo;s Record
            </h4>
            {recordRows.length === 0 ? (
              <p className="text-[10px] font-sans text-text-muted/70 leading-relaxed">
                No time recorded. Entries appear here once the clock is stopped.
              </p>
            ) : (
              <table className="w-full">
                <tbody>
                  {recordRows.map(({ matter, seconds }) => (
                    <tr key={matter.id} className="border-b border-border/60">
                      <td className="py-1 pr-2">
                        <span className="block text-[9px] font-mono text-text-muted">
                          {matter.matterNumber}
                        </span>
                        <span className="block text-[10px] font-sans text-text-main truncate max-w-[130px]">
                          {matter.title}
                        </span>
                      </td>
                      <td className="py-1 text-right align-top text-[10px] font-mono text-text-main tabular-nums whitespace-nowrap">
                        {fmtHours(seconds)} hrs
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="pt-1.5 text-[10px] font-sans font-semibold uppercase tracking-[0.1em] text-brass">
                      Recorded time
                    </td>
                    <td className="pt-1.5 text-right text-[10px] font-mono font-bold text-brass tabular-nums whitespace-nowrap">
                      {(totalTenths / 10).toFixed(1)} hrs
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </aside>

        {/* Edit panel */}
        {editing && (
          <div
            className="absolute inset-0 z-30 bg-navy/20 flex items-center justify-center p-6"
            onClick={() => setEditingId(null)}
          >
            <div
              className="bg-white border border-border shadow-sheet w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-text-muted">
                    {editing.matterNumber}
                  </span>
                  {editing.stage === 'filed' && (
                    <span className="text-[9px] font-serif text-claret border border-claret/40 px-1 leading-tight -rotate-2">
                      § Filed
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setEditingId(null)}
                  className="p-1 text-text-muted hover:text-navy"
                  title="Close"
                  aria-label="Close matter panel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="px-4 py-3 space-y-3">
                <div>
                  <label
                    htmlFor="matter-title"
                    className="block text-[10px] font-sans font-semibold uppercase tracking-[0.15em] text-text-muted mb-1"
                  >
                    Caption
                  </label>
                  <input
                    id="matter-title"
                    type="text"
                    value={editing.title}
                    onChange={(e) => updateCard(editing.id, { title: e.target.value })}
                    className="w-full font-serif text-sm font-bold text-navy bg-cream border border-border px-2.5 py-1.5 focus:outline-none focus:border-gold/60"
                  />
                </div>
                <div>
                  <label
                    htmlFor="matter-notes"
                    className="block text-[10px] font-sans font-semibold uppercase tracking-[0.15em] text-text-muted mb-1"
                  >
                    Notes to File
                  </label>
                  <textarea
                    id="matter-notes"
                    value={editing.notes}
                    onChange={(e) => updateCard(editing.id, { notes: e.target.value })}
                    rows={4}
                    placeholder="Memorialize status, next steps, deadlines…"
                    className="w-full text-xs font-sans text-text-main bg-cream border border-border px-2.5 py-1.5 leading-relaxed resize-none focus:outline-none focus:border-gold/60 placeholder-text-muted/60"
                  />
                </div>

                <div className="flex items-center justify-between border border-border bg-cream px-2.5 py-1.5">
                  <div>
                    <p className="text-[9px] font-sans uppercase tracking-[0.15em] text-text-muted">
                      Recorded time
                    </p>
                    <p className="text-[11px] font-mono text-text-main tabular-nums mt-0.5">
                      {fmtHours(editing.billedSeconds)} hrs&ensp;·&ensp;{fmtHMS(editing.billedSeconds)}
                    </p>
                  </div>
                  {editing.billedSeconds > 0 &&
                    (confirmClear ? (
                      <span className="text-[10px] font-sans text-text-muted">
                        Sure?
                        <button
                          onClick={() => {
                            updateCard(editing.id, { billedSeconds: 0 });
                            setConfirmClear(false);
                          }}
                          className="ml-1.5 uppercase tracking-wider text-claret hover:underline"
                        >
                          Clear
                        </button>
                        <button
                          onClick={() => setConfirmClear(false)}
                          className="ml-1.5 uppercase tracking-wider text-blue-600 hover:underline"
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmClear(true)}
                        className="text-[10px] font-sans uppercase tracking-wider text-text-muted hover:text-claret"
                      >
                        Clear
                      </button>
                    ))}
                </div>
              </div>

              <div className="px-4 py-2.5 border-t border-border flex items-center justify-between">
                {confirmStrike ? (
                  <span className="text-[10px] font-sans text-text-muted">
                    Strike from the docket?
                    <button
                      onClick={() => strikeMatter(editing.id)}
                      className="ml-1.5 uppercase tracking-wider text-claret hover:underline"
                    >
                      Strike
                    </button>
                    <button
                      onClick={() => setConfirmStrike(false)}
                      className="ml-1.5 uppercase tracking-wider text-blue-600 hover:underline"
                    >
                      Retain
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmStrike(true)}
                    className="flex items-center gap-1 text-[10px] font-sans uppercase tracking-wider text-text-muted hover:text-claret"
                  >
                    <Trash2 className="w-3 h-3" /> Strike matter
                  </button>
                )}
                <span className="text-[9px] font-mono text-text-muted/60">
                  Opened {new Date(editing.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Drag ghost */}
      {drag && dragCard && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: drag.x - drag.offX, top: drag.y - drag.offY, width: drag.width }}
        >
          <div className="bg-white border border-brass/60 px-3 py-2 shadow-sheet -rotate-1">
            <p className="font-serif text-[13px] font-bold text-navy leading-snug">
              {dragCard.title}
            </p>
            <span className="text-[9px] font-mono text-text-muted">{dragCard.matterNumber}</span>
          </div>
        </div>
      )}
    </div>
  );
}
