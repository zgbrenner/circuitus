/**
 * Docket-subscription feed layer.
 *
 * A "docket subscription" is a subreddit or an RSS/Atom feed surfaced under
 * the Dockets tab as filing alerts. Fetching is defensive throughout:
 *
 *  - reddit: `www.reddit.com/r/<sub>/hot.json` direct first (CORS support
 *    varies), then `api.reddit.com` direct. The reader proxy is useless here
 *    because it flattens JSON to markdown.
 *  - rss: direct XML fetch + DOMParser is the primary path (many feeds allow
 *    CORS). If direct fails, fetch through the configured reader endpoint and
 *    heuristically extract markdown links — a degraded "digest copy" (titles
 *    are often lost by the reader's XML flattening; items carry no dates).
 *
 * All titles/summaries are text-only extractions (`.textContent` on parsed
 * DOM, never innerHTML). Per-feed results are cached in-memory for 5 minutes.
 */

import { getReaderEndpoint, parseReaderPayload, hostOf } from '@/lib/reader';

export interface DocketFeed {
  id: string;
  label: string;
  kind: 'reddit' | 'rss';
  source: string; // subreddit name (no r/) or feed URL
}

export interface DocketItem {
  /** Stable id (reddit t3_ name, RSS guid/Atom id, or the link URL). */
  id: string;
  feedId: string;
  title: string;
  /** External article link (validated http/https) or null. */
  url: string | null;
  /** Discussion link (reddit permalink) or null. */
  commentsUrl: string | null;
  /** ISO timestamp or null (degraded digest items carry no dates). */
  publishedAt: string | null;
  /** Domain of `url`, or `r/<sub>` for reddit. */
  sourceName: string;
  score: number | null;
  numComments: number | null;
  isSelf: boolean;
  /** True when the item came through the reader-proxy digest fallback. */
  degraded: boolean;
}

export interface FeedFetchResult {
  items: DocketItem[];
  fetchedAt: number;
  /** True when the whole result is a reader-proxy "digest copy". */
  degraded: boolean;
}

const FEEDS_KEY = 'circuitus_dockets_feeds';
const READ_KEY = 'circuitus_dockets_read';
const READ_CAP = 500;
const FETCH_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 5 * 60_000;
const MAX_ITEMS = 30;

/** Disguise-voice fetch failure shared by both strategies. */
export const SEALED_DOCKET_MESSAGE =
  "Clerk's office unreachable — docket temporarily sealed.";

// ── Subscription persistence ─────────────────────────────────────────────

const SEED_FEEDS: DocketFeed[] = [
  {
    id: 'seed-reddit-programming',
    label: 'N.D. Cal. — Technology Docket',
    kind: 'reddit',
    source: 'programming',
  },
  {
    id: 'seed-rss-hn-frontpage',
    label: 'Fed. Cir. — Advance Wire',
    kind: 'rss',
    source: 'https://hnrss.org/frontpage',
  },
];

function isValidFeed(f: unknown): f is DocketFeed {
  if (typeof f !== 'object' || f === null) return false;
  const o = f as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.label === 'string' &&
    (o.kind === 'reddit' || o.kind === 'rss') &&
    typeof o.source === 'string' &&
    o.source.length > 0
  );
}

/** Load the subscription roll; seeds two defaults on first run. */
export function loadFeeds(): DocketFeed[] {
  try {
    const raw = localStorage.getItem(FEEDS_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(isValidFeed);
      return [];
    }
  } catch {
    // storage unavailable / corrupt — fall through to seed
  }
  saveFeeds(SEED_FEEDS);
  return [...SEED_FEEDS];
}

export function saveFeeds(feeds: DocketFeed[]): void {
  try {
    localStorage.setItem(FEEDS_KEY, JSON.stringify(feeds));
  } catch {
    // ignore storage failures
  }
}

export function newFeedId(): string {
  return `feed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Interpret user input as a subscription source:
 * `r/foo`, `/r/foo`, or a bare subreddit name → reddit; http(s) URL → rss.
 * Returns null when the input matches neither shape.
 */
export function parseFeedInput(
  input: string,
): { kind: DocketFeed['kind']; source: string } | null {
  const t = input.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return { kind: 'rss', source: u.toString() };
    } catch {
      return null;
    }
  }
  const sub = t.replace(/^\/?r\//i, '');
  if (/^[A-Za-z0-9][A-Za-z0-9_]{1,20}$/.test(sub)) {
    return { kind: 'reddit', source: sub };
  }
  return null;
}

/** A disguise-voice default caption for a newly docketed subscription. */
export function defaultLabelFor(kind: DocketFeed['kind'], source: string): string {
  if (kind === 'reddit') return `D. Reddit — r/${source} Division`;
  return `${hostOf(source)} — Docket Wire`;
}

// ── Read-state persistence (FIFO, capped) ────────────────────────────────

/** Insertion-ordered list of read item ids (oldest first). */
export function loadReadIds(): string[] {
  try {
    const raw = localStorage.getItem(READ_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    // ignore
  }
  return [];
}

/** Persist read ids, evicting oldest beyond the cap (FIFO). */
export function saveReadIds(ids: string[]): void {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(ids.slice(-READ_CAP)));
  } catch {
    // ignore storage failures
  }
}

// ── Shared fetch helpers ─────────────────────────────────────────────────

async function fetchTextWithTimeout(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Registry responded ${res.status}`);
  return res.text();
}

function httpUrlOrNull(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {
    // fall through
  }
  return null;
}

/**
 * Text-only extraction of a fragment that may itself contain HTML markup
 * (e.g. an RSS <description> CDATA). DOMParser is inert — nothing executes —
 * and we only ever read `.textContent`.
 */
function textOnly(fragment: string): string {
  if (!/[<&]/.test(fragment)) return fragment.replace(/\s+/g, ' ').trim();
  const doc = new DOMParser().parseFromString(fragment, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// ── Reddit strategy ──────────────────────────────────────────────────────

interface RedditChildData {
  name?: unknown;
  id?: unknown;
  title?: unknown;
  permalink?: unknown;
  url?: unknown;
  score?: unknown;
  num_comments?: unknown;
  created_utc?: unknown;
  subreddit?: unknown;
  selftext?: unknown;
  is_self?: unknown;
  over_18?: unknown;
}

function parseRedditListing(text: string, feed: DocketFeed): DocketItem[] {
  const parsed: unknown = JSON.parse(text);
  const children = (parsed as { data?: { children?: unknown } })?.data?.children;
  if (!Array.isArray(children)) throw new Error('Unexpected registry format');
  const items: DocketItem[] = [];
  for (const child of children) {
    const d = (child as { data?: RedditChildData })?.data;
    if (!d || typeof d.title !== 'string') continue;
    if (d.over_18 === true) continue; // never surface adult filings
    const permalink =
      typeof d.permalink === 'string' && d.permalink.startsWith('/')
        ? `https://www.reddit.com${d.permalink}`
        : null;
    const isSelf =
      d.is_self === true || (typeof d.selftext === 'string' && d.selftext.length > 0);
    const rawUrl = typeof d.url === 'string' ? d.url : null;
    // Self posts point their url at the permalink; treat as no external link.
    const external = isSelf ? null : httpUrlOrNull(rawUrl);
    const id =
      typeof d.name === 'string' && d.name.length > 0
        ? d.name
        : typeof d.id === 'string'
          ? `t3_${d.id}`
          : permalink ?? textOnly(d.title);
    const createdUtc = typeof d.created_utc === 'number' ? d.created_utc : null;
    const sub = typeof d.subreddit === 'string' ? d.subreddit : feed.source;
    items.push({
      id,
      feedId: feed.id,
      title: textOnly(d.title),
      url: external,
      commentsUrl: permalink,
      publishedAt: createdUtc !== null ? new Date(createdUtc * 1000).toISOString() : null,
      sourceName: external !== null ? hostOf(external) : `r/${sub}`,
      score: typeof d.score === 'number' ? d.score : null,
      numComments: typeof d.num_comments === 'number' ? d.num_comments : null,
      isSelf,
      degraded: false,
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

async function fetchReddit(feed: DocketFeed): Promise<FeedFetchResult> {
  const sub = encodeURIComponent(feed.source);
  const attempts = [
    `https://www.reddit.com/r/${sub}/hot.json?limit=30&raw_json=1`,
    // The reader proxy flattens JSON to markdown, so the fallback is
    // api.reddit.com direct rather than the reader.
    `https://api.reddit.com/r/${sub}/hot?limit=30&raw_json=1`,
  ];
  for (const url of attempts) {
    try {
      const text = await fetchTextWithTimeout(url);
      return { items: parseRedditListing(text, feed), fetchedAt: Date.now(), degraded: false };
    } catch {
      // try the next strategy
    }
  }
  throw new Error(SEALED_DOCKET_MESSAGE);
}

// ── RSS/Atom strategy ────────────────────────────────────────────────────

/** First child element of `el` with the given local name (namespace-blind). */
function childText(el: Element, localName: string): string | null {
  for (const c of Array.from(el.children)) {
    if (c.localName === localName) {
      const t = c.textContent;
      return t !== null ? t.trim() : null;
    }
  }
  return null;
}

function atomLinkHref(entry: Element): string | null {
  let fallback: string | null = null;
  for (const c of Array.from(entry.children)) {
    if (c.localName !== 'link') continue;
    const href = c.getAttribute('href');
    if (!href) continue;
    const rel = c.getAttribute('rel');
    if (rel === null || rel === 'alternate') return href;
    fallback = fallback ?? href;
  }
  return fallback;
}

function parseDate(raw: string | null): string | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Parse RSS 2.0 or Atom XML. Returns null when the text isn't a feed. */
function parseXmlFeed(text: string, feed: DocketFeed, degraded: boolean): DocketItem[] | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'text/xml');
  } catch {
    return null;
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return null;

  const rssItems = Array.from(doc.getElementsByTagName('item'));
  const atomEntries = rssItems.length === 0 ? Array.from(doc.getElementsByTagName('entry')) : [];
  if (rssItems.length === 0 && atomEntries.length === 0) return null;

  const out: DocketItem[] = [];
  const seen = new Set<string>();
  const push = (
    title: string | null,
    link: string | null,
    published: string | null,
    guid: string | null,
  ) => {
    if (out.length >= MAX_ITEMS) return;
    const url = httpUrlOrNull(link);
    const cleanTitle = title ? textOnly(title) : '';
    if (!cleanTitle && !url) return;
    const id = guid?.trim() || url || `${feed.id}:${cleanTitle}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      feedId: feed.id,
      title: cleanTitle || (url !== null ? hostOf(url) : '(untitled filing)'),
      url,
      commentsUrl: null,
      publishedAt: published,
      sourceName: url !== null ? hostOf(url) : hostOf(feed.source),
      score: null,
      numComments: null,
      isSelf: false,
      degraded,
    });
  };

  for (const item of rssItems) {
    push(
      childText(item, 'title'),
      childText(item, 'link'),
      parseDate(childText(item, 'pubDate')),
      childText(item, 'guid'),
    );
  }
  for (const entry of atomEntries) {
    push(
      childText(entry, 'title'),
      atomLinkHref(entry),
      parseDate(childText(entry, 'updated') ?? childText(entry, 'published')),
      childText(entry, 'id'),
    );
  }
  return out;
}

/**
 * Degraded fallback: pull markdown links out of the reader's digest of the
 * feed. The reader flattens XML, so link text is often just the URL — derive
 * a readable title from host + path in that case. No dates survive.
 */
function parseDigestLinks(markdown: string, feed: DocketFeed): DocketItem[] {
  const LINK_RE = /(!?)\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  const out: DocketItem[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(markdown)) !== null && out.length < MAX_ITEMS) {
    if (m[1] === '!') continue; // skip images
    const url = httpUrlOrNull(m[3]);
    if (!url || seen.has(url)) continue;
    // Skip the feed's own chrome (self-links back to the feed host).
    if (url === feed.source) continue;
    seen.add(url);
    const text = textOnly(m[2]);
    const looksLikeUrl = !text || (!text.includes(' ') && /[./]/.test(text));
    let title = text;
    if (looksLikeUrl) {
      try {
        const u = new URL(url);
        const path = decodeURIComponent(u.pathname).replace(/\/+$/, '');
        title = path && path !== '/' ? `${u.hostname.replace(/^www\./, '')}${path}` : u.hostname;
      } catch {
        title = url;
      }
    }
    out.push({
      id: url,
      feedId: feed.id,
      title,
      url,
      commentsUrl: null,
      publishedAt: null,
      sourceName: hostOf(url),
      score: null,
      numComments: null,
      isSelf: false,
      degraded: true,
    });
  }
  return out;
}

async function fetchRss(feed: DocketFeed): Promise<FeedFetchResult> {
  // Primary path: direct fetch + XML parse (many feeds allow CORS).
  try {
    const text = await fetchTextWithTimeout(feed.source);
    const items = parseXmlFeed(text, feed, false);
    if (items !== null && items.length > 0) {
      return { items, fetchedAt: Date.now(), degraded: false };
    }
  } catch {
    // fall through to the reader endpoint
  }
  // Fallback: the configured reader endpoint. It converts XML to markdown,
  // so try XML parse first (in case a custom proxy passes it through), then
  // degrade to heuristic markdown-link extraction ("digest copy").
  try {
    const raw = await fetchTextWithTimeout(getReaderEndpoint() + feed.source);
    const payload = parseReaderPayload(raw);
    const asXml = parseXmlFeed(raw, feed, true);
    if (asXml !== null && asXml.length > 0) {
      return { items: asXml, fetchedAt: Date.now(), degraded: true };
    }
    const digest = parseDigestLinks(payload.markdown, feed);
    if (digest.length > 0) {
      return { items: digest, fetchedAt: Date.now(), degraded: true };
    }
  } catch {
    // fall through to the sealed-docket error
  }
  throw new Error(SEALED_DOCKET_MESSAGE);
}

// ── Public fetch API (session cache) ─────────────────────────────────────

const cache = new Map<string, FeedFetchResult>();
const inflight = new Map<string, Promise<FeedFetchResult>>();

/**
 * Fetch a subscription's current filings. Results are cached in-memory for
 * five minutes per feed; pass `force` to bypass. Rejects with a
 * disguise-voice Error when every strategy fails.
 */
export function fetchFeedItems(feed: DocketFeed, force = false): Promise<FeedFetchResult> {
  const key = `${feed.id}:${feed.kind}:${feed.source}`;
  if (!force) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return Promise.resolve(hit);
    const pending = inflight.get(key);
    if (pending) return pending;
  }
  const p = (feed.kind === 'reddit' ? fetchReddit(feed) : fetchRss(feed))
    .then((result) => {
      cache.set(key, result);
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}
