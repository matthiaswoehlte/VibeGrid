'use client';
import { useState } from 'react';
import { useAppStore } from '@/lib/store';

export function BPMBadge() {
  const bpm = useAppStore((s) => s.audio.grid.bpm);
  const setBPM = useAppStore((s) => s.audioActions.setBPM);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(bpm));

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min={40}
        max={240}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (Number.isFinite(n) && n >= 40 && n <= 240) setBPM(n);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(String(bpm));
            setEditing(false);
          }
        }}
        className="w-16 h-7 px-1 bg-[var(--surface-2)] border border-[var(--border)] rounded text-sm"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(String(bpm));
        setEditing(true);
      }}
      className="h-7 px-2 rounded bg-[var(--surface-2)] border border-[var(--border)] text-xs font-mono"
      aria-label="Edit BPM"
    >
      {bpm.toFixed(0)} BPM
    </button>
  );
}
