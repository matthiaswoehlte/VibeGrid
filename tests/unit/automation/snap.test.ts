import { describe, it, expect } from 'vitest';
import { snapBeat, type AutomationSnap } from '@/lib/automation/snap';

describe('snapBeat', () => {
  it('returns the input unchanged when snap is off', () => {
    expect(snapBeat(1.234, 'off')).toBe(1.234);
  });

  it("'1' rounds to the nearest whole beat", () => {
    expect(snapBeat(1.2, '1')).toBe(1);
    expect(snapBeat(1.6, '1')).toBe(2);
  });

  it("'1/2' rounds to 0.5 increments", () => {
    expect(snapBeat(1.2, '1/2')).toBe(1);
    expect(snapBeat(1.3, '1/2')).toBe(1.5);
  });

  it("'1/4' rounds to 0.25 increments", () => {
    expect(snapBeat(1.6, '1/4')).toBe(1.5);
    expect(snapBeat(1.7, '1/4')).toBe(1.75);
  });

  it("'1/16' rounds to 0.0625 increments", () => {
    // 1.05 / 0.0625 = 16.8 → rounds up to 17 → 1.0625
    expect(snapBeat(1.05, '1/16')).toBeCloseTo(1.0625, 5);
    // 1.03 / 0.0625 = 16.48 → rounds DOWN to 16 → 1.0 (nearest grid line)
    expect(snapBeat(1.03, '1/16')).toBeCloseTo(1.0, 5);
  });

  it('clamps negative inputs to 0', () => {
    expect(snapBeat(-0.5, '1/4')).toBe(0);
    expect(snapBeat(-0.001, 'off')).toBe(0);
  });

  it('exposes the AutomationSnap union via the type-import (compile check)', () => {
    const units: AutomationSnap[] = ['off', '1', '1/2', '1/4', '1/8', '1/16'];
    expect(units).toHaveLength(6);
  });
});
