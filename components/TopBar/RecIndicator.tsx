'use client';
import { useAppStore } from '@/lib/store';

function formatMMSS(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function RecIndicator({ onCancel }: { onCancel: () => void }) {
  const status = useAppStore((s) => s.ui.exportState.status);
  const elapsed = useAppStore((s) => s.ui.exportState.elapsedSeconds);
  const total = useAppStore((s) => s.ui.exportState.totalSeconds);

  if (status !== 'recording') return null;

  return (
    <div className="flex items-center gap-2 px-2">
      <span
        aria-label="Recording"
        className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse"
      />
      <span className="font-mono text-xs text-[var(--text)]">
        REC {formatMMSS(elapsed)} / {formatMMSS(total)}
      </span>
      <button
        type="button"
        aria-label="Cancel export"
        onClick={onCancel}
        className="h-6 w-6 rounded text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-3)]"
        title="Cancel export"
      >
        ✕
      </button>
    </div>
  );
}
