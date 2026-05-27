'use client';
import { useAppStore } from '@/lib/store';
import { SNAP_BEAT_STEP } from '@/lib/automation/snap';

/**
 * Plan 9b follow-up — orientation grid behind the Ruler + Tracks. Two
 * gradient layers stacked via CSS `background-image`:
 *
 *   1. **Bar-Highlight**: every 4-bar block (= 16 beats) gets a
 *      marginally lighter wash, alternating to anchor the eye over
 *      long sections. Subtle so it doesn't compete with clip colours.
 *   2. **Grid-Lines**: vertical hairlines in three weights —
 *      bar-lines (every 4 beats), beat-lines (every 1 beat), and
 *      snap-lines (every snap-step, e.g. ⅛ beat at snap='1/8').
 *      Snap-lines hide when their spacing in pixels falls below 4px
 *      to avoid a solid-grey wash at low zoom.
 *
 * Coordinates are content-relative and start at the left edge of the
 * track area (label-column already offset by the caller via the
 * wrapper's positioning). The component is `pointer-events-none` so
 * it never intercepts drags/clicks on the Ruler or clips above it.
 *
 * Mounted at TWO sites with identical math:
 *   - `Ruler.tsx` (so the lines appear in the time-strip)
 *   - `Tracks.tsx` (so the lines and bar-highlight cross every track)
 *
 * Both consume `useAppStore((s) => s.ui.clipSnap)` so a change in the
 * picker re-renders both immediately.
 */
export function GridBackground({
  totalBeats,
  pxPerBeat
}: {
  totalBeats: number;
  pxPerBeat: number;
}) {
  const snap = useAppStore((s) => s.ui.clipSnap);

  const barPx = pxPerBeat * 4;
  // 4 bars = 1 "group" — alternation period over which the bar-highlight
  // flips. At 120 BPM / zoom 1 that's 16 beats * 40px = 640px per block.
  const groupPx = barPx * 4;

  // Resolve snap-step in pixels; hide snap-lines when too dense.
  const snapStep = snap !== 'off' ? SNAP_BEAT_STEP[snap] : 0;
  const snapPx = snapStep * pxPerBeat;
  const showSnapLines = snap !== 'off' && snapPx >= 4 && snapPx < pxPerBeat;

  // Hairline colors — dark transparent overlays on the dark theme.
  // Each layer is a `repeating-linear-gradient` with a 1px coloured
  // band at offset 0, then transparent for the rest of the cycle.
  const layers: string[] = [];

  // Layer 1 (bottom): bar alternation highlight. Mid-grey wash.
  layers.push(
    `repeating-linear-gradient(` +
      `to right,` +
      ` transparent 0,` +
      ` transparent ${groupPx / 2}px,` +
      ` rgba(255,255,255,0.025) ${groupPx / 2}px,` +
      ` rgba(255,255,255,0.025) ${groupPx}px` +
      `)`
  );

  // Layer 2: snap-lines (faint, hairline). Only if zoom-resolvable.
  if (showSnapLines) {
    layers.push(
      `repeating-linear-gradient(` +
        `to right,` +
        ` rgba(0,0,0,0.18) 0,` +
        ` rgba(0,0,0,0.18) 1px,` +
        ` transparent 1px,` +
        ` transparent ${snapPx}px` +
        `)`
    );
  }

  // Layer 3: beat-lines (medium). Always visible.
  layers.push(
    `repeating-linear-gradient(` +
      `to right,` +
      ` rgba(0,0,0,0.30) 0,` +
      ` rgba(0,0,0,0.30) 1px,` +
      ` transparent 1px,` +
      ` transparent ${pxPerBeat}px` +
      `)`
  );

  // Layer 4 (top): bar-lines (strongest). Every 4th beat.
  layers.push(
    `repeating-linear-gradient(` +
      `to right,` +
      ` rgba(0,0,0,0.55) 0,` +
      ` rgba(0,0,0,0.55) 1px,` +
      ` transparent 1px,` +
      ` transparent ${barPx}px` +
      `)`
  );

  // CSS stacks background-images first→last as top→bottom in z-order,
  // so we reverse so the strongest line wins where they coincide
  // (bar overlaps beat overlaps snap). Putting bar first means it
  // paints on top.
  const backgroundImage = layers.reverse().join(', ');

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 bottom-0"
      style={{
        left: 0,
        width: totalBeats * pxPerBeat,
        backgroundImage
      }}
    />
  );
}
