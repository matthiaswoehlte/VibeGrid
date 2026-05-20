import type { Clip, TimelineState } from '@/lib/timeline/types';
import { resolveParam, isAutomationCurve } from '@/lib/automation/resolve';
import { findIncomingOverlap } from '@/lib/timeline/overlap';
import { BLEND_KEY } from '@/lib/timeline/blend';
import type { AutomationCurve } from '@/lib/automation/types';

/**
 * Final alpha for `clip` at the given beat. Returns 1 when no overlap on the
 * same track touches this clip at this beat. Otherwise:
 *   - If `clip` is in its OWN incoming overlap, alpha = resolveParam(clip.__blend, beats).
 *   - If a successor's incoming overlap covers this beat, alpha *= (1 - successor.__blend).
 *
 * Both sides multiply for the 3-clip-chain middle.
 */
export function computeClipAlpha(state: TimelineState, clip: Clip, beats: number): number {
  let alpha = 1;

  const incoming = findIncomingOverlap(state, clip.id);
  if (incoming) {
    const overlapStart = clip.startBeat;
    const overlapEnd = incoming.startBeat + incoming.lengthBeats;
    if (beats >= overlapStart && beats < overlapEnd) {
      const blend = clip.params?.[BLEND_KEY];
      if (isAutomationCurve(blend)) {
        alpha *= resolveParam(blend as AutomationCurve<number>, beats);
      }
    }
  }

  const next = state.clips.find((c) => {
    if (c.trackId !== clip.trackId) return false;
    if (c.id === clip.id) return false;
    const pre = findIncomingOverlap(state, c.id);
    return pre?.id === clip.id;
  });
  if (next) {
    const overlapStart = next.startBeat;
    const overlapEnd = clip.startBeat + clip.lengthBeats;
    if (beats >= overlapStart && beats < overlapEnd) {
      const blend = next.params?.[BLEND_KEY];
      if (isAutomationCurve(blend)) {
        alpha *= 1 - resolveParam(blend as AutomationCurve<number>, beats);
      }
    }
  }

  return alpha;
}
