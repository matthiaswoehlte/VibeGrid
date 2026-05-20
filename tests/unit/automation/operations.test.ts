import { describe, it, expect } from 'vitest';
import {
  sortPoints,
  addPoint,
  removePoint,
  updatePoint,
  makeCurve,
  toStaticValue
} from '@/lib/automation/operations';
import type { AutomationCurve, AutomationPoint } from '@/lib/automation/types';

const curve = (pts: AutomationPoint<number>[]): AutomationCurve<number> => ({
  mode: 'automation',
  interpolation: 'linear',
  points: pts
});

describe('sortPoints', () => {
  it('orders points by beat ascending', () => {
    const out = sortPoints([
      { beat: 4, value: 1 },
      { beat: 0, value: 0 },
      { beat: 2, value: 0.5 }
    ]);
    expect(out.map((p) => p.beat)).toEqual([0, 2, 4]);
  });

  it('does not mutate input', () => {
    const input = [
      { beat: 4, value: 1 },
      { beat: 0, value: 0 }
    ];
    const copy = [...input];
    sortPoints(input);
    expect(input).toEqual(copy);
  });
});

describe('addPoint', () => {
  it('inserts and re-sorts', () => {
    const c = curve([{ beat: 0, value: 0 }, { beat: 4, value: 1 }]);
    const out = addPoint(c, { beat: 2, value: 0.5 });
    expect(out.points.map((p) => p.beat)).toEqual([0, 2, 4]);
  });

  it('keeps duplicate beats (does not dedupe)', () => {
    const c = curve([{ beat: 0, value: 0 }]);
    const out = addPoint(c, { beat: 0, value: 1 });
    expect(out.points).toHaveLength(2);
  });
});

describe('removePoint', () => {
  it('drops the point at the given index', () => {
    const c = curve([
      { beat: 0, value: 0 },
      { beat: 2, value: 0.5 },
      { beat: 4, value: 1 }
    ]);
    const out = removePoint(c, 1);
    expect(out.points.map((p) => p.beat)).toEqual([0, 4]);
  });

  it('returns the same curve on out-of-range index (no-op)', () => {
    const c = curve([{ beat: 0, value: 0 }]);
    expect(removePoint(c, 5)).toBe(c);
    expect(removePoint(c, -1)).toBe(c);
  });
});

describe('updatePoint', () => {
  it('merges patch at index and re-sorts when beat changes', () => {
    const c = curve([
      { beat: 0, value: 0 },
      { beat: 4, value: 1 }
    ]);
    const out = updatePoint(c, 0, { beat: 6 });
    expect(out.points.map((p) => p.beat)).toEqual([4, 6]);
    expect(out.points[1].value).toBe(0);
  });

  it('returns same curve on out-of-range index', () => {
    const c = curve([{ beat: 0, value: 0 }]);
    expect(updatePoint(c, 5, { beat: 1 })).toBe(c);
  });
});

describe('makeCurve', () => {
  it('returns a single-point linear curve at the given beat', () => {
    const out = makeCurve(0.7, 3);
    expect(out).toEqual({
      mode: 'automation',
      interpolation: 'linear',
      points: [{ beat: 3, value: 0.7 }]
    });
  });

  it('accepts a custom interpolation mode', () => {
    const out = makeCurve(0.7, 0, 'step');
    expect(out.interpolation).toBe('step');
  });
});

describe('toStaticValue', () => {
  it('returns points[0].value', () => {
    const c = curve([{ beat: 0, value: 0.42 }, { beat: 4, value: 1 }]);
    expect(toStaticValue(c)).toBe(0.42);
  });

  it('throws on empty points array (caller must guard)', () => {
    const c = curve([]);
    expect(() => toStaticValue(c)).toThrow();
  });
});
