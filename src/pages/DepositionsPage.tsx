import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ExternalLink,
  Link as LinkIcon,
  Pencil,
  PictureInPicture2,
  Plus,
  Shrink,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';
import { deleteVideo, getAllVideos, saveVideo } from '@/lib/storage';
import type { DepositionVideo } from '@/types';

const MAX_FILE_BYTES = 200 * 1024 * 1024; // ~200 MB per lodged recording
const NOTES_STORAGE_KEY = 'circuitus_depo_notes';

// ── Disguise metadata, derived deterministically from the record id ────
const SURNAMES: ReadonlyArray<string> = [
  'Whitfield',
  'Marchetti',
  'Castellan',
  'Holloway',
  'Ashworth',
  'Delgado',
  'Lindqvist',
  'Beaumont',
  'Okafor',
  'Pemberton',
];
const INITIALS = 'JMRAEDPCLT';

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

/** "Videotaped Deposition of J. Whitfield" — stable per record id. */
function deponentCaption(id: string): string {
  const h = hashSeed(id);
  const initial = INITIALS[h % INITIALS.length];
  const surname = SURNAMES[(h >>> 4) % SURNAMES.length];
  return `Videotaped Deposition of ${initial}. ${surname}`;
}

/** "No. 26-CV-04812" — stable per record id. */
function caseNumber(id: string): string {
  const h = hashSeed(id);
  return `No. 26-CV-${String(h % 100000).padStart(5, '0')}`;
}

const DESIGNATING_PARTIES = ['Plaintiff', 'Defendant', 'Joint', 'Intervenor'] as const;
const OBJECTIONS = ['—', 'Form', 'Foundation', 'Relevance', 'Hearsay; FRE 802'] as const;
const RULINGS = ['Reserved', 'Overruled', 'Sustained', 'Reserved'] as const;

interface DesignationRow {
  range: string;
  party: string;
  objection: string;
  ruling: string;
}

/** Decorative designation table — deterministic set dressing, nothing more. */
function fakeDesignations(id: string): DesignationRow[] {
  const rows: DesignationRow[] = [];
  let h = hashSeed(id);
  let page = 8 + (h % 20);
  for (let i = 0; i < 4; i++) {
    h = (h * 2654435761 + 1) >>> 0;
    const startLine = 1 + (h % 22);
    const span = 1 + ((h >>> 8) % 3);
    const endLine = 1 + ((h >>> 12) % 24);
    rows.push({
      range: `${page}:${String(startLine).padStart(2, '0')}–${page + span}:${String(endLine).padStart(2, '0')}`,
      party: DESIGNATING_PARTIES[(h >>> 5) % DESIGNATING_PARTIES.length],
      objection: OBJECTIONS[(h >>> 9) % OBJECTIONS.length],
      ruling: RULINGS[(h >>> 13) % RULINGS.length],
    });
    page += span + 2 + ((h >>> 16) % 9);
  }
  return rows;
}

// ── URL handling ───────────────────────────────────────────────────────
/**
 * Restrict media URLs to safe protocols. Returns null for anything else.
 * Mirrors AudioLibraryPage's safeMediaUrl (not exported there).
 */
function safeMediaUrl(input: string): string | null {
  try {
    const u = new URL(input);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'blob:') {
      return u.toString();
    }
    return null;
  } catch {
    return null;
  }
}

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extract the 11-character video id from the common YouTube URL shapes:
 * watch?v=, youtu.be/, /shorts/, /embed/, /live/. Defensive — anything
 * else returns null.
 */
function parseYouTubeId(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.split('/')[1] ?? '';
    return YT_ID_RE.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') {
      const id = u.searchParams.get('v') ?? '';
      return YT_ID_RE.test(id) ? id : null;
    }
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:[/?]|$)/);
    if (m) return m[1];
  }
  return null;
}

function loadNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

export default function DepositionsPage() {
  const [videos, setVideos] = useState<DepositionVideo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [compact, setCompact] = useState(false);
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>(() => loadNotes());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const pipSupported =
    typeof document !== 'undefined' &&
    'pictureInPictureEnabled' in document &&
    document.pictureInPictureEnabled;

  useEffect(() => {
    void getAllVideos().then((all) => {
      setVideos(all);
      setLoaded(true);
    });
  }, []);

  // Maintain object URLs for lodged on-device recordings.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL.createObjectURL is a real side-effect; the matching revoke is in cleanup
    setBlobUrls((prev) => {
      const next = { ...prev };
      let mutated = false;
      for (const v of videos) {
        if (v.kind === 'file' && v.blob && !next[v.id]) {
          next[v.id] = URL.createObjectURL(v.blob);
          mutated = true;
        }
      }
      // Revoke URLs for recordings stricken from the record.
      const ids = new Set(videos.map((v) => v.id));
      for (const id of Object.keys(next)) {
        if (!ids.has(id)) {
          URL.revokeObjectURL(next[id]);
          delete next[id];
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [videos]);

  // Revoke everything on unmount (the quick-ref cover unmounts this page —
  // playback stopping there is the desired behavior).
  useEffect(() => {
    const snapshot = blobUrls;
    return () => {
      for (const url of Object.values(snapshot)) URL.revokeObjectURL(url);
    };
    // We intentionally only want this to capture the latest map at unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = useMemo(() => videos.find((v) => v.id === activeId) ?? null, [videos, activeId]);

  const activeSrc = useMemo(() => {
    if (!active) return null;
    if (active.kind === 'youtube') {
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(active.ref)}`;
    }
    if (active.kind === 'url') return safeMediaUrl(active.ref);
    return blobUrls[active.id] ? safeMediaUrl(blobUrls[active.id]) : null;
  }, [active, blobUrls]);

  function persistNote(videoId: string, body: string) {
    setNotes((prev) => {
      const next = { ...prev, [videoId]: body };
      try {
        localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Quota exhausted — the errata sheet simply won't survive reload.
      }
      return next;
    });
  }

  function handleLodge() {
    const raw = window
      .prompt('Locator for the certified recording (YouTube link, or a direct http(s) media address):')
      ?.trim();
    if (!raw) return;

    const ytId = parseYouTubeId(raw);
    let kind: DepositionVideo['kind'];
    let ref: string;
    if (ytId) {
      kind = 'youtube';
      ref = ytId;
    } else {
      const safe = safeMediaUrl(raw);
      // Lodged locators must be resolvable after reload — blob: is not.
      if (!safe || safe.startsWith('blob:')) {
        window.alert(
          'The clerk is unable to accept this locator. Kindly tender a YouTube link or a direct http(s) address to the certified recording.',
        );
        return;
      }
      kind = 'url';
      ref = safe;
    }

    const title =
      window.prompt('Style of recording (for the index):', 'Certified deposition recording')?.trim() ||
      'Certified deposition recording';

    const video: DepositionVideo = {
      id: crypto.randomUUID(),
      title,
      kind,
      ref,
      addedAt: new Date().toISOString(),
    };
    void saveVideo(video).then(() => {
      setVideos((prev) => [video, ...prev]);
      setActiveId(video.id);
    });
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const additions: DepositionVideo[] = [];
    const oversize: string[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_BYTES) {
        oversize.push(file.name);
        continue;
      }
      const cleanTitle = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      const video: DepositionVideo = {
        id: crypto.randomUUID(),
        title: cleanTitle || 'Certified deposition recording',
        kind: 'file',
        ref: '',
        blob: file,
        mimeType: file.type || 'video/mp4',
        addedAt: new Date().toISOString(),
      };
      await saveVideo(video);
      additions.push(video);
    }
    if (additions.length > 0) {
      setVideos((prev) => [...additions, ...prev]);
      setActiveId(additions[additions.length - 1].id);
    }
    if (oversize.length > 0) {
      window.alert(
        `The following recordings exceed the 200 MB lodging limit and were not entered into the record: ${oversize.join(
          ', ',
        )}. Kindly tender a condensed copy through the court reporter.`,
      );
    }
  }

  function handleRename(id: string) {
    const current = videos.find((v) => v.id === id);
    if (!current) return;
    const title = window.prompt('Restyle recording as:', current.title)?.trim();
    if (!title || title === current.title) return;
    const next = { ...current, title };
    void saveVideo(next).then(() => {
      setVideos((prev) => prev.map((v) => (v.id === id ? next : v)));
    });
  }

  function handleDelete(id: string) {
    if (!window.confirm(`Strike "${deponentCaption(id)}" from the record?`)) return;
    void deleteVideo(id).then(() => {
      setVideos((prev) => prev.filter((v) => v.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setCompact(false);
      }
    });
  }

  function handleSelect(id: string) {
    if (id !== activeId) setActiveId(id);
  }

  async function handleNativePiP() {
    const v = videoRef.current;
    if (!v || !pipSupported) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch {
      // The browser declined chambers review — leave playback where it is.
    }
  }

  const activeCaption = active ? deponentCaption(active.id) : null;
  const activeCase = active ? caseNumber(active.id) : null;
  const designations = useMemo(() => (active ? fakeDesignations(active.id) : []), [active]);

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-hidden">
      {/* Masthead */}
      <div className="border-b border-border bg-white px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="text-center mx-auto">
          <p className="text-[10px] font-serif uppercase tracking-[0.2em] text-navy/60">
            CIRCUITUS DEPOSITION REVIEW
          </p>
          <h1 className="font-serif text-lg font-bold text-navy">
            Certified Recording — Videotaped Testimony
          </h1>
          <p className="text-[10px] font-mono text-text-muted">
            {videos.length} recording{videos.length === 1 ? '' : 's'} lodged with the clerk
          </p>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Deposition Index (left rail) */}
        <div className="w-64 bg-sidebar-bg border-r border-border flex flex-col flex-shrink-0">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-[10px] font-sans font-semibold uppercase tracking-[0.15em] text-text-muted">
              Deposition Index
            </h3>
          </div>
          <div className="px-2 py-2 border-b border-border flex gap-1.5">
            <button
              onClick={handleLodge}
              className="flex-1 flex items-center justify-center gap-1.5 bg-navy text-white text-[11px] font-sans font-medium px-3 py-1.5 rounded hover:bg-navy-light transition-colors"
            >
              <Plus className="w-3 h-3" />
              Lodge Recording
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-1.5 text-[11px] font-sans font-medium px-2.5 py-1.5 rounded text-navy hover:bg-black/[0.04] transition-colors"
              title="Import a recording from device into the record"
            >
              <Upload className="w-3 h-3" />
              Import
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="flex-1 overflow-y-auto py-1">
            {videos.length === 0 ? (
              <p className="px-4 py-6 text-xs text-text-muted font-sans text-center leading-relaxed">
                No recordings lodged. Click <em>Lodge Recording</em> to begin.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {videos.map((v) => (
                  <li key={v.id} className="group flex items-center">
                    <button
                      onClick={() => handleSelect(v.id)}
                      className={`flex-1 min-w-0 text-left px-4 py-2 text-xs font-sans transition-colors border-l-2 ${
                        activeId === v.id
                          ? 'border-gold bg-gold/5 text-navy font-medium'
                          : 'border-transparent text-text-muted hover:text-text-main hover:bg-black/[0.02]'
                      }`}
                    >
                      <p className="font-serif italic leading-snug">{deponentCaption(v.id)}</p>
                      <p className="text-[10px] font-mono text-text-muted/80 mt-0.5">
                        {caseNumber(v.id)}
                      </p>
                      <p className="text-[9px] font-mono text-text-muted/60 mt-0.5">
                        Lodged {new Date(v.addedAt).toLocaleDateString()}
                      </p>
                    </button>
                    <button
                      onClick={() => handleRename(v.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-navy"
                      title="Restyle (rename) recording"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleDelete(v.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 mr-1 text-text-muted hover:text-red-600"
                      title="Strike recording from the record"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Review column */}
        <div className="flex-1 flex flex-col bg-white overflow-hidden">
          {active ? (
            <>
              {/* Review toolbar */}
              <div
                className="px-6 py-2 flex items-center justify-between flex-shrink-0 gap-3"
                style={{ borderBottom: '1px solid #D9D2C0' }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Video className="w-3.5 h-3.5 text-gold flex-shrink-0" />
                  <span className="font-serif italic text-navy text-sm truncate">
                    {activeCaption}
                  </span>
                  <span className="font-mono text-[11px] text-text-muted flex-shrink-0">
                    {activeCase}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {active.kind === 'youtube' && (
                    <a
                      href={`https://www.youtube.com/watch?v=${encodeURIComponent(active.ref)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-sans uppercase tracking-wider text-text-muted hover:text-navy"
                      title="If the certified copy declines to render here, consult the custodian's original"
                    >
                      <ExternalLink className="w-3 h-3" /> Custodian&rsquo;s Original
                    </a>
                  )}
                  {active.kind !== 'youtube' && pipSupported && (
                    <button
                      onClick={() => void handleNativePiP()}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-sans uppercase tracking-wider text-text-muted hover:text-navy"
                      title="Continue playback in a chambers window (picture-in-picture)"
                    >
                      <Shrink className="w-3 h-3" /> Chambers Window
                    </button>
                  )}
                  <button
                    onClick={() => setCompact((p) => !p)}
                    className={`flex items-center gap-1 px-2 py-1 text-[10px] font-sans uppercase tracking-wider rounded ${
                      compact ? 'bg-navy text-white' : 'text-text-muted hover:text-navy'
                    }`}
                    title="Toggle Compact Review — dock playback and open the errata sheet"
                  >
                    <PictureInPicture2 className="w-3 h-3" /> Compact Review
                  </button>
                </div>
              </div>

              {/* Transcript cover caption — compact, ~3 lines */}
              <div className="px-8 pt-4 pb-3 flex-shrink-0">
                <div className="max-w-3xl mx-auto text-center">
                  <p className="kicker">Superior Court of the State of California</p>
                  <div className="rule-double my-1.5" />
                  <p className="font-serif text-[13px] text-text-main smcp">
                    {activeCaption} · {activeCase} ·{' '}
                    <span className="text-claret">Videotaped Deposition — Confidential</span>
                  </p>
                </div>
              </div>

              {/* Errata & Designations pane — shown while playback is docked.
                  Rendered before the player so the player's slot in the child
                  list is stable and the iframe/video never remounts. */}
              {compact && (
                <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-6">
                  <div className="max-w-3xl mx-auto">
                    <p className="kicker mb-2">Errata &amp; Designations</p>
                    <textarea
                      value={notes[active.id] ?? ''}
                      onChange={(e) => persistNote(active.id, e.target.value)}
                      placeholder="Note errata, counter-designations, and objections for the record…"
                      className="w-full h-40 bg-white font-serif text-[14px] leading-relaxed text-text-main p-4 resize-y focus:outline-none"
                      style={{ border: '1px solid #D9D2C0', borderRadius: 0 }}
                    />
                    <div className="mt-5">
                      <p className="kicker mb-1.5">Designations of Record</p>
                      <table className="w-full text-left" style={{ border: '1px solid #D9D2C0' }}>
                        <thead>
                          <tr className="bg-cream">
                            {['Page:Line', 'Designating Party', 'Objection', 'Ruling'].map((h) => (
                              <th
                                key={h}
                                className="px-3 py-1.5 text-[10px] font-sans font-semibold uppercase tracking-[0.12em] text-text-muted"
                                style={{ borderBottom: '1px solid #D9D2C0' }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {designations.map((row) => (
                            <tr key={row.range}>
                              <td
                                className="px-3 py-1.5 font-mono text-[11px] text-text-main"
                                style={{ borderBottom: '1px solid #D9D2C0' }}
                              >
                                {row.range}
                              </td>
                              <td
                                className="px-3 py-1.5 font-serif text-[12px] text-text-main"
                                style={{ borderBottom: '1px solid #D9D2C0' }}
                              >
                                {row.party}
                              </td>
                              <td
                                className="px-3 py-1.5 font-serif italic text-[12px] text-text-muted"
                                style={{ borderBottom: '1px solid #D9D2C0' }}
                              >
                                {row.objection}
                              </td>
                              <td
                                className="px-3 py-1.5 font-serif text-[12px] text-text-muted"
                                style={{ borderBottom: '1px solid #D9D2C0' }}
                              >
                                {row.ruling}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-1.5 text-[9px] font-mono text-text-muted/60">
                        Rulings reserved pending meet-and-confer. Playback continues in the docked
                        panel.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Player container — one stable element moved between the main
                  stage and the docked corner purely via className, so the
                  iframe/video keeps playing across the Compact Review toggle. */}
              <div
                className={
                  compact
                    ? 'fixed bottom-9 right-4 z-40 w-[380px] bg-white shadow-xl'
                    : 'flex-1 min-h-0 px-8 pb-6 flex justify-center'
                }
                style={compact ? { border: '1px solid #D9D2C0' } : undefined}
              >
                <div
                  className={
                    compact
                      ? 'px-2.5 py-1 flex items-center justify-between'
                      : 'hidden'
                  }
                  style={compact ? { borderBottom: '1px solid #D9D2C0' } : undefined}
                >
                  <span className="text-[9px] font-sans font-semibold uppercase tracking-[0.15em] text-text-muted truncate">
                    Playback continues — sealed
                  </span>
                  <button
                    onClick={() => setCompact(false)}
                    className="text-[9px] font-sans uppercase tracking-wider text-navy hover:text-gold ml-2 flex-shrink-0"
                    title="Return playback to the full stage"
                  >
                    Restore
                  </button>
                </div>
                <div
                  className={compact ? 'w-full aspect-video bg-black' : 'w-full max-w-3xl self-start'}
                >
                  <div
                    className="w-full aspect-video bg-black"
                    style={compact ? undefined : { border: '1px solid #D9D2C0' }}
                  >
                    {active.kind === 'youtube' ? (
                      <iframe
                        key={active.id}
                        src={activeSrc ?? undefined}
                        className="w-full h-full"
                        title={`Certified videotaped testimony — ${activeCaption ?? 'sealed recording'}`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        referrerPolicy="no-referrer"
                        style={{ border: 0 }}
                      />
                    ) : activeSrc ? (
                      <video
                        key={active.id}
                        ref={videoRef}
                        src={activeSrc}
                        controls
                        className="w-full h-full"
                        preload="metadata"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="editorial-loader" aria-hidden />
                      </div>
                    )}
                  </div>
                  {!compact && active.kind === 'youtube' && (
                    <p className="mt-1.5 text-[9px] font-mono text-text-muted/60">
                      Some custodians decline to release the certified copy for chambers playback.
                      Should the frame remain dark, consult the custodian&rsquo;s original above.
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : (
            loaded && (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="max-w-sm text-center">
                  <p className="text-[10px] font-serif uppercase tracking-[0.2em] text-navy/60 mb-2">
                    THE RECORD IS EMPTY
                  </p>
                  <p className="text-sm font-sans text-text-muted leading-relaxed mb-5">
                    {videos.length === 0
                      ? 'No videotaped testimony has been lodged in this matter. Lodge a recording by locator, or import a certified copy from device.'
                      : 'Select a recording from the Deposition Index to begin review.'}
                  </p>
                  {videos.length === 0 && (
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={handleLodge}
                        className="flex items-center gap-1.5 bg-navy text-white text-[11px] font-sans font-medium px-3 py-1.5 rounded hover:bg-navy-light transition-colors"
                      >
                        <LinkIcon className="w-3 h-3" />
                        Lodge Recording
                      </button>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 border border-navy text-navy text-[11px] font-sans font-medium px-3 py-1.5 rounded hover:bg-navy hover:text-white transition-colors"
                      >
                        <Upload className="w-3 h-3" />
                        Import from Device
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
