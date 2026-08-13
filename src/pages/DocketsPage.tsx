import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ExternalLink,
  Gavel,
  Hash,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Rss,
  Star,
  Trash2,
} from 'lucide-react';
import {
  defaultLabelFor,
  fetchFeedItems,
  loadFeeds,
  loadReadIds,
  newFeedId,
  parseFeedInput,
  saveFeeds,
  saveReadIds,
  type DocketFeed,
  type DocketItem,
} from '@/lib/feeds';

const ALL_DOCKETS = 'all';

interface FeedState {
  status: 'loading' | 'ready' | 'error';
  items: DocketItem[];
  error?: string;
  degraded?: boolean;
}

function docketNumberFor(item: DocketItem): string {
  const d = item.publishedAt ? new Date(item.publishedAt) : new Date();
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  let h = 0;
  for (let i = 0; i < item.id.length; i++) h = (h * 31 + item.id.charCodeAt(i)) >>> 0;
  return `Dkt. ${yy}-${String(1000 + (h % 9000))}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just entered';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export default function DocketsPage() {
  const [feeds, setFeeds] = useState<DocketFeed[]>(() => loadFeeds());
  const [selectedId, setSelectedId] = useState<string>(ALL_DOCKETS);
  const [states, setStates] = useState<Record<string, FeedState>>({});
  const [readList, setReadList] = useState<string[]>(() => loadReadIds());
  const [adding, setAdding] = useState(false);
  const [draftSource, setDraftSource] = useState('');
  const [draftLabel, setDraftLabel] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const readSet = useMemo(() => new Set(readList), [readList]);

  const loadFeed = useCallback((feed: DocketFeed, force = false) => {
    setStates((prev) => ({
      ...prev,
      [feed.id]: { status: 'loading', items: prev[feed.id]?.items ?? [] },
    }));
    fetchFeedItems(feed, force)
      .then((r) => {
        setStates((prev) => ({
          ...prev,
          [feed.id]: { status: 'ready', items: r.items, degraded: r.degraded },
        }));
      })
      .catch((err: unknown) => {
        setStates((prev) => ({
          ...prev,
          [feed.id]: {
            status: 'error',
            items: [],
            error: err instanceof Error ? err.message : 'Docket temporarily sealed.',
          },
        }));
      });
  }, []);

  // Fetch each subscription exactly once on arrival (cache handles repeats).
  const requestedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const f of feeds) {
      if (!requestedRef.current.has(f.id)) {
        requestedRef.current.add(f.id);
        loadFeed(f);
      }
    }
  }, [feeds, loadFeed]);

  function refreshAll() {
    for (const f of feeds) loadFeed(f, true);
  }

  function markRead(id: string) {
    if (readSet.has(id)) return;
    setReadList((prev) => {
      const next = [...prev, id];
      saveReadIds(next);
      return next;
    });
  }

  /**
   * Primary action: keep the reader inside chambers. Write the URL to the
   * `circuitus_pending_retrieval` handoff key, then dispatch a cancelable
   * `circuitus:read-authority` CustomEvent. A listener (MainLayout → the
   * Citations desk) signals it handled the event by calling preventDefault();
   * if nothing does, degrade gracefully and open the source externally.
   */
  function openFiling(item: DocketItem) {
    const target = item.url ?? item.commentsUrl;
    if (!target) return;
    markRead(item.id);
    try {
      localStorage.setItem('circuitus_pending_retrieval', target);
    } catch {
      // storage unavailable — the event detail still carries the URL
    }
    const unhandled = window.dispatchEvent(
      new CustomEvent('circuitus:read-authority', {
        cancelable: true,
        detail: { url: target },
      }),
    );
    if (unhandled) {
      window.open(target, '_blank', 'noopener,noreferrer');
    }
  }

  function handleAdd() {
    const parsed = parseFeedInput(draftSource);
    if (!parsed) {
      setAddError('Unrecognized docket identifier — enter r/… or an https:// feed address.');
      return;
    }
    const feed: DocketFeed = {
      id: newFeedId(),
      label: draftLabel.trim() || defaultLabelFor(parsed.kind, parsed.source),
      kind: parsed.kind,
      source: parsed.source,
    };
    const next = [...feeds, feed];
    setFeeds(next);
    saveFeeds(next);
    setAdding(false);
    setDraftSource('');
    setDraftLabel('');
    setAddError(null);
    setSelectedId(feed.id);
  }

  function handleRename(feed: DocketFeed) {
    const label = window.prompt('Restyle subscription caption:', feed.label);
    if (label === null || !label.trim()) return;
    const next = feeds.map((f) => (f.id === feed.id ? { ...f, label: label.trim() } : f));
    setFeeds(next);
    saveFeeds(next);
  }

  function handleWithdraw(feed: DocketFeed) {
    const ok = window.confirm(
      `Withdraw subscription "${feed.label}"? This docket will no longer be monitored.`,
    );
    if (!ok) return;
    const next = feeds.filter((f) => f.id !== feed.id);
    setFeeds(next);
    saveFeeds(next);
    setStates((prev) => {
      const rest = { ...prev };
      delete rest[feed.id];
      return rest;
    });
    if (selectedId === feed.id) setSelectedId(ALL_DOCKETS);
  }

  const unreadByFeed = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of feeds) {
      const st = states[f.id];
      counts[f.id] = st ? st.items.filter((it) => !readSet.has(it.id)).length : 0;
    }
    return counts;
  }, [feeds, states, readSet]);

  const totalUnread = useMemo(
    () => Object.values(unreadByFeed).reduce((a, b) => a + b, 0),
    [unreadByFeed],
  );

  const anyLoading = feeds.some((f) => states[f.id]?.status === 'loading');
  const selectedFeed = feeds.find((f) => f.id === selectedId) ?? null;

  /** Items for the current selection; the merged view sorts chronologically. */
  const visibleItems = useMemo(() => {
    if (selectedFeed) return states[selectedFeed.id]?.items ?? [];
    const merged = feeds.flatMap((f) => states[f.id]?.items ?? []);
    return merged.sort((a, b) => {
      if (a.publishedAt === null && b.publishedAt === null) return 0;
      if (a.publishedAt === null) return 1;
      if (b.publishedAt === null) return -1;
      return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    });
  }, [feeds, states, selectedFeed]);

  const erroredFeeds = useMemo(
    () =>
      feeds.filter((f) => {
        if (states[f.id]?.status !== 'error') return false;
        return selectedFeed === null || f.id === selectedFeed.id;
      }),
    [feeds, states, selectedFeed],
  );

  const selectedLoading = selectedFeed
    ? states[selectedFeed.id]?.status === 'loading'
    : anyLoading;
  const showDigestNote = selectedFeed
    ? states[selectedFeed.id]?.degraded === true
    : feeds.some((f) => states[f.id]?.degraded === true);

  const labelByFeed = useMemo(
    () => new Map(feeds.map((f) => [f.id, f.label])),
    [feeds],
  );

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        {/* Docket Subscriptions rail */}
        <div className="w-64 bg-sidebar-bg border-r border-border flex flex-col flex-shrink-0">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-[10px] font-sans font-semibold uppercase tracking-[0.15em] text-text-muted">
              Docket Subscriptions
            </h3>
            <button
              onClick={refreshAll}
              className="flex items-center gap-1 text-[10px] font-sans uppercase tracking-wider text-text-muted hover:text-navy"
              title="Refresh all dockets"
            >
              <RefreshCw className={`w-3 h-3 ${anyLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="px-2 py-2 border-b border-border">
            {adding ? (
              <div className="px-2 py-1 space-y-1.5">
                <input
                  autoFocus
                  value={draftSource}
                  onChange={(e) => setDraftSource(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd();
                    if (e.key === 'Escape') {
                      setAdding(false);
                      setAddError(null);
                    }
                  }}
                  placeholder="r/subreddit or https://…"
                  className="w-full bg-white border border-border px-2 py-1 text-[11px] font-mono text-text-main placeholder:text-text-muted/60 focus:outline-none focus:border-gold"
                />
                <input
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd();
                  }}
                  placeholder="Caption (optional)"
                  className="w-full bg-white border border-border px-2 py-1 text-[11px] font-sans text-text-main placeholder:text-text-muted/60 focus:outline-none focus:border-gold"
                />
                {addError && (
                  <p className="text-[10px] font-sans text-red-700 leading-snug">{addError}</p>
                )}
                <div className="flex gap-1.5">
                  <button
                    onClick={handleAdd}
                    className="flex-1 bg-navy text-white text-[11px] font-sans font-medium px-2 py-1 rounded hover:bg-navy-light transition-colors"
                  >
                    Enter Appearance
                  </button>
                  <button
                    onClick={() => {
                      setAdding(false);
                      setAddError(null);
                    }}
                    className="text-[11px] font-sans px-2 py-1 rounded text-text-muted hover:text-navy hover:bg-black/[0.04] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="w-full flex items-center justify-center gap-1.5 bg-navy text-white text-[11px] font-sans font-medium px-3 py-1.5 rounded hover:bg-navy-light transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add Docket Subscription
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            <button
              onClick={() => setSelectedId(ALL_DOCKETS)}
              className={`w-full flex items-center gap-2 text-left px-4 py-2 text-xs font-sans transition-colors border-l-2 ${
                selectedId === ALL_DOCKETS
                  ? 'border-gold bg-gold/5 text-navy font-medium'
                  : 'border-transparent text-text-muted hover:text-text-main hover:bg-black/[0.02]'
              }`}
            >
              <Gavel className="w-3 h-3 flex-shrink-0" />
              <span className="flex-1 truncate">All Dockets</span>
              {totalUnread > 0 && (
                <span className="font-mono text-[9px] text-gold">{totalUnread}</span>
              )}
            </button>

            {feeds.length === 0 && (
              <p className="px-4 py-6 text-xs text-text-muted font-sans text-center leading-relaxed">
                No subscriptions of record. Enter an appearance above to begin monitoring.
              </p>
            )}

            <ul className="space-y-0.5">
              {feeds.map((f) => (
                <li key={f.id} className="group flex items-center">
                  <button
                    onClick={() => setSelectedId(f.id)}
                    className={`flex-1 min-w-0 flex items-center gap-2 text-left px-4 py-2 text-xs font-sans transition-colors border-l-2 ${
                      selectedId === f.id
                        ? 'border-gold bg-gold/5 text-navy font-medium'
                        : 'border-transparent text-text-muted hover:text-text-main hover:bg-black/[0.02]'
                    }`}
                    title={f.kind === 'reddit' ? `r/${f.source}` : f.source}
                  >
                    {f.kind === 'reddit' ? (
                      <Hash className="w-3 h-3 flex-shrink-0" />
                    ) : (
                      <Rss className="w-3 h-3 flex-shrink-0" />
                    )}
                    <span className="flex-1 truncate">{f.label}</span>
                    {(unreadByFeed[f.id] ?? 0) > 0 && (
                      <span className="font-mono text-[9px] text-gold">{unreadByFeed[f.id]}</span>
                    )}
                  </button>
                  <button
                    onClick={() => handleRename(f)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-navy"
                    title="Restyle subscription caption"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleWithdraw(f)}
                    className="opacity-0 group-hover:opacity-100 p-1 mr-1 text-text-muted hover:text-red-600"
                    title="Withdraw subscription"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Filings column */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="max-w-3xl mx-auto">
            <div className="mb-5 pb-4 border-b border-border text-center">
              <p className="text-[10px] font-serif uppercase tracking-[0.2em] text-navy/60 mb-1">
                CIRCUITUS DOCKET ALERTS
              </p>
              <h1 className="font-serif text-lg font-bold text-navy">
                Filings &amp; Activity — {selectedFeed ? selectedFeed.label : 'Subscribed Matters'}
              </h1>
              <p className="text-[10px] font-mono text-text-muted mt-1">
                {feeds.length} subscription{feeds.length === 1 ? '' : 's'} of record ·{' '}
                {visibleItems.length} filing{visibleItems.length === 1 ? '' : 's'} ·{' '}
                {totalUnread} awaiting review
              </p>
              {showDigestNote && (
                <p className="text-[10px] font-mono text-gold mt-1">
                  Digest copy — served via the reading room; captions and dates may be abridged.
                </p>
              )}
            </div>

            {selectedLoading && visibleItems.length === 0 && erroredFeeds.length === 0 && (
              <div className="text-center py-16">
                <span className="editorial-loader mx-auto mb-3" aria-hidden />
                <p className="text-xs font-sans text-text-muted">
                  Retrieving the day's filings from the clerk…
                </p>
              </div>
            )}

            {erroredFeeds.map((f) => (
              <div
                key={f.id}
                className="mb-3 bg-white p-4 flex items-center justify-between gap-4"
                style={{ border: '1px solid #D9D2C0', borderLeft: '2px solid #9C7A1F' }}
              >
                <div className="min-w-0">
                  <p className="text-xs font-sans text-text-main">
                    {states[f.id]?.error ?? 'Docket temporarily sealed.'}
                  </p>
                  <p className="text-[10px] font-mono text-text-muted mt-0.5 truncate">{f.label}</p>
                </div>
                <button
                  onClick={() => loadFeed(f, true)}
                  className="flex-shrink-0 flex items-center gap-1.5 text-[10px] font-sans uppercase tracking-wider text-text-muted hover:text-navy"
                >
                  <RefreshCw className="w-3 h-3" />
                  Renew request
                </button>
              </div>
            ))}

            {!selectedLoading && visibleItems.length === 0 && erroredFeeds.length === 0 && (
              <p className="text-center text-xs font-sans text-text-muted py-16">
                {feeds.length === 0
                  ? 'No subscriptions of record — enter an appearance to begin monitoring dockets.'
                  : 'The docket is quiet. No filings to report.'}
              </p>
            )}

            <ol className="space-y-3">
              {visibleItems.map((item, idx) => {
                const isRead = readSet.has(item.id);
                return (
                  <li
                    key={`${item.feedId}:${item.id}`}
                    className={`bg-white p-4 hover:shadow-sm transition-all ${
                      isRead ? 'opacity-60' : ''
                    }`}
                    style={{
                      border: '1px solid #D9D2C0',
                      borderLeft: isRead ? '1px solid #D9D2C0' : '2px solid #9C7A1F',
                    }}
                  >
                    <div className="flex items-start gap-4">
                      <span className="font-mono text-[10px] text-text-muted/60 w-6 text-right pt-0.5">
                        {idx + 1}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[9px] font-sans font-semibold uppercase tracking-wider px-1.5 py-0.5 bg-navy text-white">
                            {labelByFeed.get(item.feedId) ?? 'Of Record'}
                          </span>
                          <span className="text-[10px] font-mono text-text-muted/60 truncate">
                            {item.sourceName}
                          </span>
                          {item.degraded && (
                            <span className="text-[9px] font-mono text-gold flex-shrink-0">
                              digest copy
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => openFiling(item)}
                          className="block w-full text-left font-serif text-base text-navy hover:underline leading-snug"
                          title="Retrieve filing in chambers"
                        >
                          {item.title}
                        </button>
                        <div className="flex items-center gap-4 mt-2 text-[10px] font-mono text-text-muted">
                          {item.score !== null && (
                            <span className="flex items-center gap-1">
                              <Star className="w-3 h-3" /> {item.score} citations
                            </span>
                          )}
                          {item.commentsUrl !== null && item.numComments !== null && (
                            <a
                              href={item.commentsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 hover:text-navy"
                              onClick={() => markRead(item.id)}
                            >
                              <MessageSquare className="w-3 h-3" /> {item.numComments} responses
                            </a>
                          )}
                          {item.publishedAt !== null && <span>{timeAgo(item.publishedAt)}</span>}
                          <span className="ml-auto text-text-muted/60">{docketNumberFor(item)}</span>
                          {item.url !== null && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => markRead(item.id)}
                              className="flex items-center gap-1 hover:text-navy flex-shrink-0"
                              title="Open at source"
                            >
                              at source <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
