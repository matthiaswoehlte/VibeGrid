import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rgbSplitPlugin, _testOnly_rgbOffByClip } from '@/lib/fx/rgb-split';
import { makeRenderContext, makeMockCtx } from './_helpers';

interface CtxCalls {
  __calls: Array<{ method: string; args: unknown[] }>;
}

// Stub OffscreenCanvas for jsdom — each instance returns a fresh recorded ctx.
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
// @ts-expect-error — installing stub for jsdom
globalThis.OffscreenCanvas = StubOffscreen;

describe('rgbSplitPlugin', () => {
  beforeEach(() => {
    _testOnly_rgbOffByClip.clear();
  });

  it('has the expected plugin shape', () => {
    expect(rgbSplitPlugin.id).toBe('rgb-split');
    expect(rgbSplitPlugin.kind).toBe('RGBSplit');
    expect(rgbSplitPlugin.defaultTrigger).toBe('beat');
    expect(rgbSplitPlugin.paramSchema.offset.kind).toBe('slider');
  });

  it('flowMode → no draw on main canvas', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: true });
    rgbSplitPlugin.render(rc, rgbSplitPlugin.getDefaultParams());
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(0);
  });

  it('beatPhase=0 → draws bitmap + 2 channel offscreens on main canvas (3 drawImage calls)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    rgbSplitPlugin.render(rc, rgbSplitPlugin.getDefaultParams());
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    // 1: original bitmap, 2: red offscreen, 3: blue offscreen
    expect(draws.length).toBe(3);
  });

  it('env=0 (beatPhase well past decay) → no draws', () => {
    const rc = makeRenderContext({ beatPhase: 1.0, flowMode: false });
    rgbSplitPlugin.render(rc, { ...rgbSplitPlugin.getDefaultParams(), decay: 0.1 });
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(0);
  });

  it('save/restore discipline — final composite is wrapped', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    rgbSplitPlugin.render(rc, rgbSplitPlugin.getDefaultParams());
    const calls = (rc.ctx as unknown as CtxCalls).__calls;
    const saves = calls.filter((c) => c.method === 'save').length;
    const restores = calls.filter((c) => c.method === 'restore').length;
    expect(saves).toBe(restores);
    expect(saves).toBeGreaterThan(0);
  });

  it('no imageBitmap → early return (Kategorie-A guard)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false, imageBitmap: undefined });
    rgbSplitPlugin.render(rc, rgbSplitPlugin.getDefaultParams());
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(0);
  });

  it('caches offscreens per clipId across two renders', () => {
    const rc1 = makeRenderContext({ beatPhase: 0, flowMode: false, clipId: 'clip-A' });
    rgbSplitPlugin.render(rc1, rgbSplitPlugin.getDefaultParams());
    expect(_testOnly_rgbOffByClip.size).toBe(1);
    expect(_testOnly_rgbOffByClip.has('clip-A')).toBe(true);

    const rc2 = makeRenderContext({ beatPhase: 0, flowMode: false, clipId: 'clip-A' });
    rgbSplitPlugin.render(rc2, rgbSplitPlugin.getDefaultParams());
    // Still 1 — same clipId reused the cached offscreens.
    expect(_testOnly_rgbOffByClip.size).toBe(1);
  });

  it('dispose() clears the per-clip cache', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false, clipId: 'clip-X' });
    rgbSplitPlugin.render(rc, rgbSplitPlugin.getDefaultParams());
    expect(_testOnly_rgbOffByClip.size).toBeGreaterThan(0);
    rgbSplitPlugin.dispose?.();
    expect(_testOnly_rgbOffByClip.size).toBe(0);
  });

  it('offset=0 → channel shift is zero (no visible split)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    rgbSplitPlugin.render(rc, { ...rgbSplitPlugin.getDefaultParams(), offset: 0 });
    // Still draws (offset=0 just means both channels are co-located) but
    // the visual result is the original — caller-visible state is the
    // same number of drawImage calls (3).
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(3);
  });

  // --- beatSync tests (Plan 8g) ---

  it('beatSync=1 decays with beat phase (default behavior)', () => {
    // beatPhase=0.5 with default decay=0.15: env = 1 - 0.5/0.15 = -2.33 → 0 → no draw.
    const rc = makeRenderContext({ beatPhase: 0.5, flowMode: false });
    rgbSplitPlugin.render(rc, { ...rgbSplitPlugin.getDefaultParams(), beatSync: 1 });
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(0);
  });

  it('beatSync=0 runs at full intensity (env=1.0) regardless of beatPhase', () => {
    // beatPhase=0.99 with decay=0.1 would normally skip; beatSync=0 pins env=1.0.
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: false });
    rgbSplitPlugin.render(rc, {
      ...rgbSplitPlugin.getDefaultParams(),
      beatSync: 0,
      decay: 0.1
    });
    // Original bitmap + 2 channel offscreens → 3 drawImage calls on main canvas.
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(3);
  });
});
