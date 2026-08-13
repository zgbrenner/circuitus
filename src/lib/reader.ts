/**
 * External-authority retrieval layer.
 *
 * All outbound page fetches go through a text-extraction reader proxy
 * (default: r.jina.ai) which returns pages as markdown/plain text — the app
 * never renders remote HTML. Web search is DuckDuckGo's HTML endpoint fetched
 * through the same proxy; if the proxy is unreachable we degrade to
 * Wikipedia's CORS-friendly search API.
 */

export const DEFAULT_READER_ENDPOINT = 'https://r.jina.ai/';

const ENDPOINT_STORAGE_KEY = 'circuitus_reader_endpoint';
const SEARCH_RESULT_CAP = 25;
const FETCH_TIMEOUT_MS = 45_000;

export interface AuthorityResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
}

export interface SearchOutcome {
  results: AuthorityResult[];
  /** 'web' = DuckDuckGo via reader proxy; 'wikipedia' = fallback registry. */
  source: 'web' | 'wikipedia';
}

export interface RetrievedAuthority {
  url: string;
  title: string;
  markdown: string;
  publishedTime: string | null;
  retrievedAt: string; // ISO
}

// ── Reader endpoint configuration ────────────────────────────────────────

function normalizeEndpoint(raw: string): string | null {
  const t = raw.trim();
  if (!/^https?:\/\/.+/i.test(t)) return null;
  return t.endsWith('/') ? t : `${t}/`;
}

export function getReaderEndpoint(): string {
  try {
    const stored = localStorage.getItem(ENDPOINT_STORAGE_KEY);
    if (stored) {
      const normalized = normalizeEndpoint(stored);
      if (normalized) return normalized;
    }
  } catch {
    // storage unavailable — fall through to default
  }
  return DEFAULT_READER_ENDPOINT;
}

/** Persist a custom endpoint. Invalid/empty values clear back to default. */
export function setReaderEndpoint(value: string): void {
  try {
    const normalized = normalizeEndpoint(value);
    if (normalized && normalized !== DEFAULT_READER_ENDPOINT) {
      localStorage.setItem(ENDPOINT_STORAGE_KEY, normalized);
    } else {
      localStorage.removeItem(ENDPOINT_STORAGE_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

export function resetReaderEndpoint(): void {
  try {
    localStorage.removeItem(ENDPOINT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ── Small shared helpers ─────────────────────────────────────────────────

/** Returns a normalized http(s) URL when the input is one, else null. */
export function detectUrl(input: string): string | null {
  const t = input.trim();
  if (/\s/.test(t) || !/^https?:\/\//i.test(t)) return null;
  try {
    const u = new URL(t);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
    return null;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Strip every match repeatedly until the string stops changing — a single
 * pass can leave a dangerous substring behind when removal reassembles one
 * (e.g. `<<x>script>` → one pass leaves `<script>`).
 */
function stripToFixpoint(s: string, re: RegExp): string {
  let prev: string;
  do {
    prev = s;
    s = s.replace(re, '');
  } while (s !== prev);
  // Anything tag-like that survives (e.g. an unterminated `<script` with no
  // closing bracket) loses its bracket, so no tag-shaped sequence remains.
  return s.replace(/<(?=[a-zA-Z/!])/g, '');
}

/** Flatten markdown/HTML decoration out of a text fragment. */
function cleanText(s: string): string {
  return stripToFixpoint(
    s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'),
    /<[^>]+>/g
  )
    .replace(/[`*_]+/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Heuristic: link text that is just a URL/domain rendering, not prose. */
function looksLikeUrlText(s: string): boolean {
  return !s.includes(' ') && /[./]/.test(s);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: 'text/plain' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`External reporter responded ${res.status}`);
  return res.text();
}

// ── Reader payload parsing ───────────────────────────────────────────────

export interface ReaderPayload {
  title: string | null;
  publishedTime: string | null;
  markdown: string;
}

/**
 * r.jina.ai (text mode) prefixes the body with a small header:
 *   Title: …\nURL Source: …\n[Published Time: …]\n\nMarkdown Content:\n<body>
 * Other proxies may return the markdown bare — degrade to treating the
 * whole payload as markdown.
 */
export function parseReaderPayload(text: string): ReaderPayload {
  const idx = text.indexOf('Markdown Content:');
  if (idx === -1 || idx > 4000) {
    return { title: null, publishedTime: null, markdown: text };
  }
  const head = text.slice(0, idx);
  const markdown = text.slice(idx + 'Markdown Content:'.length).replace(/^\r?\n/, '');
  const title = /^Title:\s*(.+)$/m.exec(head)?.[1]?.trim() ?? null;
  const publishedTime = /^Published Time:\s*(.+)$/m.exec(head)?.[1]?.trim() ?? null;
  return { title, publishedTime, markdown };
}

// ── DuckDuckGo result parsing ────────────────────────────────────────────

/**
 * Resolve a link found in the DDG results markdown.
 * Returns null for ads and non-http(s) links; marks DDG-internal chrome.
 */
function resolveDdgHref(href: string): { url: string; internal: boolean } | null {
  let raw = href.trim();
  if (raw.startsWith('//')) raw = `https:${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  const isDdg = host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com');
  if (!isDdg) return { url: u.toString(), internal: false };
  // Sponsored results route through y.js / ad params — drop them entirely.
  if (u.pathname.startsWith('/y.js') || u.searchParams.has('ad_domain') || u.searchParams.has('ad_provider')) {
    return null;
  }
  const uddg = u.searchParams.get('uddg');
  if (uddg && u.pathname.startsWith('/l/')) {
    try {
      const real = new URL(uddg);
      if (real.protocol !== 'http:' && real.protocol !== 'https:') return null;
      // Ad clicks occasionally hide behind a bing redirect inside uddg.
      const realHost = real.hostname.toLowerCase();
      const isBing = realHost === 'bing.com' || realHost.endsWith('.bing.com');
      if (isBing && real.pathname.includes('aclick')) {
        return null;
      }
      return { url: real.toString(), internal: false };
    } catch {
      return null;
    }
  }
  return { url: u.toString(), internal: true };
}

/**
 * Extract result entries from the markdown rendering of DDG's HTML results.
 * Format observed (r.jina.ai): each organic result appears as a heading link
 * `## [Title](redirect)`, followed by a favicon image link, a domain-text
 * link and a snippet link — all pointing at the same redirect URL. We group
 * every non-image link by resolved target URL: the first prose text becomes
 * the title, the longest remaining prose text the snippet. Defensive by
 * construction — unknown formats simply yield zero results.
 */
export function parseDdgResults(markdown: string): AuthorityResult[] {
  const byUrl = new Map<string, AuthorityResult>();
  const order: string[] = [];
  // URL part tolerates one level of parentheses (e.g. wiki article titles).
  const LINK_RE = /(!?)\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(markdown)) !== null) {
    if (m[1] === '!') continue; // never consider images
    const resolved = resolveDdgHref(m[3]);
    if (!resolved || resolved.internal) continue;
    let entry = byUrl.get(resolved.url);
    if (!entry) {
      if (order.length >= SEARCH_RESULT_CAP) continue;
      entry = { title: '', url: resolved.url, snippet: '', domain: hostOf(resolved.url) };
      byUrl.set(resolved.url, entry);
      order.push(resolved.url);
    }
    const text = cleanText(m[2]);
    if (!text || looksLikeUrlText(text)) continue;
    if (!entry.title) entry.title = text;
    else if (text !== entry.title && text.length > entry.snippet.length) entry.snippet = text;
  }
  return order
    .map((u) => byUrl.get(u))
    .filter((e): e is AuthorityResult => e !== undefined)
    .map((e) => (e.title ? e : { ...e, title: e.domain }));
}

// ── Wikipedia fallback search ────────────────────────────────────────────

interface WikiSearchItem {
  title: string;
  snippet?: string;
}

async function searchWikipedia(query: string): Promise<AuthorityResult[]> {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*' +
    `&srlimit=15&srsearch=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Fallback registry responded ${res.status}`);
  const data = (await res.json()) as { query?: { search?: WikiSearchItem[] } };
  const items = data.query?.search ?? [];
  return items.map((it) => ({
    title: cleanText(it.title) || it.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(it.title.replace(/ /g, '_'))}`,
    snippet: cleanText(it.snippet ?? ''),
    domain: 'en.wikipedia.org',
  }));
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Search external authorities. DuckDuckGo through the reader proxy first;
 * on proxy failure, fall back to Wikipedia's public search API.
 */
export async function searchAuthorities(query: string, endpoint: string): Promise<SearchOutcome> {
  const target = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const text = await fetchText(endpoint + target);
    const payload = parseReaderPayload(text);
    return { results: parseDdgResults(payload.markdown), source: 'web' };
  } catch {
    const results = await searchWikipedia(query);
    return { results, source: 'wikipedia' };
  }
}

/** Retrieve a single authority (page) through the reader proxy. */
export async function fetchAuthority(url: string, endpoint: string): Promise<RetrievedAuthority> {
  const text = await fetchText(endpoint + url);
  const payload = parseReaderPayload(text);
  let title = payload.title;
  if (!title) {
    const heading = /^#{1,2}\s+(.+)$/m.exec(payload.markdown);
    title = heading ? cleanText(heading[1]) : hostOf(url);
  }
  return {
    url,
    title: title || hostOf(url),
    markdown: payload.markdown,
    publishedTime: payload.publishedTime,
    retrievedAt: new Date().toISOString(),
  };
}
