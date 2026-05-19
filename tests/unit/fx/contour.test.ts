import { describe, it, expect, vi } from 'vitest';
import { contourPlugin } from '@/lib/fx/contour';
import { makeMockImageBitmap, makeRenderContext } from './_helpers';

// Stub OffscreenCanvas because contour uses it in preload(). jsdom has none.
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
// @ts-expect-error — assigning stub for jsdom
globalThis.OffscreenCanvas = StubOffscreen;

describe('contourPlugin', () => {
  it('has the correct shape', () => {
    expect(contourPlugin.id).toBe('contour');
    expect(contourPlugin.kind).toBe('Contour');
    expect(contourPlugin.defaultTrigger).toBe('beat');
  });

  it('preload sets preloadState to "ready" on success', async () => {
    const bitmap = makeMockImageBitmap();
    const ctrl = new AbortController();
    await contourPlugin.preload(bitmap, ctrl.signal);
    expect(contourPlugin.preloadState).toBe('ready');
  });

  it('render is a no-op before preload completes (cache miss)', () => {
    const rc = makeRenderContext({ imageBitmap: makeMockImageBitmap(50, 50) });
    contourPlugin.render(rc, contourPlugin.getDefaultParams());
    const calls = (rc.ctx as unknown as { __calls: Array<{ method: string }> }).__calls;
    expect(calls.find((c) => c.method === 'stroke')).toBeUndefined();
  });

  it('paramSchema has threshold + color', () => {
    expect(contourPlugin.paramSchema.threshold.kind).toBe('slider');
    expect(contourPlugin.paramSchema.color.kind).toBe('color');
  });
});
