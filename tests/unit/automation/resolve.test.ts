import { describe, it, expect } from 'vitest';
import { resolveParam, resolveClipParams, isAutomationCurve } from '@/lib/automation/resolve';
import type { AutomationCurve } from '@/lib/automation/types';

describe('resolveParam — static passthrough', () => {
  it('returns plain numbers unchanged', () => {
    expect(resolveParam(0.5, 4)).toBe(0.5);
  });
  it('returns plain strings unchanged', () => {
    expect(resolveParam('#ff00ff', 4)).toBe('#ff00ff');
  });
  it('returns plain booleans unchanged', () => {
    expect(resolveParam(true, 4)).toBe(true);
  });
});

describe('resolveParam — automation curve', () => {
  const linear: AutomationCurve<number> = {
    mode: 'automation',
    points: [
      { beat: 0, value: 0 },
      { beat: 4, value: 1 }
    ],
    interpolation: 'linear'
  };

  it('returns first point value when beat is before range', () => {
    expect(resolveParam(linear, -1)).toBe(0);
  });
  it('returns last point value when beat is after range', () => {
    expect(resolveParam(linear, 100)).toBe(1);
  });
  it('returns exact point value at point boundary', () => {
    expect(resolveParam(linear, 0)).toBe(0);
    expect(resolveParam(linear, 4)).toBe(1);
  });
  it('linearly interpolates between two numeric points', () => {
    expect(resolveParam(linear, 2)).toBeCloseTo(0.5);
    expect(resolveParam(linear, 1)).toBeCloseTo(0.25);
  });

  it('step-falls-back for non-numeric values (color)', () => {
    const colorCurve: AutomationCurve<string> = {
      mode: 'automation',
      points: [
        { beat: 0, value: '#ff0000' },
        { beat: 4, value: '#00ff00' }
      ],
      interpolation: 'linear'
    };
    expect(resolveParam(colorCurve, 2)).toBe('#ff0000');
    expect(resolveParam(colorCurve, 4)).toBe('#00ff00');
  });

  it('handles single-point curve as constant', () => {
    const single: AutomationCurve<number> = {
      mode: 'automation',
      points: [{ beat: 0, value: 0.42 }],
      interpolation: 'linear'
    };
    expect(resolveParam(single, -10)).toBe(0.42);
    expect(resolveParam(single, 0)).toBe(0.42);
    expect(resolveParam(single, 10)).toBe(0.42);
  });

  it('throws on empty curve (programmer error, never serialised)', () => {
    const empty = { mode: 'automation', points: [], interpolation: 'linear' } as AutomationCurve<number>;
    expect(() => resolveParam(empty, 0)).toThrow(/empty/i);
  });

  it('isAutomationCurve discriminates correctly', () => {
    expect(isAutomationCurve(0.5)).toBe(false);
    expect(isAutomationCurve('#fff')).toBe(false);
    expect(isAutomationCurve(linear)).toBe(true);
  });
});

describe('resolveClipParams', () => {
  it('walks each key, resolving automation per key', () => {
    const params = {
      intensity: {
        mode: 'automation' as const,
        points: [
          { beat: 0, value: 0 },
          { beat: 8, value: 1 }
        ],
        interpolation: 'linear' as const
      },
      color: '#abcdef'
    };
    const out = resolveClipParams(params, 4);
    expect(out.intensity).toBeCloseTo(0.5);
    expect(out.color).toBe('#abcdef');
  });
});

describe('resolveParam — interpolation modes', () => {
  const base = (interpolation: 'linear' | 'step' | 'easeIn' | 'easeOut') => ({
    mode: 'automation' as const,
    points: [
      { beat: 0, value: 0 },
      { beat: 4, value: 1 }
    ],
    interpolation
  });

  it('step holds a.value between points', () => {
    const curve = base('step');
    expect(resolveParam(curve, 0)).toBe(0);
    expect(resolveParam(curve, 2)).toBe(0);
    expect(resolveParam(curve, 3.99)).toBe(0);
    expect(resolveParam(curve, 4)).toBe(1);
  });

  it('easeIn midpoint is t² = 0.25', () => {
    const curve = base('easeIn');
    expect(resolveParam(curve, 2)).toBeCloseTo(0.25, 5);
  });

  it('easeOut midpoint is 1−(1−t)² = 0.75', () => {
    const curve = base('easeOut');
    expect(resolveParam(curve, 2)).toBeCloseTo(0.75, 5);
  });

  it('non-numeric value with easeIn falls back to step (a.value held)', () => {
    const curve: AutomationCurve<string> = {
      mode: 'automation',
      points: [
        { beat: 0, value: '#ff0000' },
        { beat: 4, value: '#00ff00' }
      ],
      // Even with easeIn picked, non-numeric values can't be interpolated —
      // the resolver's typeof-number guard makes them step-hold.
      interpolation: 'easeIn'
    };
    expect(resolveParam(curve, 2)).toBe('#ff0000');
  });

  it('integer-typed value via easeIn returns a float (no rounding)', () => {
    const curve = base('easeIn');
    expect(Number.isInteger(resolveParam(curve, 2))).toBe(false);
  });

  it('interpolation field absent → resolver treats as step (safe default)', () => {
    const curve = {
      mode: 'automation' as const,
      points: [
        { beat: 0, value: 0 },
        { beat: 4, value: 1 }
      ]
    } as AutomationCurve<number>;
    expect(resolveParam(curve, 2)).toBe(0);
  });
});

describe('resolveParam — Flow Mode', () => {
  const curveTo4: AutomationCurve<number> = {
    mode: 'automation',
    points: [
      { beat: 0, value: 0 },
      { beat: 4, value: 1 }
    ],
    interpolation: 'linear'
  };

  it('Beat Mode (default) keeps absolute-beat semantics unchanged', () => {
    // 2 of 4 beats authored → 50% — same as before flowMode existed.
    expect(resolveParam(curveTo4, 2)).toBeCloseTo(0.5);
    // Explicit flowMode=false produces identical behavior.
    expect(resolveParam(curveTo4, 2, 8, false)).toBeCloseTo(0.5);
  });

  it('Flow Mode stretches a curve (points 0..4) over an 8-beat clip', () => {
    // Beat 4 of an 8-beat clip → 50% of the clip → 50% of the curve →
    // value 0.5. Beat 8 → end of clip → end of curve → 1.
    expect(resolveParam(curveTo4, 4, 8, true)).toBeCloseTo(0.5);
    expect(resolveParam(curveTo4, 8, 8, true)).toBe(1);
    expect(resolveParam(curveTo4, 0, 8, true)).toBe(0);
  });

  it('Flow Mode preserves step interpolation (hard jumps, just not beat-locked)', () => {
    const step: AutomationCurve<number> = {
      mode: 'automation',
      points: [
        { beat: 0, value: 0 },
        { beat: 4, value: 1 }
      ],
      interpolation: 'step'
    };
    // Stretched lookup at 50% of clip = 2 in curve coords; still pre-jump → 0.
    expect(resolveParam(step, 4, 8, true)).toBe(0);
    expect(resolveParam(step, 8, 8, true)).toBe(1);
  });

  it('Flow Mode clamps clip-relative beat to [0, clipLength]', () => {
    // Negative beat (pre-roll) → t=0 → first point. Over-shoot → t=1 → last.
    expect(resolveParam(curveTo4, -2, 8, true)).toBe(0);
    expect(resolveParam(curveTo4, 100, 8, true)).toBe(1);
  });

  it('Flow Mode with clipLengthBeats undefined falls back to Beat Mode', () => {
    // Defensive: passing flowMode without a length must not crash or stretch.
    expect(resolveParam(curveTo4, 2, undefined, true)).toBeCloseTo(0.5);
  });
});
