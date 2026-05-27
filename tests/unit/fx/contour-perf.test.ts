import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeMockImageBitmap, makeRenderContext } from './_helpers';

// Mock extractContours so we can (a) count calls to verify cache
// invalidation and (b) feed deterministic points to verify the
// half-resolution upscale path.
vi.mock('@/lib/fx/contour/preload', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/fx/contour/preload')
  >('@/lib/fx/contour/preload');
  return {
    ...actual,
    extractContours: vi.fn(() => [
      {
        // 9 points (≥ MIN_PATH_POINTS=8). Coords are in HALF-RES space
        // (the mock plays the role of the Sobel output on the
        // downscaled canvas) — extractFromBitmap upscales them by 2×
        // before storing in cache.
        points: [
          [5, 5],
          [10, 10],
          [15, 15],
          [20, 20],
          [25, 25],
          [30, 30],
          [35, 35],
          [40, 40],
          [45, 45]
        ] as Array<[number, number]>,
        threshold: 0.3
      }
    ])
  };
});

// jsdom has no OffscreenCanvas. Minimal stub for extractFromBitmap's
// rasterise → getImageData round-trip. The mocked extractContours
// above bypasses any real pixel inspection.
class StubOffscreen {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext(): CanvasRenderingContext2D {
    return {
      drawImage: vi.fn(),
      getImageData: () => ({
        data: new Uint8ClampedArray(this.width * this.height * 4),
        width: this.width,
        height: this.height
      })
    } as unknown as CanvasRenderingContext2D;
  }
}
// @ts-expect-error — global stub for jsdom
globalThis.OffscreenCanvas = StubOffscreen;

import * as preloadMod from '@/lib/fx/contour/preload';
import {
  contourPlugin,
  EDGE_SCALE,
  _resetContourCacheForTests
} from '@/lib/fx/contour';

describe('contour — performance fix (half-resolution + cache)', () => {
  beforeEach(() => {
    vi.mocked(preloadMod.extractContours).mockClear();
    _resetContourCacheForTests();
  });

  it('EDGE_SCALE is 0.5 (half-resolution constant)', () => {
    expect(EDGE_SCALE).toBe(0.5);
  });

  it('cache hits on identical imageBitmapKey — no second extraction', () => {
    const bm = makeMockImageBitmap(200, 200);
    const rc1 = makeRenderContext({ imageBitmap: bm, imageBitmapKey: 'key-A' });
    contourPlugin.render(rc1, contourPlugin.getDefaultParams());
    expect(preloadMod.extractContours).toHaveBeenCalledTimes(1);

    // Second render with the SAME key — must hit cache.
    const rc2 = makeRenderContext({ imageBitmap: bm, imageBitmapKey: 'key-A' });
    contourPlugin.render(rc2, contourPlugin.getDefaultParams());
    expect(preloadMod.extractContours).toHaveBeenCalledTimes(1);
  });

  it('cache invalidates on new imageBitmapKey — re-extract', () => {
    const bm = makeMockImageBitmap(200, 200);
    const rc1 = makeRenderContext({ imageBitmap: bm, imageBitmapKey: 'key-A' });
    contourPlugin.render(rc1, contourPlugin.getDefaultParams());
    expect(preloadMod.extractContours).toHaveBeenCalledTimes(1);

    // Different key (simulates a Video bucket transition) — must miss.
    const rc2 = makeRenderContext({ imageBitmap: bm, imageBitmapKey: 'key-B' });
    contourPlugin.render(rc2, contourPlugin.getDefaultParams());
    expect(preloadMod.extractContours).toHaveBeenCalledTimes(2);
  });

  it('edge-point coordinates are upscaled by 1/EDGE_SCALE before render', () => {
    // Mock returns point [5, 5] as the FIRST path-point. With
    // EDGE_SCALE=0.5, the upscale factor is 2, so the stored path
    // begins at (10, 10) in image-coordinate space.
    //
    // The renderer then applies containRect → canvas-coordinate space.
    // We verify by inspecting the ctx.moveTo() call (the very first
    // drawing op after the stroke setup).
    const bm = makeMockImageBitmap(200, 200);
    const rc = makeRenderContext({
      imageBitmap: bm,
      imageBitmapKey: 'upscale-test',
      width: 800,
      height: 450
    });
    contourPlugin.render(rc, contourPlugin.getDefaultParams());

    // containRect math for 200×200 bitmap on 800×450 canvas:
    //   fit = min(800/200, 450/200) = min(4, 2.25) = 2.25
    //   drawnW = 200 × 2.25 = 450
    //   drawnH = 200 × 2.25 = 450
    //   offX = (800 - 450) / 2 = 175
    //   offY = (450 - 450) / 2 = 0
    // Upscaled point (10, 10) in image space → canvas (175+10*2.25, 0+10*2.25) = (197.5, 22.5)
    const fit = 2.25;
    const offX = 175;
    const offY = 0;
    const expectedX = offX + 10 * fit;
    const expectedY = offY + 10 * fit;

    const calls = (
      rc.ctx as unknown as {
        __calls: Array<{ method: string; args: unknown[] }>;
      }
    ).__calls;
    const moveTo = calls.find((c) => c.method === 'moveTo');
    expect(moveTo).toBeDefined();
    expect(moveTo!.args[0]).toBeCloseTo(expectedX, 1);
    expect(moveTo!.args[1]).toBeCloseTo(expectedY, 1);
  });
});
