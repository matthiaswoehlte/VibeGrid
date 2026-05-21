import { describe, it, expect } from 'vitest';
import { hexToRgba, darken } from '@/lib/utils/color';

describe('hexToRgba', () => {
  it('converts full 6-digit hex to rgba string', () => {
    expect(hexToRgba('#ff8800', 1)).toBe('rgba(255, 136, 0, 1)');
    expect(hexToRgba('#000000', 0)).toBe('rgba(0, 0, 0, 0)');
    expect(hexToRgba('#ffffff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
  });

  it('clamps alpha to [0, 1]', () => {
    expect(hexToRgba('#ffffff', -0.5)).toBe('rgba(255, 255, 255, 0)');
    expect(hexToRgba('#ffffff', 2)).toBe('rgba(255, 255, 255, 1)');
  });

  it('returns magenta on invalid hex (visual bug-indicator)', () => {
    expect(hexToRgba('not a color', 0.5)).toBe('rgba(255, 0, 255, 0.5)');
    expect(hexToRgba('#fff', 1)).toBe('rgba(255, 0, 255, 1)'); // 3-digit shorthand rejected
  });
});

describe('darken', () => {
  it('factor=0 returns the same color', () => {
    expect(darken('#ff8800', 0)).toBe('#ff8800');
  });

  it('factor=1 returns black', () => {
    expect(darken('#ff8800', 1)).toBe('#000000');
  });

  it('factor=0.5 halves every channel', () => {
    expect(darken('#ff8800', 0.5)).toBe('#804400'); // 255*0.5=127.5→128, 136*0.5=68
    expect(darken('#ffffff', 0.5)).toBe('#808080');
  });

  it('clamps factor to [0, 1]', () => {
    expect(darken('#ffffff', -1)).toBe('#ffffff');
    expect(darken('#ffffff', 5)).toBe('#000000');
  });

  it('returns magenta on invalid hex', () => {
    expect(darken('not a color', 0.5)).toBe('#ff00ff');
  });
});
