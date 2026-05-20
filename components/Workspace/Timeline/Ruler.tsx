'use client';
import { useAppStore } from '@/lib/store';
import { TRACK_LABEL_WIDTH } from './Tracks';

const BEAT_PX_BASE = 40;

export function Ruler({ totalBeats }: { totalBeats: number }) {
  const zoom = useAppStore((s) => s.ui.zoom);
  const px = BEAT_PX_BASE * zoom;
  const ticks = Array.from({ length: totalBeats + 1 }, (_, i) => i);
  return (
    <div
      className="h-6 flex border-b border-[var(--border)] bg-[var(--surface-1)] sticky top-0 z-30"
      style={{ width: TRACK_LABEL_WIDTH + totalBeats * px }}
    >
      {/* Sticky label-column spacer keeps the ruler's beat-0 aligned with the
          clip-areas in every track row when horizontal scroll happens. */}
      <div
        className="shrink-0 sticky left-0 z-10 bg-[var(--surface-1)] border-r border-[var(--border)]"
        style={{ width: TRACK_LABEL_WIDTH }}
      />
      <div className="relative shrink-0" style={{ width: totalBeats * px }}>
        {ticks.map((i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 text-[10px] text-[var(--text-muted)] border-l border-[var(--border)] pl-1"
            style={{ left: i * px }}
          >
            {i % 4 === 0 ? i / 4 + 1 : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
