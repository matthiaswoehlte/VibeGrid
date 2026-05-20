'use client';
import { useAppStore } from '@/lib/store';
import { TRACK_LABEL_WIDTH } from './Tracks';

const BEAT_PX_BASE = 40;

export function Ruler({ totalBeats = 64 }: { totalBeats?: number }) {
  const zoom = useAppStore((s) => s.ui.zoom);
  const px = BEAT_PX_BASE * zoom;
  const ticks = Array.from({ length: totalBeats + 1 }, (_, i) => i);
  return (
    <div className="h-6 relative border-b border-[var(--border)] bg-[var(--surface-1)] overflow-hidden">
      {/* Ticks start to the right of the label column so beat-0 visually
          aligns with the left edge of every track's clip area. */}
      <div
        className="absolute top-0 bottom-0"
        style={{ left: TRACK_LABEL_WIDTH, width: totalBeats * px }}
      >
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
