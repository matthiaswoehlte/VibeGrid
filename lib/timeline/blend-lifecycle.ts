import type { TimelineState } from './types';
import { findIncomingOverlap, overlapRange, isReservedParamKey } from './overlap';
import { makeDefaultBlend, BLEND_KEY } from './blend';
import { isAutomationCurve } from '@/lib/automation/resolve';
import type { AutomationCurve, Interpolation } from '@/lib/automation/types';

/**
 * For every clip on `trackId`, set or clear `params.__blend` to match the
 * current overlap state. Pure — returns a new state. Preserves each clip's
 * previously-chosen interpolation mode when re-generating the curve.
 */
export function regenerateBlendsForTrack(
  state: TimelineState,
  trackId: string
): TimelineState {
  const nextClips = state.clips.map((c) => {
    if (c.trackId !== trackId) return c;
    const incoming = findIncomingOverlap(state, c.id);
    const existingParams = c.params ?? {};
    const existingBlend = existingParams[BLEND_KEY];
    const previousInterp: Interpolation =
      isAutomationCurve(existingBlend)
        ? (existingBlend as AutomationCurve<number>).interpolation
        : 'linear';

    // Plan 5.9c — cross-kind overlaps don't crossfade meaningfully.
    // `params.__blend` interpolates plugin parameters; FX plugins of
    // different kinds have disjoint parameter sets so any crossfade
    // would just spread the wrong values across the wrong plugin.
    // Treat cross-kind overlap like "no incoming": delete any stale
    // `__blend` and return.
    if (!incoming || incoming.kind !== c.kind) {
      if (!(BLEND_KEY in existingParams)) return c;
      const nextParams: Record<string, unknown> = { ...existingParams };
      delete nextParams[BLEND_KEY];
      return { ...c, params: nextParams };
    }

    const range = overlapRange(incoming, c);
    if (!range) return c;
    const nextBlend = makeDefaultBlend(range[0], range[1], previousInterp);
    return { ...c, params: { ...existingParams, [BLEND_KEY]: nextBlend } };
  });

  return { ...state, clips: nextClips };
}

export { isReservedParamKey };
