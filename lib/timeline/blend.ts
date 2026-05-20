import type { AutomationCurve, Interpolation } from '@/lib/automation/types';

export const BLEND_KEY = '__blend';

/**
 * Build a two-point `__blend` curve that ramps the incoming clip from 0 to 1
 * across the overlap range. The user can later change the interpolation via
 * the Inspector Transition section — points stay at the range boundaries.
 */
export function makeDefaultBlend(
  overlapStart: number,
  overlapEnd: number,
  interpolation: Interpolation = 'linear'
): AutomationCurve<number> {
  return {
    mode: 'automation',
    interpolation,
    points: [
      { beat: overlapStart, value: 0 },
      { beat: overlapEnd, value: 1 }
    ]
  };
}
