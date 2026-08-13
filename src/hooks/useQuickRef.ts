import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Quick-reference mode: the user's instant cover-screen.
 * Pressing the configured shortcut swaps the entire UI to a plausible
 * research session — different page each time, with scroll position
 * jittered to look like work in progress.
 */

export interface QuickRefDestination {
  /** Standin document id to display. */
  docId: string;
  /** Chapter index to land on (0-based). */
  chapterIndex: number;
  /** Scroll percent within the document body, 0-100. */
  scrollPercent: number;
  /** Display label for breadcrumb / matter tab. */
  label: string;
  /** Reference number to show in the document header. */
  refNumber: string;
}

/** Pool of plausible destinations. Each invocation picks one at random. */
const DESTINATION_POOL: ReadonlyArray<Omit<QuickRefDestination, 'scrollPercent'>> = [
  { docId: 'guide-sow-ca', chapterIndex: 1, label: 'SOW Structuring', refNumber: 'CIR-PG-2026-001' },
  { docId: 'guide-sow-ca', chapterIndex: 2, label: 'SOW Structuring', refNumber: 'CIR-PG-2026-001' },
  { docId: 'guide-ai-governance', chapterIndex: 0, label: 'AI Governance', refNumber: 'CIR-PG-2026-002' },
  { docId: 'guide-ai-governance', chapterIndex: 1, label: 'AI Governance', refNumber: 'CIR-PG-2026-002' },
  { docId: 'guide-ca-privacy-2026', chapterIndex: 0, label: 'CA Privacy 2026', refNumber: 'CIR-PG-2026-003' },
  { docId: 'guide-vendor-playbook', chapterIndex: 1, label: 'Vendor Playbook', refNumber: 'CIR-PG-2026-004' },
  { docId: 'guide-nda-template', chapterIndex: 0, label: 'NDA Template', refNumber: 'CIR-PG-2026-005' },
  { docId: 'guide-dpa-checklist', chapterIndex: 0, label: 'DPA Checklist', refNumber: 'CIR-PG-2026-006' },
  { docId: 'guide-incident-response', chapterIndex: 0, label: 'Incident Response', refNumber: 'CIR-PG-2026-008' },
  { docId: 'guide-ip-provisions', chapterIndex: 0, label: 'IP Provisions', refNumber: 'CIR-PG-2026-009' },
];

/** Scroll jitter — middle 40% of the chapter body. */
function jitterScrollPercent(): number {
  return Math.round(30 + Math.random() * 40);
}

export interface ShortcutChord {
  /** True if Ctrl (Win/Linux) or Cmd (macOS) must be held. */
  ctrlOrCmd: boolean;
  shift: boolean;
  alt: boolean;
  /** Single character key (uppercase). */
  key: string;
}

const DEFAULT_CHORD: ShortcutChord = { ctrlOrCmd: true, shift: true, alt: false, key: 'K' };

/**
 * Firefox binds Ctrl+Shift+K to the Web Console. If the configured chord
 * collides, fall back to Ctrl+Shift+; (semicolon) which is unbound across
 * mainstream browsers.
 */
const FIREFOX_SAFE_CHORD: ShortcutChord = { ctrlOrCmd: true, shift: true, alt: false, key: ';' };

const FIREFOX_DEVTOOLS_CHORDS: ShortcutChord[] = [
  { ctrlOrCmd: true, shift: true, alt: false, key: 'K' }, // Web Console
  { ctrlOrCmd: true, shift: true, alt: false, key: 'I' }, // Inspector
  { ctrlOrCmd: true, shift: true, alt: false, key: 'C' }, // Inspector picker
  { ctrlOrCmd: true, shift: true, alt: false, key: 'M' }, // Responsive Design
];

const STORAGE_KEY = 'circuitus_shortcut_chord';

/**
 * Hot-corner cover trigger (opt-in). When enabled, dwelling the pointer in
 * the chosen top corner engages the cover through the same path as the
 * chord. 'off' by default — mouse-only entry must be a deliberate choice.
 */
export type HotCorner = 'off' | 'tl' | 'tr';

const HOT_CORNER_KEY = 'circuitus_hot_corner';
/** Corner zone: within this many px of both edges. */
const HOT_CORNER_EDGE_PX = 4;
/** Continuous dwell required inside the zone before the cover engages. */
const HOT_CORNER_DWELL_MS = 250;

function loadHotCorner(): HotCorner {
  try {
    const raw = localStorage.getItem(HOT_CORNER_KEY);
    if (raw === 'off' || raw === 'tl' || raw === 'tr') return raw;
  } catch {
    // ignore
  }
  return 'off';
}

function saveHotCorner(value: HotCorner): void {
  try {
    localStorage.setItem(HOT_CORNER_KEY, value);
  } catch {
    // ignore
  }
}

function isFirefox(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /firefox/i.test(navigator.userAgent);
}

function chordsEqual(a: ShortcutChord, b: ShortcutChord): boolean {
  return a.ctrlOrCmd === b.ctrlOrCmd && a.shift === b.shift && a.alt === b.alt && a.key === b.key;
}

function loadChord(): ShortcutChord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ShortcutChord;
      if (typeof parsed.key === 'string' && parsed.key.length > 0) return parsed;
    }
  } catch {
    // ignore
  }
  // Default; auto-swap if running in Firefox and the default is a devtools chord.
  if (isFirefox() && FIREFOX_DEVTOOLS_CHORDS.some((c) => chordsEqual(c, DEFAULT_CHORD))) {
    return FIREFOX_SAFE_CHORD;
  }
  return DEFAULT_CHORD;
}

function saveChord(chord: ShortcutChord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chord));
  } catch {
    // ignore
  }
}

export function formatChord(chord: ShortcutChord): string {
  const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '');
  const parts: string[] = [];
  if (chord.ctrlOrCmd) parts.push(isMac ? 'Cmd' : 'Ctrl');
  if (chord.shift) parts.push('Shift');
  if (chord.alt) parts.push(isMac ? 'Option' : 'Alt');
  parts.push(chord.key);
  return parts.join('+');
}

export interface UseQuickRefReturn {
  isQuickRef: boolean;
  destination: QuickRefDestination;
  chord: ShortcutChord;
  setChord: (next: ShortcutChord) => void;
  hotCorner: HotCorner;
  setHotCorner: (next: HotCorner) => void;
  saveQuickRefState: (scrollTop: number, documentId: string | null, activeTab: string | null) => void;
  /** Lazy accessor for the saved pre-quickref state. Read inside an event handler. */
  getPreState: () => { scrollTop: number; documentId: string | null; activeTab: string | null };
  exitQuickRef: () => void;
}

export function useQuickRef(): UseQuickRefReturn {
  const [isQuickRef, setIsQuickRef] = useState(false);
  const [chord, setChordState] = useState<ShortcutChord>(() => loadChord());
  const [hotCorner, setHotCornerState] = useState<HotCorner>(() => loadHotCorner());
  const [destination, setDestination] = useState<QuickRefDestination>(() => ({
    ...DESTINATION_POOL[0],
    scrollPercent: jitterScrollPercent(),
  }));

  const preStateRef = useRef<{
    scrollTop: number;
    documentId: string | null;
    activeTab: string | null;
  }>({ scrollTop: 0, documentId: null, activeTab: null });

  const setChord = useCallback((next: ShortcutChord) => {
    saveChord(next);
    setChordState(next);
  }, []);

  const setHotCorner = useCallback((next: HotCorner) => {
    saveHotCorner(next);
    setHotCornerState(next);
  }, []);

  const enterQuickRef = useCallback(() => {
    const idx = Math.floor(Math.random() * DESTINATION_POOL.length);
    setDestination({
      ...DESTINATION_POOL[idx],
      scrollPercent: jitterScrollPercent(),
    });
    setIsQuickRef(true);
  }, []);

  const exitQuickRef = useCallback(() => {
    setIsQuickRef(false);
  }, []);

  const saveQuickRefState = useCallback(
    (scrollTop: number, documentId: string | null, activeTab: string | null) => {
      preStateRef.current = { scrollTop, documentId, activeTab };
    },
    [],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      const matches =
        ctrlOrCmd === chord.ctrlOrCmd &&
        e.shiftKey === chord.shift &&
        e.altKey === chord.alt &&
        e.key.toUpperCase() === chord.key.toUpperCase();
      if (!matches) return;
      e.preventDefault();
      if (isQuickRef) exitQuickRef();
      else enterQuickRef();
    };
    // Capture-phase so editors with their own keydown listeners (Tiptap,
    // Monaco, contenteditable surfaces) don't swallow the chord first.
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [chord, isQuickRef, enterQuickRef, exitQuickRef]);

  // Hot corner: dwell the pointer in the configured top corner to engage
  // the cover via the same enterQuickRef path as the chord. Deliberately
  // one-way — the hot corner only ENTERS the cover; exiting stays
  // chord-only so a stray mouse pass can never reveal the real screen.
  // The listener is not registered at all while covered or when 'off'.
  useEffect(() => {
    if (hotCorner === 'off' || isQuickRef) return;

    // Plain locals instead of state: zero React churn per pointermove.
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;
    let inZone = false;

    const cancelDwell = () => {
      if (dwellTimer) {
        clearTimeout(dwellTimer);
        dwellTimer = null;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      // Bail fast: two comparisons for the common far-from-corner case.
      const inside =
        e.clientY <= HOT_CORNER_EDGE_PX &&
        (hotCorner === 'tl'
          ? e.clientX <= HOT_CORNER_EDGE_PX
          : e.clientX >= window.innerWidth - HOT_CORNER_EDGE_PX);
      if (inside === inZone) return;
      inZone = inside;
      if (inside) {
        dwellTimer = setTimeout(enterQuickRef, HOT_CORNER_DWELL_MS);
      } else {
        cancelDwell();
      }
    };

    // A pointer that exits the window entirely has left the zone — cancel
    // so a fast fling toward browser chrome doesn't count as a dwell.
    const onPointerOut = (e: PointerEvent) => {
      if (e.relatedTarget === null && inZone) {
        inZone = false;
        cancelDwell();
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerout', onPointerOut, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerout', onPointerOut);
      cancelDwell();
    };
  }, [hotCorner, isQuickRef, enterQuickRef]);

  useEffect(() => {
    document.title = isQuickRef
      ? `Circuitus | ${destination.label} — Practice Guide`
      : 'Circuitus | Legal Research Suite';
  }, [isQuickRef, destination.label]);

  const getPreState = useCallback(() => preStateRef.current, []);

  return {
    isQuickRef,
    destination,
    chord,
    setChord,
    hotCorner,
    setHotCorner,
    saveQuickRefState,
    getPreState,
    exitQuickRef,
  };
}
