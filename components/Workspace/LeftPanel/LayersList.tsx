'use client';
import { useAppStore } from '@/lib/store';
import { Toggle } from '@/components/ui/Toggle';

export function LayersList() {
  const tracks = useAppStore((s) => s.timeline.tracks);
  const setMuted = useAppStore((s) => s.timelineActions.setMuted);
  return (
    <ul className="space-y-1">
      {tracks.length === 0 && (
        <li className="text-xs text-[var(--text-dim)] px-2 py-1.5">No tracks yet.</li>
      )}
      {tracks.map((t) => (
        <li
          key={t.id}
          className="flex items-center justify-between px-2 py-1.5 rounded bg-[var(--surface-2)] text-sm"
        >
          <span>{t.name}</span>
          <Toggle checked={!t.muted} onChange={(v) => setMuted(t.id, !v)} label="On" />
        </li>
      ))}
    </ul>
  );
}
