import type { Clip, TimelineState } from './types';

export const RESERVED_PARAM_PREFIX = '__';

export function isReservedParamKey(key: string): boolean {
  return key.startsWith(RESERVED_PARAM_PREFIX);
}

/**
 * Return the clip on the same track whose tail intersects this clip's head,
 * or null when no such clip exists. Half-open ranges — exactly adjacent
 * (a.end === b.start) does NOT count as an overlap.
 *
 * When multiple preceding clips overlap, the CLOSEST one (latest startBeat)
 * wins — this matches the visual order the user sees.
 */
export function findIncomingOverlap(state: TimelineState, clipId: string): Clip | null {
  const clip = state.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  let best: Clip | null = null;
  for (const other of state.clips) {
    if (other.id === clip.id) continue;
    if (other.trackId !== clip.trackId) continue;
    if (other.startBeat >= clip.startBeat) continue;
    const otherEnd = other.startBeat + other.lengthBeats;
    if (otherEnd <= clip.startBeat) continue;
    if (!best || other.startBeat > best.startBeat) best = other;
  }
  return best;
}

/**
 * Return [start, end] of the half-open intersection of two clips' beat ranges,
 * or null when they don't intersect. The caller is responsible for ensuring
 * both clips are on the same track.
 */
export function overlapRange(a: Clip, b: Clip): [number, number] | null {
  const aEnd = a.startBeat + a.lengthBeats;
  const bEnd = b.startBeat + b.lengthBeats;
  const start = Math.max(a.startBeat, b.startBeat);
  const end = Math.min(aEnd, bEnd);
  if (start >= end) return null;
  return [start, end];
}
