import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
  quickRefChord: string;
}

interface Row {
  keys: string[];
  label: string;
}

interface Group {
  title: string;
  rows: Row[];
}

export default function ShortcutsOverlay({ open, onClose, quickRefChord }: ShortcutsOverlayProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(open, dialogRef);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const groups: Group[] = [
    {
      title: 'Cover & Privacy',
      rows: [
        { keys: [quickRefChord], label: 'Toggle Quick Reference Mode' },
        ...(typeof window !== 'undefined' && window.circuitusDesktop
          ? [{ keys: ['Ctrl', 'Shift', 'H'], label: 'Vanish window (system-wide)' }]
          : []),
        { keys: ['?'], label: 'Open this keybinding sheet' },
      ],
    },
    {
      title: 'Reading',
      rows: [
        { keys: ['←'], label: 'Previous chapter' },
        { keys: ['→'], label: 'Next chapter' },
        { keys: ['Esc'], label: 'Dismiss search results / close overlays' },
      ],
    },
    {
      title: 'Document',
      rows: [
        { keys: ['Ctrl', 'P'], label: 'Print preview' },
        { keys: ['Enter'], label: 'Submit search query' },
      ],
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/85 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-overlay-title"
        className="bg-paper max-w-[560px] w-full max-h-[80vh] overflow-y-auto"
        style={{
          border: '1px solid #9C7A1F',
          boxShadow:
            'inset 0 0 0 1px rgba(184, 147, 43, 0.15), 0 24px 64px -16px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-3 bg-paper-cool"
          style={{ borderBottom: '1px solid #D9D2C0' }}
        >
          <div>
            <p className="kicker-brass">Reference</p>
            <p id="shortcuts-overlay-title" className="font-display text-[18px] text-ink leading-none mt-1">
              Keyboard Shortcuts
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-claret transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="rule-double" aria-hidden />

        {/* Groups */}
        <div className="px-6 py-5 space-y-6">
          {groups.map((g) => (
            <section key={g.title}>
              <p className="kicker text-brass-dim mb-3">{g.title}</p>
              <ul className="space-y-1.5">
                {g.rows.map((r) => (
                  <li
                    key={r.label}
                    className="flex items-baseline justify-between gap-4 py-1"
                    style={{ borderBottom: '1px dashed #E9E3D2' }}
                  >
                    <span className="font-serif text-[13px] italic text-ink-soft">{r.label}</span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      {r.keys.map((k, i) => (
                        <span
                          key={i}
                          className="font-mono text-[10.5px] text-ink bg-paper-cool px-2 py-0.5 tracking-wider"
                          style={{
                            border: '1px solid #D9D2C0',
                            boxShadow: '0 1px 0 #D9D2C0',
                          }}
                        >
                          {k}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-3 bg-paper-cool"
          style={{ borderTop: '1px solid #D9D2C0' }}
        >
          <p className="font-mono text-[10px] text-ink-muted/70 tracking-wider">
            <span className="text-brass">§</span> Press <span className="text-ink">?</span> at any
            time to recall this sheet · <span className="text-ink">Esc</span> to dismiss
          </p>
        </div>
      </div>
    </div>
  );
}
