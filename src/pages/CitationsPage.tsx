import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  Minus,
  MonitorPlay,
  Pin,
  Plus,
  Printer,
  RotateCw,
  Search,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import {
  DEFAULT_READER_ENDPOINT,
  detectUrl,
  fetchAuthority,
  getReaderEndpoint,
  hostOf,
  resetReaderEndpoint,
  searchAuthorities,
  setReaderEndpoint,
} from '@/lib/reader';
import type { AuthorityResult, RetrievedAuthority, SearchOutcome } from '@/lib/reader';
import { Markdown } from '@/lib/markdown';
import type { BrowserState, CircuitusDesktop } from '@/types/desktop';

const PINNED_KEY = 'circuitus_pinned_authorities';

// ── Reading comfort — article font size presets ─────────────────────────
const FONTSIZE_KEY = 'circuitus_citations_fontsize';
/** Three reading sizes for the retrieved-copy view (px). */
const FONT_STEPS = [13.5, 15, 16.5] as const;
const DEFAULT_FONT_STEP = 1; // 15px

function loadFontStep(): number {
  try {
    const raw = localStorage.getItem(FONTSIZE_KEY);
    if (raw !== null) {
      const px = Number(raw);
      const idx = FONT_STEPS.findIndex((s) => s === px);
      if (idx >= 0) return idx;
    }
  } catch {
    // ignore
  }
  return DEFAULT_FONT_STEP;
}

function persistFontStep(step: number) {
  try {
    localStorage.setItem(FONTSIZE_KEY, String(FONT_STEPS[step]));
  } catch {
    // ignore quota/storage errors
  }
}

interface PinnedAuthority {
  url: string;
  title: string;
  pinnedAt: string;
}

type TrailEntry =
  | { kind: 'search'; query: string; label: string }
  | { kind: 'article'; url: string; label: string };

type View =
  | { kind: 'idle' }
  | { kind: 'results'; query: string; outcome: SearchOutcome }
  | { kind: 'article'; article: RetrievedAuthority };

// ── Disguise helpers ─────────────────────────────────────────────────────

function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic fake reporter citation, e.g. "2026 CIR 04512". */
function citationFor(url: string): string {
  const seq = String(hashOf(url) % 99999).padStart(5, '0');
  return `${new Date().getFullYear()} CIR ${seq}`;
}

/** Fake retrieval reference for the reading view header. */
function retrievalRefFor(url: string): string {
  return `EXT-${String(hashOf(`ref:${url}`) % 999999).padStart(6, '0')}`;
}

function loadPinned(): PinnedAuthority[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (p): p is PinnedAuthority =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as PinnedAuthority).url === 'string' &&
        typeof (p as PinnedAuthority).title === 'string' &&
        typeof (p as PinnedAuthority).pinnedAt === 'string',
    );
  } catch {
    return [];
  }
}

function persistPinned(list: PinnedAuthority[]) {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(list));
  } catch {
    // ignore quota/storage errors
  }
}

const ERROR_TEXT = 'External reporter did not respond — authority unavailable.';

export default function CitationsPage() {
  const [desktop] = useState<CircuitusDesktop | undefined>(() => window.circuitusDesktop);

  const [input, setInput] = useState('');
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trailState, setTrailState] = useState<{ entries: TrailEntry[]; index: number }>({
    entries: [],
    index: -1,
  });
  const [pinned, setPinned] = useState<PinnedAuthority[]>(() => loadPinned());
  const [fontStep, setFontStep] = useState<number>(() => loadFontStep());
  const articleFontSize = FONT_STEPS[fontStep];

  function stepFontSize(delta: number) {
    setFontStep((prev) => {
      const next = Math.min(FONT_STEPS.length - 1, Math.max(0, prev + delta));
      persistFontStep(next);
      return next;
    });
  }

  // Settings
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [endpointInput, setEndpointInput] = useState('');

  // Live Session (desktop only)
  const [liveMode, setLiveMode] = useState(false);
  const [browserState, setBrowserState] = useState<BrowserState | null>(null);
  const liveContainerRef = useRef<HTMLDivElement>(null);
  const [liveStartUrl, setLiveStartUrl] = useState('https://duckduckgo.com/');

  const runIdRef = useRef(0);
  const searchCacheRef = useRef(new Map<string, SearchOutcome>());
  const articleCacheRef = useRef(new Map<string, RetrievedAuthority>());

  // ── Retrieval + trail plumbing ─────────────────────────────────────────

  const runEntry = useCallback(async (entry: TrailEntry) => {
    const id = ++runIdRef.current;
    setError(null);
    setBusy(
      entry.kind === 'search'
        ? 'Querying external reporters…'
        : 'Retrieving certified copy from external reporter…',
    );
    try {
      if (entry.kind === 'search') {
        const cached = searchCacheRef.current.get(entry.query);
        const outcome = cached ?? (await searchAuthorities(entry.query, getReaderEndpoint()));
        searchCacheRef.current.set(entry.query, outcome);
        if (runIdRef.current !== id) return;
        setView({ kind: 'results', query: entry.query, outcome });
      } else {
        const cached = articleCacheRef.current.get(entry.url);
        const article = cached ?? (await fetchAuthority(entry.url, getReaderEndpoint()));
        articleCacheRef.current.set(entry.url, article);
        if (runIdRef.current !== id) return;
        setView({ kind: 'article', article });
        // Backfill the trail label with the real title once known.
        setTrailState((s) => ({
          ...s,
          entries: s.entries.map((t) =>
            t.kind === 'article' && t.url === entry.url ? { ...t, label: article.title } : t,
          ),
        }));
      }
    } catch {
      if (runIdRef.current !== id) return;
      setError(ERROR_TEXT);
    } finally {
      if (runIdRef.current === id) setBusy(null);
    }
  }, []);

  const navigateTo = useCallback(
    (entry: TrailEntry) => {
      setTrailState((s) => ({
        entries: [...s.entries.slice(0, s.index + 1), entry],
        index: s.index + 1,
      }));
      void runEntry(entry);
    },
    [runEntry],
  );

  const openArticle = useCallback(
    (url: string, label?: string) => {
      navigateTo({ kind: 'article', url, label: label ?? hostOf(url) });
    },
    [navigateTo],
  );

  const handleLinkClick = useCallback((url: string) => openArticle(url), [openArticle]);

  function goStep(delta: number) {
    const target = trailState.index + delta;
    if (target < 0 || target >= trailState.entries.length) return;
    setTrailState((s) => ({ ...s, index: target }));
    void runEntry(trailState.entries[target]);
  }

  function retryCurrent() {
    const cur = trailState.entries[trailState.index];
    if (!cur) return;
    if (cur.kind === 'search') searchCacheRef.current.delete(cur.query);
    else articleCacheRef.current.delete(cur.url);
    void runEntry(cur);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    const url = detectUrl(q);
    if (liveMode && desktop) {
      desktop.browser.open(url ?? `https://duckduckgo.com/?q=${encodeURIComponent(q)}`);
      return;
    }
    if (url) openArticle(url);
    else navigateTo({ kind: 'search', query: q, label: q });
  }

  function handleResultClick(r: AuthorityResult) {
    if (liveMode && desktop) {
      desktop.browser.open(r.url);
      return;
    }
    openArticle(r.url, r.title);
  }

  // ── Pinned authorities ─────────────────────────────────────────────────

  const isPinned = view.kind === 'article' && pinned.some((p) => p.url === view.article.url);

  function togglePin() {
    if (view.kind !== 'article') return;
    const { url, title } = view.article;
    setPinned((prev) => {
      const next = prev.some((p) => p.url === url)
        ? prev.filter((p) => p.url !== url)
        : [{ url, title, pinnedAt: new Date().toISOString() }, ...prev];
      persistPinned(next);
      return next;
    });
  }

  function unpin(url: string) {
    setPinned((prev) => {
      const next = prev.filter((p) => p.url !== url);
      persistPinned(next);
      return next;
    });
  }

  // ── Settings ───────────────────────────────────────────────────────────

  function openSettings() {
    setEndpointInput(getReaderEndpoint());
    setSettingsOpen((p) => !p);
  }

  function saveSettings() {
    setReaderEndpoint(endpointInput);
    searchCacheRef.current.clear();
    articleCacheRef.current.clear();
    setSettingsOpen(false);
  }

  function resetSettings() {
    resetReaderEndpoint();
    setEndpointInput(DEFAULT_READER_ENDPOINT);
    searchCacheRef.current.clear();
    articleCacheRef.current.clear();
  }

  const endpointValid = /^https?:\/\/.+/i.test(endpointInput.trim());

  // ── Live Session wiring (desktop bridge) ───────────────────────────────

  function toggleLive() {
    if (!desktop) return;
    if (liveMode) {
      setLiveMode(false);
      return;
    }
    setLiveStartUrl(view.kind === 'article' ? view.article.url : 'https://duckduckgo.com/');
    setLiveMode(true);
  }

  useEffect(() => {
    if (!liveMode || !desktop) return;
    const el = liveContainerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      desktop.browser.setBounds({
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      });
    };
    const unsubscribe = desktop.browser.onState(setBrowserState);
    desktop.browser.open(liveStartUrl);
    desktop.browser.show();
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      unsubscribe();
      desktop.browser.hide();
      desktop.browser.close();
    };
  }, [liveMode, desktop, liveStartUrl]);

  // Boss key — immediately hide the native view and drop out of Live Session.
  useEffect(() => {
    if (!desktop) return;
    return desktop.onBossKey(() => {
      desktop.browser.hide();
      setLiveMode(false);
    });
  }, [desktop]);

  // ── Derived display data ───────────────────────────────────────────────

  const canBack = trailState.index > 0;
  const canForward = trailState.index < trailState.entries.length - 1;
  const recentTrail = useMemo(
    () => trailState.entries.slice(-8).reverse(),
    [trailState.entries],
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="citations-print-root flex-1 flex bg-cream overflow-hidden">
      {/* Left rail — Authorities on File + Research Trail */}
      <div className="citations-chrome w-64 bg-sidebar-bg border-r border-border flex flex-col flex-shrink-0">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-[10px] font-sans font-semibold uppercase tracking-[0.15em] text-text-muted">
            Authorities on File
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto py-1" style={{ maxHeight: '55%' }}>
          {pinned.length === 0 ? (
            <p className="px-4 py-5 text-[11px] font-sans text-text-muted text-center leading-relaxed">
              No authorities on file. Pin a retrieved copy to keep it in the record.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {pinned.map((p) => (
                <li key={p.url} className="group flex items-start">
                  <button
                    onClick={() => openArticle(p.url, p.title)}
                    className="flex-1 text-left px-4 py-2 text-xs font-sans text-text-muted hover:text-text-main hover:bg-black/[0.02] transition-colors border-l-2 border-transparent hover:border-gold min-w-0"
                    title={p.url}
                  >
                    <p className="truncate text-text-main">{p.title}</p>
                    <p className="text-[9px] font-mono text-text-muted/60 mt-0.5 truncate">
                      {hostOf(p.url)} · {citationFor(p.url)}
                    </p>
                  </button>
                  <button
                    onClick={() => unpin(p.url)}
                    className="opacity-0 group-hover:opacity-100 p-1 mt-2 mr-1 text-text-muted hover:text-red-600"
                    title="Remove from file"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-4 py-3 border-t border-b border-border">
          <h3 className="text-[10px] font-sans font-semibold uppercase tracking-[0.15em] text-text-muted">
            Research Trail
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {recentTrail.length === 0 ? (
            <p className="px-4 py-5 text-[11px] font-sans text-text-muted text-center leading-relaxed">
              Session record is empty.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {recentTrail.map((t, i) => (
                <li key={`${t.kind}-${i}-${t.label}`}>
                  <button
                    onClick={() => navigateTo({ ...t })}
                    className="w-full text-left px-4 py-1.5 text-[11px] font-sans text-text-muted hover:text-text-main hover:bg-black/[0.02] transition-colors flex items-center gap-2 min-w-0"
                    title={t.kind === 'article' ? t.url : `Query: ${t.query}`}
                  >
                    {t.kind === 'search' ? (
                      <Search className="w-3 h-3 flex-shrink-0 text-text-muted/60" />
                    ) : (
                      <Globe className="w-3 h-3 flex-shrink-0 text-text-muted/60" />
                    )}
                    <span className="truncate">{t.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Main column */}
      <div className="citations-main-col flex-1 flex flex-col overflow-hidden">
        {/* Query bar */}
        <div className="citations-chrome border-b border-border bg-white px-6 py-3 flex items-center gap-3 flex-shrink-0 relative">
          <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2 min-w-0">
            <Search className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Query external authorities… (or paste a URL to retrieve)"
              className="flex-1 min-w-0 bg-transparent text-sm font-serif text-text-main placeholder-text-muted focus:outline-none"
              spellCheck={false}
            />
            <button
              type="submit"
              className="px-3 py-1 text-[10px] font-sans uppercase tracking-wider bg-navy text-white hover:bg-navy-light transition-colors"
              style={{ borderRadius: 0 }}
            >
              Retrieve
            </button>
          </form>

          <div className="flex items-center gap-2 flex-shrink-0">
            {canBack || canForward ? (
              <div className="flex items-center border border-border" style={{ borderRadius: 0 }}>
                <button
                  onClick={() => goStep(-1)}
                  disabled={!canBack}
                  className="p-1.5 text-text-muted hover:text-navy disabled:opacity-30 disabled:hover:text-text-muted"
                  title="Back in research trail"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => goStep(1)}
                  disabled={!canForward}
                  className="p-1.5 text-text-muted hover:text-navy disabled:opacity-30 disabled:hover:text-text-muted"
                  title="Forward in research trail"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : null}

            {view.kind === 'article' && (
              <div
                className="flex items-center border border-border"
                style={{ borderRadius: 0 }}
                title="Reading size for retrieved copies"
              >
                <button
                  onClick={() => stepFontSize(-1)}
                  disabled={fontStep === 0}
                  className="p-1.5 text-text-muted hover:text-navy disabled:opacity-30 disabled:hover:text-text-muted"
                  title="Decrease reading size"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono text-[10px] text-text-muted w-10 text-center">
                  {articleFontSize}px
                </span>
                <button
                  onClick={() => stepFontSize(1)}
                  disabled={fontStep === FONT_STEPS.length - 1}
                  className="p-1.5 text-text-muted hover:text-navy disabled:opacity-30 disabled:hover:text-text-muted"
                  title="Increase reading size"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {desktop && (
              <button
                onClick={toggleLive}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-sans uppercase tracking-wider border transition-colors ${
                  liveMode
                    ? 'bg-navy text-white border-navy'
                    : 'text-text-muted border-border hover:text-navy'
                }`}
                style={{ borderRadius: 0 }}
                title="Live Session — attach the native retrieval viewport"
              >
                <MonitorPlay className="w-3.5 h-3.5" />
                Live Session
              </button>
            )}

            <button
              onClick={openSettings}
              className={`p-1.5 border border-border transition-colors ${
                settingsOpen ? 'text-navy bg-cream' : 'text-text-muted hover:text-navy'
              }`}
              style={{ borderRadius: 0 }}
              title="Retrieval configuration"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Retrieval Configuration popover */}
          {settingsOpen && (
            <div
              className="absolute right-4 top-full mt-1 z-40 w-80 bg-white shadow-lg p-4"
              style={{ border: '1px solid #D9D2C0', borderRadius: 0 }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="kicker">Retrieval Configuration</span>
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="text-text-muted hover:text-navy"
                  title="Close"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <label className="block text-[10px] font-sans uppercase tracking-wider text-text-muted mb-1">
                Reader endpoint
              </label>
              <input
                type="text"
                value={endpointInput}
                onChange={(e) => setEndpointInput(e.target.value)}
                className="w-full px-2 py-1.5 text-[11px] font-mono text-text-main bg-cream focus:outline-none focus:border-gold"
                style={{ border: '1px solid #D9D2C0', borderRadius: 0 }}
                spellCheck={false}
              />
              {!endpointValid && (
                <p className="text-[10px] font-sans text-red-700 mt-1">
                  Endpoint must be an http(s) URL.
                </p>
              )}
              <p className="text-[10px] font-sans text-text-muted mt-2 leading-relaxed">
                Must be a text-extraction proxy: the target page URL is appended to this
                endpoint and the response is expected as markdown/plain text.
              </p>
              <div className="flex items-center justify-between mt-3">
                <button
                  onClick={resetSettings}
                  className="text-[10px] font-sans uppercase tracking-wider text-text-muted hover:text-navy"
                >
                  Reset to default
                </button>
                <button
                  onClick={saveSettings}
                  disabled={!endpointValid}
                  className="px-3 py-1 text-[10px] font-sans uppercase tracking-wider bg-navy text-white hover:bg-navy-light disabled:opacity-40"
                  style={{ borderRadius: 0 }}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Live Session viewport */}
        {liveMode && desktop ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="border-b border-border bg-white px-4 py-1.5 flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => desktop.browser.back()}
                disabled={!browserState?.canGoBack}
                className="p-1 text-text-muted hover:text-navy disabled:opacity-30"
                title="Back"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => desktop.browser.forward()}
                disabled={!browserState?.canGoForward}
                className="p-1 text-text-muted hover:text-navy disabled:opacity-30"
                title="Forward"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => desktop.browser.reload()}
                className="p-1 text-text-muted hover:text-navy"
                title="Reload"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              <span className="flex-1 min-w-0 px-2 py-1 bg-cream text-[10px] font-mono text-text-muted truncate" style={{ borderRadius: 0 }}>
                {browserState?.url ?? liveStartUrl}
              </span>
              {browserState?.loading && <span className="editorial-loader" aria-hidden />}
              <button
                onClick={toggleLive}
                className="px-2.5 py-1 text-[10px] font-sans uppercase tracking-wider text-claret border border-border hover:border-claret"
                style={{ borderRadius: 0 }}
              >
                End Session
              </button>
            </div>
            <div ref={liveContainerRef} className="flex-1 bg-cream flex items-center justify-center">
              <p className="text-[10px] font-mono text-text-muted/60">
                Live session viewport attached — native retrieval surface.
              </p>
            </div>
          </div>
        ) : (
          <div className="citations-article-scroll flex-1 overflow-y-auto px-8 py-6">
            <div className="max-w-3xl mx-auto">
              {/* Masthead */}
              <div className="mb-5 pb-4 border-b border-border text-center">
                <p className="text-[10px] font-serif uppercase tracking-[0.2em] text-navy/60 mb-1">
                  CIRCUITUS EXTERNAL AUTHORITIES DESK
                </p>
                <h1 className="font-serif text-lg font-bold text-navy">
                  Citations &amp; Retrieved Authorities
                </h1>
                <p className="text-[10px] font-mono text-text-muted mt-1">
                  Certified copies obtained through the external reporter network.
                </p>
              </div>

              {busy && (
                <div className="text-center py-16">
                  <span className="editorial-loader mx-auto mb-3" aria-hidden />
                  <p className="text-xs font-sans text-text-muted">{busy}</p>
                </div>
              )}

              {!busy && error && (
                <div
                  className="bg-claret/5 p-5 text-center"
                  style={{ border: '1px solid rgba(122, 30, 46, 0.25)' }}
                >
                  <p className="font-serif text-[13px] italic text-claret-dark mb-3">
                    <span className="smcp not-italic mr-2">Notice —</span>
                    {error}
                  </p>
                  <button
                    onClick={retryCurrent}
                    className="px-3 py-1 text-[10px] font-sans uppercase tracking-wider bg-navy text-white hover:bg-navy-light"
                    style={{ borderRadius: 0 }}
                  >
                    Retry retrieval
                  </button>
                </div>
              )}

              {!busy && !error && view.kind === 'idle' && (
                <div className="text-center py-16">
                  <p className="kicker mb-3">No Authority Under Review</p>
                  <p className="text-xs font-sans text-text-muted leading-relaxed max-w-md mx-auto">
                    Submit a query to canvass the external reporters, or paste a source URL
                    to retrieve a certified copy for the record.
                  </p>
                </div>
              )}

              {!busy && !error && view.kind === 'results' && (
                <>
                  <div className="flex items-baseline justify-between mb-3">
                    <p className="text-[11px] font-sans text-text-muted">
                      Table of authorities for{' '}
                      <span className="font-serif italic text-text-main">“{view.query}”</span>
                    </p>
                    <span className="text-[9px] font-sans uppercase tracking-wider text-text-muted/70">
                      {view.outcome.source === 'wikipedia'
                        ? 'Fallback registry — encyclopedic record'
                        : 'External reporter network'}
                    </span>
                  </div>
                  {view.outcome.results.length === 0 ? (
                    <p className="text-center text-xs font-sans text-text-muted py-16">
                      No responsive authorities located.
                    </p>
                  ) : (
                    <ol className="space-y-3">
                      {view.outcome.results.map((r, idx) => (
                        <li
                          key={r.url}
                          className="bg-white border border-border rounded p-4 hover:border-gold/40 hover:shadow-sm transition-all"
                        >
                          <div className="flex items-start gap-4">
                            <span className="font-mono text-[10px] text-text-muted/60 w-6 text-right pt-0.5">
                              {idx + 1}.
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[9px] font-sans font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-navy text-white">
                                  {r.domain}
                                </span>
                                <span className="text-[10px] font-mono text-text-muted/60">
                                  {citationFor(r.url)}
                                </span>
                              </div>
                              <button
                                onClick={() => handleResultClick(r)}
                                className="block text-left font-serif text-base text-navy hover:underline leading-snug"
                              >
                                {r.title}
                              </button>
                              {r.snippet && (
                                <p className="text-[12px] font-serif text-text-muted leading-snug mt-1">
                                  {r.snippet}
                                </p>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}

              {!busy && !error && view.kind === 'article' && (
                <article
                  className="bg-white px-10 py-8"
                  style={{ border: '1px solid #D9D2C0', borderRadius: 0 }}
                >
                  {/* Disguise header */}
                  <div className="text-center mb-2">
                    <p className="kicker mb-1">External Authority — Retrieved Copy</p>
                    <p className="text-[10px] font-mono text-text-muted">
                      Ref. {retrievalRefFor(view.article.url)} · {citationFor(view.article.url)}
                    </p>
                  </div>
                  <div className="rule-double my-4" aria-hidden />
                  <div className="flex items-start justify-between gap-4 mb-1">
                    <h2 className="flex-1 font-serif text-xl font-bold text-navy leading-snug text-center">
                      {view.article.title}
                    </h2>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => window.print()}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-sans uppercase tracking-wider border text-text-muted border-border hover:text-navy transition-colors"
                        style={{ borderRadius: 0 }}
                        title="Print a copy of this retrieved authority"
                      >
                        <Printer className="w-3 h-3" />
                        Print Copy
                      </button>
                      <button
                        onClick={togglePin}
                        className={`flex items-center gap-1 px-2 py-1 text-[10px] font-sans uppercase tracking-wider border transition-colors ${
                          isPinned
                            ? 'bg-navy text-white border-navy'
                            : 'text-text-muted border-border hover:text-navy'
                        }`}
                        style={{ borderRadius: 0 }}
                        title={isPinned ? 'Remove from authorities on file' : 'Pin to authorities on file'}
                      >
                        <Pin className="w-3 h-3" />
                        {isPinned ? 'On File' : 'Pin'}
                      </button>
                    </div>
                  </div>
                  <p className="text-center text-[10px] font-mono text-text-muted mb-6 break-all">
                    {view.article.url}
                    <span className="mx-1.5 text-text-muted/40">·</span>
                    retrieved {new Date(view.article.retrievedAt).toLocaleString()}
                    {view.article.publishedTime && (
                      <>
                        <span className="mx-1.5 text-text-muted/40">·</span>
                        published {new Date(view.article.publishedTime).toLocaleDateString()}
                      </>
                    )}
                  </p>
                  <div className="prose-legal" style={{ fontSize: `${articleFontSize}px` }}>
                    <Markdown markdown={view.article.markdown} onLinkClick={handleLinkClick} />
                  </div>
                </article>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
