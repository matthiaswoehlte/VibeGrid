import { describe, it, expect } from 'vitest';
import { downsamplePeaks } from '@/lib/audio/peaks';

// Float32Array stores values at 32-bit precision, so literals like -0.7 are
// stored as -0.699999988…; use toBeCloseTo throughout this file.
function expectPeakClose(
  actual: Array<[number, number]>,
  expected: Array<[number, number]>
): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((peak, i) => {
    expect(peak[0]).toBeCloseTo(expected[i][0], 5);
    expect(peak[1]).toBeCloseTo(expected[i][1], 5);
  });
}

describe('downsamplePeaks', () => {
  it('downsamples 8 samples to 4 cols → 2 samples/col min+max', () => {
    const data = new Float32Array([0.1, 0.5, -0.3, 0.8, 0.0, -0.5, 0.2, 0.4]);
    const peaks = downsamplePeaks(data, 4);
    expectPeakClose(peaks, [
      [0, 0.5],
      [-0.3, 0.8],
      [-0.5, 0],
      [0, 0.4]
    ]);
  });

  it('symmetric sine wave gives symmetric min/max per column', () => {
    const data = new Float32Array(1024);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin((i / data.length) * Math.PI * 2);
    const peaks = downsamplePeaks(data, 16);
    for (const [min, max] of peaks) {
      expect(min).toBeLessThanOrEqual(0);
      expect(max).toBeGreaterThanOrEqual(0);
    }
  });

  it('empty samples produce all-zero peaks (no NaN from division-by-zero)', () => {
    const peaks = downsamplePeaks(new Float32Array(0), 4);
    for (const [min, max] of peaks) {
      expect(min).toBe(0);
      expect(max).toBe(0);
    }
  });

  it('targetCols=1 returns the global min/max', () => {
    const data = new Float32Array([-0.7, 0.3, 0.9, -0.2]);
    const peaks = downsamplePeaks(data, 1);
    expectPeakClose(peaks, [[-0.7, 0.9]]);
  });
});
