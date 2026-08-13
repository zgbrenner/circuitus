import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/* ------------------------------------------------------------------ */
/* Types & constants                                                   */
/* ------------------------------------------------------------------ */

type Suit = 'S' | 'H' | 'D' | 'C';

interface Card {
  id: number;
  suit: Suit;
  rank: number; // 1 (A) .. 13 (K)
  faceUp: boolean;
}

interface GameState {
  tableau: Card[][]; // 7 piles
  stock: Card[]; // top of stock = end of array
  waste: Card[]; // top of waste = end of array
  foundations: Card[][]; // 4 piles, ascending by suit
}

type Sel =
  | { src: 'waste' }
  | { src: 'foundation'; pile: number }
  | { src: 'tableau'; pile: number; index: number };

type Dest = { type: 'tableau'; pile: number } | { type: 'foundation'; pile: number };

interface HistoryEntry {
  game: GameState;
  moves: number;
}

interface DragState {
  cards: Card[];
  x: number;
  y: number;
  offX: number;
  offY: number;
}

interface Saved {
  game: GameState;
  moves: number;
  elapsed: number;
  drawMode: 1 | 3;
  started: boolean;
}

const SUITS: ReadonlyArray<Suit> = ['S', 'H', 'D', 'C'];
const SUIT_GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK_LABEL = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const CARD_W = 62;
const CARD_H = 86;
const GAP = 10;
const OFF_DOWN = 7; // vertical offset for face-down tableau cards
const OFF_UP = 22; // vertical offset for face-up tableau cards
const BASE_W = 7 * CARD_W + 6 * GAP; // unscaled board width
const STORAGE_KEY = 'circuitus_solitaire';

const isRed = (s: Suit) => s === 'H' || s === 'D';

/* ------------------------------------------------------------------ */
/* Pure game logic                                                     */
/* ------------------------------------------------------------------ */

function makeDeck(): Card[] {
  const deck: Card[] = [];
  SUITS.forEach((suit, si) => {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ id: si * 13 + rank - 1, suit, rank, faceUp: false });
    }
  });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function deal(): GameState {
  const deck = makeDeck();
  const tableau: Card[][] = [];
  let p = 0;
  for (let col = 0; col < 7; col++) {
    tableau.push(
      deck.slice(p, p + col + 1).map((c, i) => ({ ...c, faceUp: i === col })),
    );
    p += col + 1;
  }
  return {
    tableau,
    stock: deck.slice(p).map((c) => ({ ...c, faceUp: false })),
    waste: [],
    foundations: [[], [], [], []],
  };
}

function cloneGame(g: GameState): GameState {
  return {
    tableau: g.tableau.map((pile) => pile.map((c) => ({ ...c }))),
    stock: g.stock.map((c) => ({ ...c })),
    waste: g.waste.map((c) => ({ ...c })),
    foundations: g.foundations.map((pile) => pile.map((c) => ({ ...c }))),
  };
}

function canDropTableau(card: Card, pile: Card[]): boolean {
  if (pile.length === 0) return card.rank === 13;
  const top = pile[pile.length - 1];
  return top.faceUp && top.rank === card.rank + 1 && isRed(top.suit) !== isRed(card.suit);
}

function canDropFoundation(card: Card, pile: Card[]): boolean {
  if (pile.length === 0) return card.rank === 1;
  const top = pile[pile.length - 1];
  return top.suit === card.suit && card.rank === top.rank + 1;
}

/** The face-up run a selection refers to, or null if not selectable. */
function getCards(g: GameState, sel: Sel): Card[] | null {
  if (sel.src === 'waste') {
    const c = g.waste[g.waste.length - 1];
    return c ? [c] : null;
  }
  if (sel.src === 'foundation') {
    const pile = g.foundations[sel.pile];
    const c = pile[pile.length - 1];
    return c ? [c] : null;
  }
  const pile = g.tableau[sel.pile];
  if (sel.index < 0 || sel.index >= pile.length) return null;
  const run = pile.slice(sel.index);
  return run.every((c) => c.faceUp) ? run : null;
}

/** Validate + apply a move; returns the next state or null if illegal. */
function applyMove(g: GameState, sel: Sel, dest: Dest): GameState | null {
  const cards = getCards(g, sel);
  if (!cards || cards.length === 0) return null;
  if (sel.src === 'tableau' && dest.type === 'tableau' && sel.pile === dest.pile) return null;
  if (sel.src === 'foundation' && dest.type === 'foundation' && sel.pile === dest.pile) return null;
  if (dest.type === 'foundation') {
    if (cards.length !== 1 || !canDropFoundation(cards[0], g.foundations[dest.pile])) return null;
  } else if (!canDropTableau(cards[0], g.tableau[dest.pile])) {
    return null;
  }
  const next = cloneGame(g);
  if (sel.src === 'waste') {
    next.waste.pop();
  } else if (sel.src === 'foundation') {
    next.foundations[sel.pile].pop();
  } else {
    next.tableau[sel.pile].splice(sel.index);
    const pile = next.tableau[sel.pile];
    if (pile.length > 0 && !pile[pile.length - 1].faceUp) pile[pile.length - 1].faceUp = true;
  }
  const moved = cards.map((c) => ({ ...c, faceUp: true }));
  if (dest.type === 'foundation') next.foundations[dest.pile].push(moved[0]);
  else next.tableau[dest.pile].push(...moved);
  return next;
}

/** Draw n cards to waste, or recycle waste into stock. Null if nothing to do. */
function drawStep(g: GameState, n: number): GameState | null {
  if (g.stock.length === 0) {
    if (g.waste.length === 0) return null;
    const next = cloneGame(g);
    next.stock = next.waste.reverse().map((c) => ({ ...c, faceUp: false }));
    next.waste = [];
    return next;
  }
  const next = cloneGame(g);
  const count = Math.min(n, next.stock.length);
  for (let i = 0; i < count; i++) {
    const c = next.stock.pop();
    if (!c) break;
    c.faceUp = true;
    next.waste.push(c);
  }
  return next;
}

/** One step of auto-finish: lowest-ranked eligible top card to a foundation. */
function autoStep(g: GameState): GameState | null {
  const candidates: Array<{ sel: Sel; card: Card }> = [];
  g.tableau.forEach((pile, i) => {
    if (pile.length > 0) {
      candidates.push({
        sel: { src: 'tableau', pile: i, index: pile.length - 1 },
        card: pile[pile.length - 1],
      });
    }
  });
  if (g.waste.length > 0) {
    candidates.push({ sel: { src: 'waste' }, card: g.waste[g.waste.length - 1] });
  }
  let best: { sel: Sel; pile: number; rank: number } | null = null;
  for (const { sel, card } of candidates) {
    for (let f = 0; f < 4; f++) {
      if (canDropFoundation(card, g.foundations[f])) {
        if (best === null || card.rank < best.rank) best = { sel, pile: f, rank: card.rank };
        break;
      }
    }
  }
  if (best === null) return null;
  return applyMove(g, best.sel, { type: 'foundation', pile: best.pile });
}

function foundationDestFor(g: GameState, card: Card): number | null {
  for (let f = 0; f < 4; f++) {
    if (canDropFoundation(card, g.foundations[f])) return f;
  }
  return null;
}

function hasTableauMove(g: GameState, card: Card, sel: Sel): boolean {
  for (let i = 0; i < 7; i++) {
    if (sel.src === 'tableau' && sel.pile === i) continue;
    if (canDropTableau(card, g.tableau[i])) return true;
  }
  return false;
}

function sameSel(a: Sel, b: Sel): boolean {
  if (a.src === 'waste' && b.src === 'waste') return true;
  if (a.src === 'foundation' && b.src === 'foundation') return a.pile === b.pile;
  if (a.src === 'tableau' && b.src === 'tableau') return a.pile === b.pile && a.index === b.index;
  return false;
}

function pileOffsets(pile: Card[]): number[] {
  const ys: number[] = [];
  let y = 0;
  for (const card of pile) {
    ys.push(y);
    y += card.faceUp ? OFF_UP : OFF_DOWN;
  }
  return ys;
}

function pileHeight(pile: Card[]): number {
  if (pile.length === 0) return CARD_H;
  const ys = pileOffsets(pile);
  return ys[ys.length - 1] + CARD_H;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

function isCard(v: unknown): v is Card {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'number' &&
    (o.suit === 'S' || o.suit === 'H' || o.suit === 'D' || o.suit === 'C') &&
    typeof o.rank === 'number' &&
    o.rank >= 1 &&
    o.rank <= 13 &&
    typeof o.faceUp === 'boolean'
  );
}

function isValidGame(v: unknown): v is GameState {
  if (typeof v !== 'object' || v === null) return false;
  const g = v as Record<string, unknown>;
  const groups: unknown[] = [g.tableau, g.foundations];
  if (!Array.isArray(g.tableau) || g.tableau.length !== 7) return false;
  if (!Array.isArray(g.foundations) || g.foundations.length !== 4) return false;
  if (!Array.isArray(g.stock) || !Array.isArray(g.waste)) return false;
  const ids = new Set<number>();
  const collect = (cards: unknown): boolean => {
    if (!Array.isArray(cards)) return false;
    for (const c of cards) {
      if (!isCard(c)) return false;
      ids.add(c.id);
    }
    return true;
  };
  for (const group of groups) {
    for (const pile of group as unknown[]) {
      if (!collect(pile)) return false;
    }
  }
  if (!collect(g.stock) || !collect(g.waste)) return false;
  return ids.size === 52;
}

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (!isValidGame(p.game)) return null;
    return {
      game: p.game,
      moves: typeof p.moves === 'number' ? p.moves : 0,
      elapsed: typeof p.elapsed === 'number' ? p.elapsed : 0,
      drawMode: p.drawMode === 3 ? 3 : 1,
      started: p.started === true,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Presentational pieces                                               */
/* ------------------------------------------------------------------ */

function CardFace({ card, selected }: { card: Card; selected?: boolean }) {
  const color = isRed(card.suit) ? 'text-claret' : 'text-ink';
  const corner = `${RANK_LABEL[card.rank - 1]}${SUIT_GLYPH[card.suit]}`;
  return (
    <div
      className={`relative rounded border bg-paper-cool shadow-[0_1px_2px_rgba(14,17,22,0.18)] ${
        selected ? 'border-brass ring-2 ring-brass/60' : 'border-rule-strong'
      }`}
      style={{ width: CARD_W, height: CARD_H }}
    >
      <div className={`absolute top-0.5 left-1.5 font-serif font-bold text-[12px] leading-tight ${color}`}>
        {corner}
      </div>
      <div className={`absolute bottom-0.5 right-1.5 rotate-180 font-serif font-bold text-[12px] leading-tight ${color}`}>
        {corner}
      </div>
      <div className={`absolute inset-0 flex items-center justify-center text-2xl opacity-80 ${color}`}>
        {SUIT_GLYPH[card.suit]}
      </div>
    </div>
  );
}

function CardBack() {
  return (
    <div
      className="relative rounded border border-navy-light bg-navy shadow-[0_1px_2px_rgba(14,17,22,0.18)]"
      style={{
        width: CARD_W,
        height: CARD_H,
        backgroundImage:
          'repeating-linear-gradient(135deg, rgba(184,147,43,0.28) 0px, rgba(184,147,43,0.28) 1px, transparent 1px, transparent 5px)',
      }}
    >
      <div className="absolute inset-1 rounded-sm border border-brass/40" />
    </div>
  );
}

function PileSlot({ hint }: { hint?: string }) {
  return (
    <div
      className="rounded border border-dashed border-rule-strong bg-paper-warm/40 flex items-center justify-center font-serif text-lg text-rule-strong"
      style={{ width: CARD_W, height: CARD_H }}
    >
      {hint ?? ''}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function Solitaire() {
  const [boot] = useState<Saved | null>(loadSaved);
  const [game, setGame] = useState<GameState>(() => boot?.game ?? deal());
  const [moves, setMoves] = useState(() => boot?.moves ?? 0);
  const [elapsed, setElapsed] = useState(() => boot?.elapsed ?? 0);
  const [drawMode, setDrawMode] = useState<1 | 3>(() => boot?.drawMode ?? 1);
  const [started, setStarted] = useState(() => boot?.started ?? false);
  const [selected, setSelected] = useState<Sel | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [autoFinishing, setAutoFinishing] = useState(false);
  const [confirmRedeal, setConfirmRedeal] = useState(false);
  const [shake, setShake] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [scale, setScale] = useState(1);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const didDragRef = useRef(false);
  const shakeSeqRef = useRef(0);
  const attemptMoveRef = useRef<(sel: Sel, dest: Dest) => boolean>(() => false);

  const won = game.foundations.every((f) => f.length === 13);
  const canAutoFinish =
    !won &&
    !autoFinishing &&
    game.stock.length === 0 &&
    game.waste.length === 0 &&
    game.tableau.every((pile) => pile.every((c) => c.faceUp));

  /* ----- effects ----- */

  // Responsive scale from container width.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / BASE_W));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Timer.
  useEffect(() => {
    if (!started || won) return;
    const t = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(t);
  }, [started, won]);

  // Persistence: keep the in-progress game resumable; clear it once won.
  useEffect(() => {
    try {
      if (won) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ game, moves, elapsed, drawMode, started }),
        );
      }
    } catch {
      // Storage unavailable (private mode etc.) — play on without persistence.
    }
  }, [game, moves, elapsed, drawMode, started, won]);

  // Invalid-move shake reset.
  useEffect(() => {
    if (!shake) return;
    const t = window.setTimeout(() => setShake(null), 320);
    return () => window.clearTimeout(t);
  }, [shake]);

  // Auto-finish: one card per tick until nothing is eligible.
  useEffect(() => {
    if (!autoFinishing) return;
    const t = window.setTimeout(() => {
      const next = autoStep(game);
      if (!next) {
        setAutoFinishing(false);
        return;
      }
      setGame(next);
      setMoves((m) => m + 1);
    }, 130);
    return () => window.clearTimeout(t);
  }, [autoFinishing, game]);

  /* ----- actions ----- */

  function triggerShake(key: string) {
    // Sequence number keeps repeat shakes on the same pile re-triggering.
    shakeSeqRef.current += 1;
    setShake(`${key}#${shakeSeqRef.current}`);
  }
  const shakeKey = shake ? shake.slice(0, shake.indexOf('#')) : null;

  function attemptMove(sel: Sel, dest: Dest): boolean {
    const next = applyMove(game, sel, dest);
    if (!next) return false;
    setHistory((h) => [...h.slice(-299), { game, moves }]);
    setGame(next);
    setMoves((m) => m + 1);
    setStarted(true);
    setSelected(null);
    return true;
  }
  // Latest version for window-level pointer listeners created mid-drag.
  useEffect(() => {
    attemptMoveRef.current = attemptMove;
  });

  function draw() {
    if (won || autoFinishing || didDragRef.current) return;
    const next = drawStep(game, drawMode);
    if (!next) return;
    setHistory((h) => [...h.slice(-299), { game, moves }]);
    setGame(next);
    setMoves((m) => m + 1);
    setStarted(true);
    setSelected(null);
  }

  function undo() {
    if (autoFinishing) return;
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setGame(last.game);
    setMoves(last.moves);
    setSelected(null);
  }

  function redeal() {
    setGame(deal());
    setMoves(0);
    setElapsed(0);
    setStarted(false);
    setSelected(null);
    setHistory([]);
    setAutoFinishing(false);
    setConfirmRedeal(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  function tryAutoFoundation(sel: Sel): boolean {
    const cards = getCards(game, sel);
    if (!cards || cards.length !== 1) return false;
    if (sel.src === 'tableau' && sel.index !== game.tableau[sel.pile].length - 1) return false;
    const f = foundationDestFor(game, cards[0]);
    if (f === null) return false;
    return attemptMove(sel, { type: 'foundation', pile: f });
  }

  function destKeyOf(dest: Dest): string {
    return `${dest.type}-${dest.pile}`;
  }

  function handleCardClick(sel: Sel) {
    if (didDragRef.current || autoFinishing || won) return;
    const cards = getCards(game, sel);
    const dest: Dest | null =
      sel.src === 'tableau'
        ? { type: 'tableau', pile: sel.pile }
        : sel.src === 'foundation'
          ? { type: 'foundation', pile: sel.pile }
          : null;
    if (selected) {
      if (sameSel(selected, sel)) {
        if (!tryAutoFoundation(sel)) setSelected(null);
        return;
      }
      if (dest && attemptMove(selected, dest)) return;
      if (cards) {
        setSelected(sel);
      } else if (dest) {
        triggerShake(destKeyOf(dest));
      }
      return;
    }
    if (!cards) return;
    // Unambiguous single-click: a top card whose only legal move is a foundation.
    if (cards.length === 1) {
      const isTop =
        sel.src !== 'tableau' || sel.index === game.tableau[sel.pile].length - 1;
      if (isTop && foundationDestFor(game, cards[0]) !== null && !hasTableauMove(game, cards[0], sel)) {
        tryAutoFoundation(sel);
        return;
      }
    }
    setSelected(sel);
  }

  function handleDestClick(dest: Dest) {
    if (didDragRef.current || autoFinishing || won || !selected) return;
    if (!attemptMove(selected, dest)) triggerShake(destKeyOf(dest));
  }

  function startDrag(e: ReactPointerEvent<HTMLDivElement>, sel: Sel) {
    if (autoFinishing || won) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const cards = getCards(game, sel);
    if (!cards) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    let dragging = false;
    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        dragging = true;
        didDragRef.current = true;
        setSelected(null);
      }
      setDrag({ cards, x: ev.clientX, y: ev.clientY, offX, offY });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (!dragging) return;
      setDrag(null);
      const target = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest('[data-drop]');
      const spec = target?.getAttribute('data-drop') ?? '';
      const dash = spec.lastIndexOf('-');
      const kind = spec.slice(0, dash);
      const pile = Number(spec.slice(dash + 1));
      if ((kind === 'tableau' || kind === 'foundation') && Number.isFinite(pile)) {
        attemptMoveRef.current(sel, { type: kind, pile });
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

  /* ----- render ----- */

  const hiddenIds = new Set<number>(drag ? drag.cards.map((c) => c.id) : []);
  const maxPileH = Math.max(CARD_H, ...game.tableau.map(pileHeight));
  const topRowH = CARD_H + 16;
  const innerH = topRowH + 18 + maxPileH;

  const isTableauSelected = (pile: number, index: number) =>
    selected?.src === 'tableau' && selected.pile === pile && index >= selected.index;

  const wasteTop = game.waste.length - 1;
  const wasteShown = game.waste.slice(-3);
  const wasteShownStart = game.waste.length - wasteShown.length;

  return (
    <div className="flex flex-col items-center py-8 select-none">
      <style>{`@keyframes cs-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}.cs-shake{animation:cs-shake .3s ease}`}</style>

      <p className="text-[10px] font-sans uppercase tracking-[0.2em] text-navy/60 mb-1">
        Diligence Exercise · Chronological Sequencing Drill
      </p>
      <h2 className="font-serif text-navy text-xl font-bold mb-3">
        Chronological Sequencing Drill
      </h2>

      <div className="flex items-center gap-3 mb-4 flex-wrap justify-center px-4">
        <span className="text-[10px] font-mono text-text-muted">
          Motions: <span className="text-navy">{moves}</span>
        </span>
        <span className="text-[10px] font-mono text-text-muted">
          Time: <span className="text-navy">{fmtTime(elapsed)}</span>
        </span>
        <button
          onClick={undo}
          disabled={history.length === 0 || autoFinishing}
          className={`text-[10px] font-sans uppercase tracking-wider ${
            history.length === 0 || autoFinishing
              ? 'text-text-muted/40 cursor-default'
              : 'text-blue-600 hover:underline'
          }`}
        >
          Undo
        </button>
        <div className="flex border border-border rounded overflow-hidden">
          {([1, 3] as const).map((n) => (
            <button
              key={n}
              onClick={() => setDrawMode(n)}
              className={`px-2 py-0.5 text-[9px] font-sans uppercase tracking-wider ${
                drawMode === n
                  ? 'bg-navy text-paper'
                  : 'bg-white text-text-muted hover:bg-cream'
              }`}
            >
              Draw {n}
            </button>
          ))}
        </div>
        {canAutoFinish && (
          <button
            onClick={() => setAutoFinishing(true)}
            className="text-[10px] font-sans uppercase tracking-wider text-brass hover:underline"
          >
            Auto-finish
          </button>
        )}
        {confirmRedeal ? (
          <span className="text-[10px] font-sans text-text-muted">
            Discard file?
            <button
              onClick={redeal}
              className="ml-1.5 uppercase tracking-wider text-claret hover:underline"
            >
              Redeal
            </button>
            <button
              onClick={() => setConfirmRedeal(false)}
              className="ml-1.5 uppercase tracking-wider text-blue-600 hover:underline"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmRedeal(true)}
            className="text-[10px] font-sans uppercase tracking-wider text-blue-600 hover:underline"
          >
            Redeal
          </button>
        )}
      </div>

      <div className="w-full max-w-[560px] px-4">
        {/* Unpadded measuring wrapper: scale derives from its width alone. */}
        <div ref={containerRef} className="w-full">
          <div className="mx-auto" style={{ width: BASE_W * scale, height: innerH * scale }}>
          <div style={{ width: BASE_W, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            {/* Top row: stock, waste, foundations */}
            <div className="flex justify-between" style={{ marginBottom: 18, height: topRowH }}>
              <div className="flex" style={{ gap: GAP }}>
                {/* Stock */}
                <div style={{ width: CARD_W }}>
                  <button
                    onClick={draw}
                    className="block cursor-pointer"
                    aria-label="Draw from stock"
                  >
                    {game.stock.length > 0 ? (
                      <CardBack />
                    ) : (
                      <div
                        className="rounded border border-dashed border-rule-strong bg-paper-warm/40 flex items-center justify-center text-xl text-brass"
                        style={{ width: CARD_W, height: CARD_H }}
                      >
                        {game.waste.length > 0 ? '↻' : ''}
                      </div>
                    )}
                  </button>
                  <p className="text-center text-[9px] font-mono text-text-muted mt-0.5">
                    {game.stock.length}
                  </p>
                </div>
                {/* Waste */}
                <div className="relative" style={{ width: CARD_W + 28, height: CARD_H }}>
                  {game.waste.length === 0 && <PileSlot />}
                  {wasteShown.map((card, i) => {
                    const absIndex = wasteShownStart + i;
                    const isTop = absIndex === wasteTop;
                    const left = drawMode === 3 ? i * 14 : 0;
                    return (
                      <div
                        key={card.id}
                        className={hiddenIds.has(card.id) ? 'opacity-0 pointer-events-none' : ''}
                        style={{
                          position: 'absolute',
                          left,
                          top: 0,
                          touchAction: isTop ? 'none' : undefined,
                        }}
                        onClick={
                          isTop
                            ? (e) => {
                                e.stopPropagation();
                                handleCardClick({ src: 'waste' });
                              }
                            : undefined
                        }
                        onPointerDown={isTop ? (e) => startDrag(e, { src: 'waste' }) : undefined}
                      >
                        <CardFace card={card} selected={isTop && selected?.src === 'waste'} />
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Foundations */}
              <div className="flex" style={{ gap: GAP }}>
                {game.foundations.map((pile, f) => (
                  <div
                    key={f}
                    data-drop={`foundation-${f}`}
                    className={`relative ${shakeKey === `foundation-${f}` ? 'cs-shake' : ''}`}
                    style={{ width: CARD_W, height: CARD_H }}
                    onClick={() => handleDestClick({ type: 'foundation', pile: f })}
                  >
                    {pile.length === 0 && <PileSlot hint="A" />}
                    {pile.slice(-2).map((card, i, shown) => {
                      const isTop = i === shown.length - 1;
                      return (
                        <div
                          key={card.id}
                          className={hiddenIds.has(card.id) ? 'opacity-0 pointer-events-none' : ''}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            touchAction: isTop ? 'none' : undefined,
                          }}
                          onClick={
                            isTop
                              ? (e) => {
                                  e.stopPropagation();
                                  handleCardClick({ src: 'foundation', pile: f });
                                }
                              : undefined
                          }
                          onPointerDown={
                            isTop ? (e) => startDrag(e, { src: 'foundation', pile: f }) : undefined
                          }
                        >
                          <CardFace
                            card={card}
                            selected={
                              isTop &&
                              selected?.src === 'foundation' &&
                              selected.pile === f
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Tableau */}
            <div className="flex" style={{ gap: GAP }}>
              {game.tableau.map((pile, i) => {
                const ys = pileOffsets(pile);
                return (
                  <div
                    key={i}
                    data-drop={`tableau-${i}`}
                    className={`relative ${shakeKey === `tableau-${i}` ? 'cs-shake' : ''}`}
                    style={{ width: CARD_W, height: Math.max(pileHeight(pile), CARD_H) }}
                    onClick={() => handleDestClick({ type: 'tableau', pile: i })}
                  >
                    {pile.length === 0 && <PileSlot hint="K" />}
                    {pile.map((card, idx) => (
                      <div
                        key={card.id}
                        className={hiddenIds.has(card.id) ? 'opacity-0 pointer-events-none' : ''}
                        style={{
                          position: 'absolute',
                          top: ys[idx],
                          left: 0,
                          touchAction: card.faceUp ? 'none' : undefined,
                        }}
                        onClick={
                          card.faceUp
                            ? (e) => {
                                e.stopPropagation();
                                handleCardClick({ src: 'tableau', pile: i, index: idx });
                              }
                            : undefined
                        }
                        onPointerDown={
                          card.faceUp
                            ? (e) => startDrag(e, { src: 'tableau', pile: i, index: idx })
                            : undefined
                        }
                      >
                        {card.faceUp ? (
                          <CardFace card={card} selected={isTableauSelected(i, idx)} />
                        ) : (
                          <CardBack />
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        </div>
      </div>

      {won && (
        <div className="mt-5 border border-brass/40 bg-paper-cool rounded px-5 py-3 text-center">
          <p className="font-serif text-navy text-base">
            Sequencing drill complete — 0.5 CLE credits recorded.
          </p>
          <p className="text-[10px] font-mono text-text-muted mt-0.5">
            {moves} motions · {fmtTime(elapsed)}
          </p>
          <button
            onClick={redeal}
            className="mt-1.5 text-[10px] font-sans uppercase tracking-wider text-blue-600 hover:underline"
          >
            New file
          </button>
        </div>
      )}

      {!won && (
        <p className="mt-4 text-[10px] font-sans text-text-muted/70 text-center px-6">
          Click or drag to file each instrument in sequence. Click the stock to draw.
          Double-click sends an entry to its register. Progress is retained on this terminal.
        </p>
      )}

      {/* Drag overlay */}
      {drag && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: drag.x - drag.offX, top: drag.y - drag.offY }}
        >
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            {drag.cards.map((c, i) => (
              <div key={c.id} style={{ position: 'absolute', top: i * OFF_UP, left: 0 }}>
                <CardFace card={c} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
