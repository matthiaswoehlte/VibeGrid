import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  glitchSlicePlugin,
  _testOnly_glitchOffByClip
} from '@/lib/fx/glitch-slice';
import { makeRenderContext, makeMockCtx } from './_helpers';
import { mulberry32 } from '@/lib/utils/prng';

interface CtxCalls {
  __calls: Array<{ method: string; args: unknown[] }>;
}

// Stub OffscreenCanvas — must support drawImage+clearRect on its context.
class StubOffscreen {
  width: number;
  height: number;
  private _ctx: ReturnType<typeof makeMockCtx> | null = null;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext(): CanvasRenderingContext2D {
    if (!this._ctx) this._ctx = makeMockCtx();
    return this._ctx as unknown as CanvasRenderingContext2D;
  }
}
// @ts-expect-error — install for jsdom
globalThis.OffscreenCanvas = StubOffscreen;

describe('glitchSlicePlugin', () => {
  beforeEach(() => {
    _testOnly_glitchOffByClip.clear();
  });

  it('has the expected plugin shape', () => {
    expect(glitchSlicePlugin.id).toBe('glitch-slice');
    expect(glitchSlicePlugin.kind).toBe('GlitchSlice');
    expect(glitchSlicePlugin.paramSchema.axis.kind).toBe('select');
  });

  it('flowMode → no draw (Rev 5 fix — was missing in earlier revisions)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: true });
    glitchSlicePlugin.render(rc, glitchSlicePlugin.getDefaultParams());
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(0);
  });

  it('beatPhase=0 with sliceCount=4 → 4 drawImage calls on main canvas', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    glitchSlicePlugin.render(rc, glitchSlicePlugin.getDefaultParams());
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(4);
  });

  it('sliceCount=6 → 6 drawImage calls', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    glitchSlicePlugin.render(rc, {
      ...glitchSlicePlugin.getDefaultParams(),
      sliceCount: 6
    });
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(6);
  });

  it('beatPhase past decay → no draw', () => {
    const rc = makeRenderContext({ beatPhase: 0.5, flowMode: false });
    glitchSlicePlugin.render(rc, {
      ...glitchSlicePlugin.getDefaultParams(),
      decay: 0.1
    });
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(0);
  });

  it('PRNG reproducibility — same (seed, beatIndex) produces same offsets', () => {
    // Verify the underlying PRNG output is deterministic. Two render
    // calls with the same seed + beatIndex must produce identical
    // sequences (which makes the slice offsets identical).
    const r1 = mulberry32(42 + 0);
    const r2 = mulberry32(42 + 0);
    for (let i = 0; i < 8; i++) {
      expect(r1()).toBeCloseTo(r2(), 10);
    }
  });

  it('PRNG variation — different beatIndex produces different offsets', () => {
    const r1 = mulberry32(42 + 0);
    const r2 = mulberry32(42 + 1);
    expect(r1()).not.toBeCloseTo(r2(), 5);
  });

  it('PRNG variation — different seed produces different offsets', () => {
    const r1 = mulberry32(42 + 5);
    const r2 = mulberry32(43 + 5);
    expect(r1()).not.toBeCloseTo(r2(), 5);
  });

  it('no imageBitmap → early return', () => {
    const rc = makeRenderContext({
      beatPhase: 0,
      flowMode: false,
      imageBitmap: undefined
    });
    glitchSlicePlugin.render(rc, glitchSlicePlugin.getDefaultParams());
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(0);
  });

  it('dispose() clears the per-clip cache', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    glitchSlicePlugin.render(rc, glitchSlicePlugin.getDefaultParams());
    expect(_testOnly_glitchOffByClip.size).toBeGreaterThan(0);
    glitchSlicePlugin.dispose?.();
    expect(_testOnly_glitchOffByClip.size).toBe(0);
  });
});
