import { describe, it, expect } from 'vitest';
import { extractContours } from '@/lib/fx/contour/preload';

function makeTestImageData(width = 8, height = 8): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inside = x >= 2 && x <= 5 && y >= 2 && y <= 5;
      const v = inside ? 255 : 0;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width, height } as ImageData;
}

describe('extractContours', () => {
  it('returns an empty array on a uniform image', () => {
    const data = new Uint8ClampedArray(8 * 8 * 4).fill(0);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const result = extractContours({ data, width: 8, height: 8 } as ImageData, 0.5);
    expect(result.length).toBe(0);
  });

  it('returns at least one path for a contrasted square', () => {
    const result = extractContours(makeTestImageData(), 0.3);
    expect(result.length).toBeGreaterThan(0);
  });

  it('threshold parameter affects path count (higher → fewer edges)', () => {
    const lo = extractContours(makeTestImageData(), 0.1);
    const hi = extractContours(makeTestImageData(), 0.95);
    expect(hi.length).toBeLessThanOrEqual(lo.length);
  });

  it('returned paths have at least one point each', () => {
    const result = extractContours(makeTestImageData(), 0.3);
    for (const p of result) {
      expect(p.points.length).toBeGreaterThan(0);
    }
  });
});
