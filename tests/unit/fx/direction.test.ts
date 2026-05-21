import { describe, it, expect } from 'vitest';
import {
  directionToOrigin,
  directionToAngle,
  FX_DIRECTION_OPTIONS,
  type FXDirection
} from '@/lib/fx/direction';

describe('directionToOrigin', () => {
  it('edges return midpoint of the edge', () => {
    expect(directionToOrigin('top', 800, 450)).toEqual({ x: 400, y: 0 });
    expect(directionToOrigin('bottom', 800, 450)).toEqual({ x: 400, y: 450 });
    expect(directionToOrigin('left', 800, 450)).toEqual({ x: 0, y: 225 });
    expect(directionToOrigin('right', 800, 450)).toEqual({ x: 800, y: 225 });
  });

  it('corners return the exact corner', () => {
    expect(directionToOrigin('top-left', 800, 450)).toEqual({ x: 0, y: 0 });
    expect(directionToOrigin('top-right', 800, 450)).toEqual({ x: 800, y: 0 });
    expect(directionToOrigin('bottom-left', 800, 450)).toEqual({ x: 0, y: 450 });
    expect(directionToOrigin('bottom-right', 800, 450)).toEqual({ x: 800, y: 450 });
  });

  it('center returns the canvas centre', () => {
    expect(directionToOrigin('center', 800, 450)).toEqual({ x: 400, y: 225 });
  });
});

describe('directionToAngle', () => {
  it('top points downward (+π/2 in canvas coords where +y is down)', () => {
    expect(directionToAngle('top')).toBeCloseTo(Math.PI / 2, 6);
  });

  it('bottom points upward', () => {
    expect(directionToAngle('bottom')).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('left points rightward (rays travel into canvas)', () => {
    expect(directionToAngle('left')).toBe(0);
  });

  it('right points leftward', () => {
    expect(directionToAngle('right')).toBeCloseTo(Math.PI, 6);
  });

  it('center returns 0 (no preferred direction)', () => {
    expect(directionToAngle('center')).toBe(0);
  });

  it('every direction produces a finite number', () => {
    const all: FXDirection[] = [
      'top', 'bottom', 'left', 'right',
      'top-left', 'top-right', 'bottom-left', 'bottom-right',
      'center'
    ];
    for (const d of all) {
      expect(Number.isFinite(directionToAngle(d))).toBe(true);
    }
  });
});

describe('FX_DIRECTION_OPTIONS', () => {
  it('covers all 9 FXDirection values exactly once', () => {
    const values = FX_DIRECTION_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(9);
    expect(values).toContain('center');
  });

  it('every option has a non-empty label', () => {
    for (const o of FX_DIRECTION_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(0);
    }
  });
});
