'use client';
import { useAppStore } from '@/lib/store';
import type { AudioEngine } from '@/lib/audio/engine';
import { TRACK_LABEL_WIDTH } from './Tracks';
import { GridBackground } from './GridBackground';
import { snapBeat } from '@/lib/automation/snap';
import { readClipSnap } from '@/components/Workspace/ClipSnapPicker';

const BEAT_PX_BASE = 40;

// ---------------------------------------------------------------------------
// Shared pointer-drag scaffold
// ---------------------------------------------------------------------------
// Both the seek-scrub branch and the range-drag branch need:
//   1. setPointerCapture on the target element
//   2. addEventListener for pointermove / pointerup / pointercancel
//   3. cleanup (releasePointerCapture + removeEventListener for all three)
//
// `onCancel` is optional. When omitted, `onUp` is reused for pointercancel
// — which preserves the seek-scrub branch's existing cancel semantics
// (release + cleanup, no store writes). The range-drag branch supplies its
// own `onCancel` that explicitly skips any store write.
function attachDragListeners(
  target: HTMLElement,
  pointerId: number,
  handlers: {
    onMove: (ev: PointerEvent) => void;
    onUp: (ev: PointerEvent) => void;
    onCancel?: (ev: PointerEvent) => void;
  }
): void {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    /* jsdom does not implement setPointerCapture */
  }

  const { onMove, onUp } = handlers;
  const onCancel = handlers.onCancel ?? onUp;

  function cleanup(ev: PointerEvent) {
    try {
      target.releasePointerCapture(ev.pointerId);
    } catch {
      /* */
    }
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', wrappedUp);
    target.removeEventListener('pointercancel', wrappedCancel);
  }

  function wrappedUp(ev: PointerEvent) {
    cleanup(ev);
    onUp(ev);
  }

  function wrappedCancel(ev: PointerEvent) {
    cleanup(ev);
    onCancel(ev);
  }

  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', wrappedUp);
  target.addEventListener('pointercancel', wrappedCancel);
}

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

  /** Convert a pixel clientX to a snapped beat, clamped to [0, totalBeats]. */
  const clientXToSnappedBeat = (clientX: number, target: HTMLElement): number => {
    const rect = target.getBoundingClientRect();
    const localX = Math.max(0, clientX - rect.left);
    const rawBeat = Math.max(0, Math.min(totalBeats, localX / px));
    const snap = readClipSnap();
    return snapBeat(rawBeat, snap);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    const isRangeDrag = e.ctrlKey || e.metaKey;

    if (isRangeDrag) {
      // -----------------------------------------------------------------------
      // Ctrl/Cmd+Drag — range selection mode.
      // Suppress playhead seek. Record start beat. Live-update the store on
      // each move (setExportRange is skip:true so it doesn't pollute undo).
      // On pointerup, commit the final range to the store.
      // On pointercancel, leave the last live move value in the store — do NOT
      // commit with the garbage clientX=0 that cancel events carry.
      // -----------------------------------------------------------------------
      const startBeat = clientXToSnappedBeat(e.clientX, target);

      attachDragListeners(target, e.pointerId, {
        onMove: (ev) => {
          const endBeat = clientXToSnappedBeat(ev.clientX, target);
          const grid = useAppStore.getState().audio.grid;
          const startSec = (startBeat * 60) / grid.bpm + grid.offsetMs / 1000;
          const endSec = (endBeat * 60) / grid.bpm + grid.offsetMs / 1000;
          // Live-update store during drag (skip:true mutator, no undo spam).
          useAppStore.getState().setExportRange(startSec, endSec);
        },
        onUp: (ev) => {
          // Commit final position on release.
          const endBeat = clientXToSnappedBeat(ev.clientX, target);
          const grid = useAppStore.getState().audio.grid;
          const startSec = (startBeat * 60) / grid.bpm + grid.offsetMs / 1000;
          const endSec = (endBeat * 60) / grid.bpm + grid.offsetMs / 1000;
          useAppStore.getState().setExportRange(startSec, endSec);
        },
        // pointercancel: clientX is 0/garbage — do NOT write to store.
        // The last pointermove value already in the store stands.
        onCancel: () => { /* no-op: cleanup already handled by attachDragListeners */ },
      });
    } else {
      // -----------------------------------------------------------------------
      // Plain drag/click — existing seek behavior + clear export range.
      // -----------------------------------------------------------------------
      useAppStore.getState().clearExportRange();
      seekFromClient(e.clientX, target);
      // Drag-scrub: subsequent pointermoves keep updating the playhead until
      // the user releases. Uses setPointerCapture so the scrub follows the
      // cursor even if it leaves the ruler.
      attachDragListeners(target, e.pointerId, {
        onMove: (ev) => seekFromClient(ev.clientX, target),
        // onUp: release (cleanup) only — no store write needed beyond the
        // last seekFromClient called in onMove. onCancel defaults to onUp
        // (omitted), preserving the existing scrub cancel semantics.
        onUp: () => { /* cleanup handled by attachDragListeners */ },
      });
    }
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
