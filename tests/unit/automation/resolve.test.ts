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
