import type { AutomationCurve } from '@/lib/automation/types';

/**
 * Plan 8d — auto-duck the sync-audio track during lipsync clips so the
 * user can hear the character's dialog without the soundtrack drowning
 * it out. Builds a step-interpolated volume automation curve from a
 * list of duck windows. The user can later edit the curve in the
 * Inspector — the auto-duck is just a sensible default the Transfer
 * (and SyncAudioDropZone re-snap) lay down.
 *
 * The default duck level (0.25 = quarter volume) was tuned by ear
 * against real LipSync material — 0.5 (half) still drowned out
 * quieter dialog, while full mute felt jarring on a 2 s clip. 0.25
 * leaves the soundtrack as a quiet bed under the speech.
 */

export interface DuckWindow {
  /** Inclusive — sync-audio volume drops at this beat. */
  startBeat: number;
  /** Exclusive — sync-audio volume restores at this beat. */
  endBeat: number;
}

export const DEFAULT_DUCK_LEVEL = 0.25;

/**
 * Build a volume automation curve that holds at 1.0 (full volume)
 * everywhere except inside the listed windows, where it drops to
 * `duckLevel`. Overlapping windows are merged.
 *
 * Returns null when there are no windows — caller should skip writing
 * to `clip.params.volume` so the param stays at its default (1.0
 * static) instead of being polluted by a degenerate single-point
 * curve.
 */
export function buildAutoDuckCurve(
  windows: ReadonlyArray<DuckWindow>,
  duckLevel: number = DEFAULT_DUCK_LEVEL
): AutomationCurve<number> | null {
  if (windows.length === 0) return null;

  // Sort + merge overlapping/adjacent windows so the curve has no
  // contradicting points (a duck-start at the same beat as a duck-end
  // would otherwise produce a flicker).
  const sorted = [...windows]
    .filter((w) => w.endBeat > w.startBeat)
    .sort((a, b) => a.startBeat - b.startBeat);
  if (sorted.length === 0) return null;
  const merged: DuckWindow[] = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.startBeat <= last.endBeat) {
      last.endBeat = Math.max(last.endBeat, w.endBeat);
    } else {
      merged.push({ ...w });
    }
  }

  // Anchor at beat 0 so the resolver returns 1.0 for any time before
  // the first lipsync window (resolveParam clamps to the first/last
  // point when the requested beat is out of range).
  const clampedLevel = Math.max(0, Math.min(1, duckLevel));
  const points: { beat: number; value: number }[] = [
    { beat: 0, value: 1.0 }
  ];
  for (const w of merged) {
    points.push({ beat: w.startBeat, value: clampedLevel });
    points.push({ beat: w.endBeat, value: 1.0 });
  }
  return { mode: 'automation', points, interpolation: 'step' };
}
