'use client';
import { useAppStore } from '@/lib/store';
import { TRACK_LABEL_WIDTH } from './Tracks';

const BEAT_PX_BASE = 40;

/**
 * Plan 9d Task 7 — Export range overlay.
 *
 * Renders an orange semi-transparent band over the timeline's horizontal
 * scroll area when `ui.exportRange` is set. The band is aligned to the same
 * beat→pixel coordinate space used by the Playhead and Ruler:
 *
 *   beat   = (sec - grid.offsetMs / 1000) * grid.bpm / 60
 *   pixelX = TRACK_LABEL_WIDTH + beat * BEAT_PX_BASE * zoom
 *
 * The component:
 *  - Reads exportRange, grid, and zoom from the store reactively.
 *  - Renders nothing (`null`) when exportRange is null.
 *  - Uses `pointer-events: none` so ctrl-drag on the ruler still fires.
 *  - Must be placed in the same scroll container as the Playhead (inside
 *    the `data-timeline-scroll` div in Timeline/index.tsx), so it shares
 *    the same horizontal scroll offset and is not clipped by the viewport.
 */
export function RangeOverlay() {
  const exportRange = useAppStore((s) => s.ui.exportRange);
  const zoom = useAppStore((s) => s.ui.zoom);
  const grid = useAppStore((s) => s.audio.grid);

  if (!exportRange) return null;

  const secToPixel = (sec: number): number => {
    const beats = Math.max(0, (sec - grid.offsetMs / 1000) * grid.bpm / 60);
    return TRACK_LABEL_WIDTH + beats * BEAT_PX_BASE * zoom;
  };

  const leftPx = secToPixel(exportRange.start);
  const rightPx = secToPixel(exportRange.end);
  const widthPx = Math.max(0, rightPx - leftPx);

  return (
    <div
      data-testid="range-overlay-band"
      className="absolute top-0 bottom-0 pointer-events-none z-20"
      style={{
        left: `${leftPx}px`,
        width: `${widthPx}px`,
        background: 'var(--range-select-fill)',
        borderLeft: '2px solid var(--range-select-edge)',
        borderRight: '2px solid var(--range-select-edge)',
      }}
      aria-hidden="true"
    />
  );
}
