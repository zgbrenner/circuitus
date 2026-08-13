import { useMemo, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { defineCircuitusTheme, ensureMonacoSetup } from '@/lib/monaco';
import type { Draft } from '@/types';

// Bundle Monaco locally (no CDN) and register the circuitus-light theme
// before any editor mounts.
ensureMonacoSetup();

interface DraftCompareProps {
  drafts: ReadonlyArray<Draft>;
  defaultLeftId?: string | null;
}

function htmlToPlainText(html: string): string {
  // Server-side render also goes through this; in the browser a DOMParser is fine.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Replace block-level elements with line breaks for readability in the diff.
  doc.querySelectorAll('p,h1,h2,h3,li,blockquote,br').forEach((el) => {
    el.appendChild(doc.createTextNode('\n'));
  });
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export default function DraftCompare({ drafts, defaultLeftId }: DraftCompareProps) {
  const [leftId, setLeftId] = useState<string>(defaultLeftId ?? drafts[0]?.id ?? '');
  const [rightId, setRightId] = useState<string>(drafts[1]?.id ?? drafts[0]?.id ?? '');

  const left = useMemo(() => drafts.find((d) => d.id === leftId), [drafts, leftId]);
  const right = useMemo(() => drafts.find((d) => d.id === rightId), [drafts, rightId]);

  if (drafts.length < 2) {
    return (
      <div className="flex-1 flex items-center justify-center bg-cream">
        <p className="text-sm font-sans text-text-muted max-w-sm text-center leading-relaxed">
          You need at least two drafts to compare. Create a second draft from the editor view.
        </p>
      </div>
    );
  }

  const originalText = left ? htmlToPlainText(left.body) : '';
  const modifiedText = right ? htmlToPlainText(right.body) : '';

  return (
    <div className="flex-1 flex flex-col bg-white">
      <div
        className="px-6 py-3 flex items-center gap-4 flex-shrink-0 bg-paper-cool"
        style={{ borderBottom: '1px solid #D9D2C0' }}
      >
        <div className="flex-1 min-w-0">
          <p className="kicker mb-1.5">Original</p>
          <select
            value={leftId}
            onChange={(e) => setLeftId(e.target.value)}
            className="w-full font-serif text-[14px] italic text-ink bg-paper-cool px-3 py-1.5 focus:outline-none focus:border-brass appearance-none cursor-pointer"
            style={{
              border: '1px solid #D9D2C0',
              borderRadius: 0,
              backgroundImage:
                "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%239C7A1F' stroke-width='1.2' fill='none'/></svg>\")",
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
              paddingRight: 28,
            }}
          >
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title || 'Untitled'} — {new Date(d.updatedAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>
        <span className="font-display italic text-ink-muted text-base">vs.</span>
        <div className="flex-1 min-w-0">
          <p className="kicker mb-1.5">Revised</p>
          <select
            value={rightId}
            onChange={(e) => setRightId(e.target.value)}
            className="w-full font-serif text-[14px] italic text-ink bg-paper-cool px-3 py-1.5 focus:outline-none focus:border-brass appearance-none cursor-pointer"
            style={{
              border: '1px solid #D9D2C0',
              borderRadius: 0,
              backgroundImage:
                "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%239C7A1F' stroke-width='1.2' fill='none'/></svg>\")",
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
              paddingRight: 28,
            }}
          >
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title || 'Untitled'} — {new Date(d.updatedAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <DiffEditor
          height="100%"
          original={originalText}
          modified={modifiedText}
          language="markdown"
          theme="circuitus-light"
          beforeMount={defineCircuitusTheme}
          options={{
            readOnly: true,
            renderSideBySide: true,
            wordWrap: 'on',
            fontFamily: '"Source Serif 4", Georgia, serif',
            fontSize: 13,
            lineNumbers: 'on',
            minimap: { enabled: false },
            renderOverviewRuler: false,
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  );
}
