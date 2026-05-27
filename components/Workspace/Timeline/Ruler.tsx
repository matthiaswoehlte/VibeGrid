'use client';
import { useAppStore } from '@/lib/store';
import type { AudioEngine } from '@/lib/audio/engine';
import { TRACK_LABEL_WIDTH } from './Tracks';
import { GridBackground } from './GridBackground';

const BEAT_PX_BASE = 40;

export function Ruler({
  totalBeats,
  engine
}: {
  totalBeats: number;
  engine: AudioEngine | null;
}) {
  const zoom = useAppStore((s) => s.ui.zoom);
  const setPlayhead = useAppStore((s) => s.timelineActions.setPlayhead);
  const playheadBeats = useAppStore((s) => s.timeline.playhead.beats);
  const px = BEAT_PX_BASE * zoom;
  const ticks = Array.from({ length: totalBeats + 1 }, (_, i) => i);

  const seekFromClient = (clientX: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const localX = Math.max(0, clientX - rect.left);
    const beat = Math.max(0, Math.min(totalBeats, localX / px));
    const grid = useAppStore.getState().audio.grid;
    setPlayhead(beat);
    if (engine) {
      const seconds = (beat * 60) / grid.bpm + grid.offsetMs / 1000;
      engine.seek(seconds);
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    seekFromClient(e.clientX, target);
    // Drag-scrub: subsequent pointermoves keep updating the playhead until
    // the user releases. Uses setPointerCapture so the scrub follows the
    // cursor even if it leaves the ruler.
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* jsdom */
    }
    const move = (ev: PointerEvent) => seekFromClient(ev.clientX, target);
    const up = (ev: PointerEvent) => {
      try {
        target.releasePointerCapture(ev.pointerId);
      } catch {
        /* */
      }
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

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
      <div
        className="relative shrink-0"
        style={{ width: totalBeats * px, cursor: 'pointer', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        role="slider"
        aria-label="Seek playhead"
        aria-valuemin={0}
        aria-valuemax={totalBeats}
        aria-valuenow={Math.round(playheadBeats * 100) / 100}
      >
        <GridBackground totalBeats={totalBeats} pxPerBeat={px} />
        {ticks.map((i) =>
          // Show bar-number labels every 4 beats. The vertical bar/beat
          // lines themselves are drawn by GridBackground above, so each
          // tick is now a label-only span (no border-l).
          i % 4 === 0 ? (
            <div
              key={i}
              className="absolute top-0 bottom-0 text-[10px] text-[var(--text-muted)] pl-1 pointer-events-none"
              style={{ left: i * px }}
            >
              {i / 4 + 1}
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}
