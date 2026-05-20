import type { AutomationCurve, StaticOrAuto } from './types';

export function isAutomationCurve<T>(p: StaticOrAuto<T>): p is AutomationCurve<T> {
  return (
    typeof p === 'object' &&
    p !== null &&
    (p as AutomationCurve<T>).mode === 'automation' &&
    Array.isArray((p as AutomationCurve<T>).points)
  );
}

/**
 * Resolve a (possibly automated) param value at a given beat.
 *
 * Beat Mode (the default — `flowMode === false || clipLengthBeats === undefined`):
 *   `beat` is read straight through; curves behave exactly as authored, beat-
 *   accurate against the timeline grid.
 *
 * Flow Mode (`flowMode === true` AND `clipLengthBeats` provided):
 *   the curve is stretched so that its first point maps to clip start and its
 *   last point maps to clip end. `beat` is expected to be CLIP-RELATIVE
 *   (caller passes `absoluteBeats - clip.startBeat`); the lookup index then
 *   becomes `(beat / clipLengthBeats) * points[last].beat`. This makes
 *   automation continuous over the clip duration regardless of where points
 *   actually sit, which is the Flow-Mode promise.
 *
 *   Step interpolation is preserved in Flow Mode on purpose — users who chose
 *   step want hard jumps, just no longer beat-triggered.
 */
export function resolveParam<T>(
  p: StaticOrAuto<T>,
  beat: number,
  clipLengthBeats?: number,
  flowMode?: boolean
): T {
  if (!isAutomationCurve(p)) return p;
  const pts = p.points;
  if (pts.length === 0) {
    throw new Error('resolveParam: empty AutomationCurve.points');
  }

  let lookup = beat;
  if (flowMode && clipLengthBeats !== undefined && clipLengthBeats > 0) {
    const lastBeat = pts[pts.length - 1].beat;
    // Stretch the curve's authored range [0, lastBeat] onto the clip's
    // length. A curve with points at beats 0..4 inside an 8-beat clip then
    // covers the whole clip in Flow Mode (in Beat Mode it would finish at
    // half-time and hold).
    const t = Math.max(0, Math.min(1, beat / clipLengthBeats));
    lookup = t * lastBeat;
  }

  if (pts.length === 1 || lookup <= pts[0].beat) return pts[0].value;
  if (lookup >= pts[pts.length - 1].beat) return pts[pts.length - 1].value;

  // Find segment containing `lookup`. Linear scan — v0.1 curves stay short (< 16 points).
  let i = 0;
  while (i < pts.length - 1 && pts[i + 1].beat <= lookup) i++;
  const a = pts[i];
  const b = pts[i + 1];

  if (typeof a.value === 'number' && typeof b.value === 'number') {
    const t = (lookup - a.beat) / (b.beat - a.beat);
    const va = a.value as number;
    const vb = b.value as number;
    switch (p.interpolation) {
      case 'linear':
        return (va + (vb - va) * t) as T;
      case 'easeIn':
        // Quadratic ease-in: slow start, accelerating finish.
        return (va + (vb - va) * (t * t)) as T;
      case 'easeOut': {
        // Quadratic ease-out: fast start, decelerating finish. 1 − (1−t)².
        const inv = 1 - t;
        return (va + (vb - va) * (1 - inv * inv)) as T;
      }
      case 'step':
      default:
        break;
    }
  }

  // Step fallback — hold a.value until next point. Also handles non-numeric values.
  return a.value;
}

export function resolveClipParams(
  params: Record<string, unknown>,
  beat: number,
  clipLengthBeats?: number,
  flowMode?: boolean
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = resolveParam(v as StaticOrAuto<unknown>, beat, clipLengthBeats, flowMode);
  }
  return out;
}
