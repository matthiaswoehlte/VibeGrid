import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  filmGrainBurstPlugin,
  _testOnly_grainOffByClip
} from '@/lib/fx/film-grain-burst';
import { makeRenderContext } from './_helpers';

interface CtxCalls {
  __calls: Array<{ method: string; args: unknown[] }>;
}

// Stub OffscreenCanvas — must support createImageData + putImageData.
class StubOffscreen {
  width: number;
  height: number;
  lastImageDataWidth = 0;
  lastImageDataHeight = 0;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext(): CanvasRenderingContext2D {
    const self = this;
    return {
      createImageData: (w: number, h: number) => {
        self.lastImageDataWidth = w;
        self.lastImageDataHeight = h;
        return {
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h
        } as ImageData;
      },
      putImageData: vi.fn(),
      drawImage: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      globalCompositeOperation: 'source-over',
      globalAlpha: 1,
      fillStyle: '#000'
    } as unknown as CanvasRenderingContext2D;
  }
}
// @ts-expect-error — install for jsdom
globalThis.OffscreenCanvas = StubOffscreen;

describe('filmGrainBurstPlugin', () => {
  beforeEach(() => {
    _testOnly_grainOffByClip.clear();
  });

  it('has the expected plugin shape', () => {
    expect(filmGrainBurstPlugin.id).toBe('film-grain-burst');
    expect(filmGrainBurstPlugin.kind).toBe('FilmGrainBurst');
    expect(filmGrainBurstPlugin.paramSchema.colorMode.kind).toBe('select');
  });

  it('flowMode → no draw', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: true });
    filmGrainBurstPlugin.render(rc, filmGrainBurstPlugin.getDefaultParams());
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(0);
  });

  it('beatPhase=0 → main-canvas drawImage of the offscreen', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    filmGrainBurstPlugin.render(rc, filmGrainBurstPlugin.getDefaultParams());
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(1);
  });

  it('beatPhase past decay → no draw', () => {
    const rc = makeRenderContext({ beatPhase: 0.9, flowMode: false });
    filmGrainBurstPlugin.render(rc, {
      ...filmGrainBurstPlugin.getDefaultParams(),
      decay: 0.1
    });
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(0);
  });

  it('grainSize=2 → offscreen allocated at half resolution (performance path)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false, width: 1000, height: 500 });
    filmGrainBurstPlugin.render(rc, {
      ...filmGrainBurstPlugin.getDefaultParams(),
      grainSize: 2
    });
    const off = _testOnly_grainOffByClip.get(rc.clipId);
    expect(off).toBeDefined();
    expect(off!.width).toBe(500); // 1000 / 2
    expect(off!.height).toBe(250);
  });

  it('grainSize=1 → offscreen matches canvas resolution', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false, width: 800, height: 450 });
    filmGrainBurstPlugin.render(rc, filmGrainBurstPlugin.getDefaultParams());
    const off = _testOnly_grainOffByClip.get(rc.clipId);
    expect(off).toBeDefined();
    expect(off!.width).toBe(800);
    expect(off!.height).toBe(450);
  });

  it('dispose() clears the per-clip cache', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    filmGrainBurstPlugin.render(rc, filmGrainBurstPlugin.getDefaultParams());
    expect(_testOnly_grainOffByClip.size).toBeGreaterThan(0);
    filmGrainBurstPlugin.dispose?.();
    expect(_testOnly_grainOffByClip.size).toBe(0);
  });

  it('save/restore discipline', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    filmGrainBurstPlugin.render(rc, filmGrainBurstPlugin.getDefaultParams());
    const calls = (rc.ctx as unknown as CtxCalls).__calls;
    const saves = calls.filter((c) => c.method === 'save').length;
    const restores = calls.filter((c) => c.method === 'restore').length;
    expect(saves).toBe(restores);
    expect(saves).toBe(1);
  });
});
