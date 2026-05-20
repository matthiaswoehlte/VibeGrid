import { describe, it, expect } from 'vitest';
import { makeDefaultBlend, BLEND_KEY } from '@/lib/timeline/blend';

describe('makeDefaultBlend', () => {
  it('builds a two-point curve from 0 to 1 across the given range', () => {
    const curve = makeDefaultBlend(6, 8);
    expect(curve.mode).toBe('automation');
    expect(curve.points).toEqual([
      { beat: 6, value: 0 },
      { beat: 8, value: 1 }
    ]);
  });

  it('defaults to linear interpolation', () => {
    expect(makeDefaultBlend(0, 4).interpolation).toBe('linear');
  });

  it('accepts a custom interpolation mode', () => {
    expect(makeDefaultBlend(0, 4, 'easeIn').interpolation).toBe('easeIn');
  });

  it('exposes the reserved key constant', () => {
    expect(BLEND_KEY).toBe('__blend');
  });
});
