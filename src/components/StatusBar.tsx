import { useEffect, useState } from 'react';

interface StatusBarProps {
  isQuickRef?: boolean;
  shortcutHint?: string;
  autoPilotEnabled?: boolean;
}

function useSyncMinutes(): number {
  const [minutes, setMinutes] = useState(() => Math.floor(Math.random() * 4) + 1);

  useEffect(() => {
    const interval = setInterval(() => {
      setMinutes((prev) => {
        const snapChance = Math.min(0.04 + prev * 0.012, 0.4);
        if (Math.random() < snapChance) return Math.floor(Math.random() * 3);
        return prev + 1;
      });
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  return minutes;
}

export default function StatusBar({
  isQuickRef = false,
  shortcutHint,
  autoPilotEnabled = false,
}: StatusBarProps) {
  const minutes = useSyncMinutes();

  return (
    <div
      className="bg-paper-cool flex items-center justify-between px-5 h-[26px] flex-shrink-0"
      style={{ borderTop: '1px solid #D9D2C0' }}
    >
      {/* Left — connection state */}
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`inline-block ${isQuickRef ? 'text-navy' : 'text-brass-dim'}`}
          style={{ fontSize: 9, lineHeight: 1 }}
        >
          ◆
        </span>
        <span className="font-sans text-[10px] tracking-marque uppercase text-ink-muted">
          {isQuickRef ? (
            <>
              Quick Reference
              {shortcutHint && (
                <span className="text-ink-muted/60 normal-case tracking-normal ml-2">
                  · {shortcutHint} to exit
                </span>
              )}
            </>
          ) : (
            'Connected · Circuitus Library'
          )}
        </span>
      </div>

      {/* Center — sync */}
      <div className="flex items-center gap-3">
        {autoPilotEnabled && (
          <span className="font-mono text-[10px] text-brass-dim flex items-center gap-1">
            <span className="inline-block w-1 h-1 bg-brass rounded-full animate-pulse" aria-hidden />
            Auto-pilot active
          </span>
        )}
        <span className="font-mono text-[10px] text-ink-muted/80">
          {minutes === 0 ? 'Synced just now' : `Last synced ${minutes} min ago`}
        </span>
      </div>

      {/* Right — shortcut + version */}
      <div className="flex items-center gap-4">
        {shortcutHint && (
          <span className="font-mono text-[10px] text-ink-muted/70">
            <span className="text-brass-dim">⌨</span>{' '}
            {shortcutHint}
            <span className="text-ink-muted/40 ml-1">— Quick Reference</span>
          </span>
        )}
        <span className="font-mono text-[10px] text-ink-muted/40">v.2.8.0</span>
      </div>
    </div>
  );
}
