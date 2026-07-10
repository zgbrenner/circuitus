import { useEffect, useRef, useState, useCallback } from 'react';
import { FileText, Bookmark, Highlighter } from 'lucide-react';
import type { DocumentChapter } from '@/types';
import { extractCitations } from '@/lib/citations';

interface ContentAreaProps {
  /** Render chapters sequentially (uploaded docs) */
  chapters?: DocumentChapter[];
  /** Render raw HTML blob (standin docs) */
  rawContent?: string;
  refNumber?: string;
  documentTitle?: string;
  isEmpty?: boolean;
  fontSize?: number;
  showParagraphNumbers?: boolean;
  activeChapterIndex?: number;
  onActiveChapterChange?: (index: number) => void;
  onHighlight?: (payload: {
    text: string;
    color: 'yellow' | 'blue' | 'green';
    startOffset: number;
    endOffset: number;
  }) => void;
  onBookmark?: (text: string) => void;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  initialScrollPercent?: number;
  children?: React.ReactNode;
}

const CHAPTER_OBSERVER_ROOT_MARGIN = '-10% 0px -80% 0px';

const HIGHLIGHT_COLORS: { color: 'yellow' | 'blue' | 'green'; bg: string; label: string }[] = [
  { color: 'yellow', bg: 'bg-yellow-300', label: 'Yellow' },
  { color: 'blue', bg: 'bg-blue-300', label: 'Blue' },
  { color: 'green', bg: 'bg-green-300', label: 'Green' },
];

export default function ContentArea({
  chapters,
  rawContent,
  refNumber,
  documentTitle,
  isEmpty = true,
  fontSize = 14.5,
  showParagraphNumbers = false,
  activeChapterIndex = 0,
  onActiveChapterChange,
  onHighlight,
  onBookmark,
  scrollContainerRef,
  initialScrollPercent,
  children,
}: ContentAreaProps) {
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const effectiveScrollRef = scrollContainerRef ?? internalScrollRef;
  const contentRef = useRef<HTMLDivElement>(null);
  const hasRestoredRef = useRef(false);

  // Stable fallback ref number (generated once per mount).
  // Math.random is impure, so we compute it inside a useState initializer
  // rather than useMemo to satisfy the react-hooks/purity rule.
  const [fallbackRefNumber] = useState(
    () => `CIR-2026-${String(Math.floor(Math.random() * 90000) + 10000)}`,
  );

  // Selection toolbar state
  const [selectionToolbar, setSelectionToolbar] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  // --- IntersectionObserver for active chapter tracking ---
  useEffect(() => {
    if (!chapters?.length || !onActiveChapterChange) return;

    const container = effectiveScrollRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number(entry.target.getAttribute('data-chapter-index'));
            if (!isNaN(idx)) {
              onActiveChapterChange(idx);
            }
          }
        }
      },
      {
        root: container,
        rootMargin: CHAPTER_OBSERVER_ROOT_MARGIN,
        threshold: 0,
      },
    );

    const headings = container.querySelectorAll('[data-chapter-index]');
    headings.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [chapters, onActiveChapterChange, effectiveScrollRef]);

  // --- Restore scroll position on mount ---
  useEffect(() => {
    if (hasRestoredRef.current || !initialScrollPercent || initialScrollPercent <= 0) return;
    const el = effectiveScrollRef.current;
    if (!el) return;

    // Wait a tick for content to render
    requestAnimationFrame(() => {
      const scrollTarget = (el.scrollHeight - el.clientHeight) * (initialScrollPercent / 100);
      el.scrollTop = scrollTarget;
      hasRestoredRef.current = true;
    });
  }, [initialScrollPercent, effectiveScrollRef]);

  // Reset restore flag when document changes
  useEffect(() => {
    hasRestoredRef.current = false;
  }, [documentTitle]);

  // --- Exhibit captions for images ---
  useEffect(() => {
    if (!contentRef.current) return;
    const images = contentRef.current.querySelectorAll('img:not([data-exhibit-processed])');
    let exhibitCount = contentRef.current.querySelectorAll('.exhibit-caption').length;

    images.forEach((img) => {
      img.setAttribute('data-exhibit-processed', 'true');
      exhibitCount++;
      const caption = document.createElement('figcaption');
      caption.className = 'exhibit-caption';
      caption.textContent = `Exhibit ${exhibitCount}`;

      const figure = document.createElement('figure');
      figure.className = 'exhibit-figure';
      img.parentNode?.insertBefore(figure, img);
      figure.appendChild(img);
      figure.appendChild(caption);
    });
  }, [chapters, rawContent]);

  // --- Inject chapter anchor ids into raw HTML so left-rail TOC navigation works ---
  // Uploaded docs already get ids via the chapter-loop render below; standin docs
  // are rendered as a single rawContent blob and need ids attached after render.
  useEffect(() => {
    if (!contentRef.current || !rawContent) return;
    const headings = contentRef.current.querySelectorAll<HTMLElement>('h2, h3');
    headings.forEach((h, i) => {
      h.id = `chapter-${i}`;
      h.setAttribute('data-chapter-index', String(i));
    });
  }, [rawContent]);

  // --- Text selection toolbar ---
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      // Delay hiding to allow toolbar clicks
      setTimeout(() => setSelectionToolbar(null), 200);
      return;
    }

    const text = selection.toString().trim();
    if (text.length < 2) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = effectiveScrollRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    setSelectionToolbar({
      x: rect.left + rect.width / 2 - containerRect.left,
      y: rect.top - containerRect.top - 8,
      text,
    });
    // Refs are stable so they don't belong in the dep array; the React
    // compiler complains about reading .current with the ref listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Left/Right arrow key chapter navigation ---
  // Bound to the scroll container instead of the window so keys typed while
  // a different page is mounted (games, editor, spreadsheet) don't trigger
  // chapter jumps against a stale chapters array.
  useEffect(() => {
    const container = effectiveScrollRef.current;
    if (!container || !chapters?.length || !onActiveChapterChange) return;

    // Make the container focusable so it can receive key events.
    if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) return;

      // Only handle the keys when focus is inside the reading pane or on
      // body (the typical idle case).
      if (
        target !== document.body &&
        target !== container &&
        !container.contains(target)
      ) return;

      if (e.key === 'ArrowLeft') {
        const prev = Math.max(0, activeChapterIndex - 1);
        onActiveChapterChange(prev);
        const el = document.getElementById(`chapter-${prev}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (e.key === 'ArrowRight') {
        const next = Math.min(chapters.length - 1, activeChapterIndex + 1);
        onActiveChapterChange(next);
        const el = document.getElementById(`chapter-${next}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chapters, activeChapterIndex, onActiveChapterChange, effectiveScrollRef]);

  const handleHighlight = (color: 'yellow' | 'blue' | 'green') => {
    if (!selectionToolbar) return;

    const selection = window.getSelection();
    let startOffset = 0;
    let endOffset = selectionToolbar.text.length;

    if (selection && !selection.isCollapsed) {
      try {
        const range = selection.getRangeAt(0);
        // Anchor offsets to the enclosing chapter container so they remain
        // meaningful across re-renders.
        const container =
          (range.startContainer.parentElement?.closest('[data-chapter-index]') as HTMLElement | null) ??
          contentRef.current;
        if (container) {
          const pre = range.cloneRange();
          pre.selectNodeContents(container);
          pre.setEnd(range.startContainer, range.startOffset);
          startOffset = pre.toString().length;
          endOffset = startOffset + selectionToolbar.text.length;
        }

        const mark = document.createElement('mark');
        mark.className = `highlight-${color}`;
        range.surroundContents(mark);
      } catch {
        // If range spans multiple elements, just save without visual
      }
      selection.removeAllRanges();
    }

    onHighlight?.({ text: selectionToolbar.text, color, startOffset, endOffset });
    setSelectionToolbar(null);
  };

  const handleBookmark = () => {
    if (!selectionToolbar) return;
    onBookmark?.(selectionToolbar.text);
    window.getSelection()?.removeAllRanges();
    setSelectionToolbar(null);
  };

  const citations = extractCitations(
    chapters?.map((ch) => `${ch.title} ${ch.content}`).join(' ') ?? rawContent ?? '',
    10,
  );
  const hasContent = !isEmpty && (chapters?.length || rawContent || children);

  return (
    <div
      ref={effectiveScrollRef}
      className="flex-1 overflow-y-auto bg-paper relative min-w-[600px]"
      onMouseUp={handleMouseUp}
    >
      <div
        className="max-w-reading-pane mx-auto bg-paper-cool min-h-full px-14 py-14 relative"
        style={{
          borderLeft: '1px solid #D9D2C0',
          borderRight: '1px solid #D9D2C0',
          boxShadow: '0 0 0 1px rgba(14,17,22,0.02), 0 8px 32px -24px rgba(14,17,22,0.18)',
        }}
      >
        {/* Editorial document header */}
        <header className="text-center mb-10">
          <p className="kicker-brass mb-3">
            <span className="inline-block w-6 h-px bg-brass align-middle mr-3" />
            Circuitus Practice Resource
            <span className="inline-block w-6 h-px bg-brass align-middle ml-3" />
          </p>

          {documentTitle ? (
            <h1 className="font-display text-[26px] font-semibold text-ink leading-[1.15] mt-2 mb-3 tracking-tight px-4">
              {documentTitle}
            </h1>
          ) : (
            <p className="font-serif italic text-ink-muted text-sm mb-3">
              In-House Counsel Reference Library — Transactional Division
            </p>
          )}

          <div className="flex items-center justify-center gap-3 mt-4">
            <span className="h-px w-16 bg-rule" aria-hidden />
            <p className="font-mono text-[10px] text-ink-muted tracking-marque">
              Ref. {refNumber || fallbackRefNumber}
            </p>
            <span className="h-px w-16 bg-rule" aria-hidden />
          </div>

          <div className="asterism mt-7 mb-0" aria-hidden />
        </header>

        {/* Content */}

        {citations.length > 0 && (
          <nav
            aria-label="Extracted citations"
            className="mb-8 bg-paper border border-rule px-4 py-3"
          >
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <p className="kicker text-brass-dim">Citation Signal Map</p>
              <p className="font-mono text-[9px] text-ink-muted">
                {citations.length} detected reference{citations.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {citations.map((citation) => (
                <span
                  key={citation.id}
                  className="inline-flex items-center gap-2 border border-rule bg-paper-cool px-2 py-1 font-mono text-[10px] text-ink-soft"
                  title={`${citation.type} citation`}
                >
                  <span className="uppercase text-brass-dim">{citation.type}</span>
                  <span>{citation.text}</span>
                  {citation.count > 1 && <span className="text-ink-muted">×{citation.count}</span>}
                </span>
              ))}
            </div>
          </nav>
        )}

        {!hasContent ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileText className="w-10 h-10 text-rule-strong mb-5" />
            <p className="font-serif italic text-ink-muted max-w-sm leading-relaxed text-[14px]">
              No source documents loaded. Import a document or select a Saved Authority to begin.
            </p>
          </div>
        ) : (
          <div ref={contentRef}>
            {/* Pass-through children (e.g. back button) */}
            {children}

            {/* Chapters rendered sequentially */}
            {chapters?.map((ch, i) => (
              <section key={ch.id} id={`chapter-${i}`} data-chapter-index={i} className="mb-12">
                <div className="mb-5">
                  <p className="kicker text-brass-dim mb-1.5">
                    Section {String.fromCharCode(8544 + i)}
                  </p>
                  <h2
                    className="font-display text-ink font-semibold text-[20px] leading-tight pb-3"
                    style={{ borderBottom: '1px solid #D9D2C0' }}
                  >
                    {ch.title}
                  </h2>
                </div>
                <div
                  className={`prose-legal ${showParagraphNumbers ? 'numbered' : ''}`}
                  style={{ fontSize: `${fontSize}px`, lineHeight: '1.78' }}
                  dangerouslySetInnerHTML={{ __html: ch.content }}
                />
              </section>
            ))}

            {/* Raw HTML content (standin documents) */}
            {rawContent && !chapters?.length && (
              <div
                className={`prose-legal ${showParagraphNumbers ? 'numbered' : ''}`}
                style={{ fontSize: `${fontSize}px`, lineHeight: '1.85' }}
                dangerouslySetInnerHTML={{ __html: rawContent }}
              />
            )}
          </div>
        )}
      </div>

      {/* Selection floating toolbar */}
      {selectionToolbar && (
        <div
          role="toolbar"
          aria-label="Text annotation"
          className="absolute z-50 flex items-center gap-1 bg-navy px-2.5 py-2 -translate-x-1/2"
          style={{
            left: selectionToolbar.x,
            top: selectionToolbar.y,
            transform: 'translate(-50%, -100%)',
            borderRadius: 0,
            border: '1px solid rgba(184, 147, 43, 0.4)',
            boxShadow:
              'inset 0 0 0 1px rgba(184, 147, 43, 0.15), 0 8px 24px -8px rgba(14,17,22,0.45)',
          }}
        >
          {/* Highlight buttons */}
          <div className="flex items-center gap-1 mr-1">
            <Highlighter className="w-3 h-3 text-brass-bright mr-1" />
            {HIGHLIGHT_COLORS.map((h) => (
              <button
                key={h.color}
                onClick={() => handleHighlight(h.color)}
                className={`w-4 h-4 ${h.bg} hover:ring-2 hover:ring-brass-bright/60 transition-all`}
                style={{ borderRadius: 0 }}
                title={`Highlight ${h.label}`}
              />
            ))}
          </div>

          <div className="w-px h-4 bg-paper/20 mx-1" />

          {/* Bookmark button */}
          <button
            onClick={handleBookmark}
            className="flex items-center gap-1 text-paper/80 hover:text-brass-bright font-sans uppercase tracking-marque text-[9px] px-1.5 py-0.5 transition-colors"
          >
            <Bookmark className="w-3 h-3" /> Mark
          </button>
        </div>
      )}
    </div>
  );
}
