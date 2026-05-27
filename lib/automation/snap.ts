export type AutomationSnap =
  | 'off'
  | '1'
  | '1/2'
  | '1/4'
  | '1/8'
  | '1/16'
  | '1/32';

export const SNAP_BEAT_STEP: Record<Exclude<AutomationSnap, 'off'>, number> = {
  '1': 1,
  '1/2': 0.5,
  '1/4': 0.25,
  '1/8': 0.125,
  '1/16': 0.0625,
  '1/32': 0.03125
};

/** Round a beat value to the nearest grid unit. `'off'` is a pass-through.
 *  Always clamps the result to ≥ 0. */
export function snapBeat(beat: number, unit: AutomationSnap): number {
  if (unit === 'off') return Math.max(0, beat);
  const step = SNAP_BEAT_STEP[unit];
  return Math.max(0, Math.round(beat / step) * step);
}
