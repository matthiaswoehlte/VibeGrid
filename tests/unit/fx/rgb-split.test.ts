import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRenderContext } from '../renderer/_helpers';

vi.mock('@/lib/renderer/webgl/pipeline', () => ({
  renderGlFx: vi.fn()
}));

import { rgbSplitPlugin } from '@/lib/fx/rgb-split';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';

const mockedRenderGlFx = vi.mocked(renderGlFx);

const baseParams = {
  offset: 0.004,
  decay: 0.15,
  intensity: 0.6,
  beatSync: 1
};

describe('rgbSplitPlugin (WebGL2, Plan 11a)', () => {
  beforeEach(() => {
    mockedRenderGlFx.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- plugin shape (kept verbatim from pre-migration test) ---

  it('has the expected plugin shape', () => {
    expect(rgbSplitPlugin.id).toBe('rgb-split');
    expect(rgbSplitPlugin.kind).toBe('RGBSplit');
    expect(rgbSplitPlugin.defaultTrigger).toBe('beat');
    expect(rgbSplitPlugin.paramSchema.offset.kind).toBe('slider');
  });

  it('default params match the schema', () => {
    expect(rgbSplitPlugin.getDefaultParams()).toEqual(baseParams);
  });

  // --- migration regression: no Canvas-2D fallback, only renderGlFx ---

  it('on beat (env > 0.01) → calls renderGlFx exactly once (no Canvas-2D fallback)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    rgbSplitPlugin.render(rc, baseParams);
    expect(mockedRenderGlFx).toHaveBeenCalledTimes(1);
  });

  it('flowMode=true → skips renderGlFx (no beat-pulse in Flow Mode)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: true });
    rgbSplitPlugin.render(rc, baseParams);
    expect(mockedRenderGlFx).not.toHaveBeenCalled();
  });

  it('env < 0.01 (beatPhase past decay) → skips renderGlFx', () => {
    // beatPhase=0.99, decay=0.15 → env = 1 - 0.99/0.15 = -5.6 → clamped to 0.
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: false });
    rgbSplitPlugin.render(rc, baseParams);
    expect(mockedRenderGlFx).not.toHaveBeenCalled();
  });

  it('no imageBitmap → early return (Kategorie-A guard preserved)', () => {
    const rc = makeRenderContext({
      beatPhase: 0,
      flowMode: false,
      imageBitmap: undefined
    });
    rgbSplitPlugin.render(rc, baseParams);
    expect(mockedRenderGlFx).not.toHaveBeenCalled();
  });

  it('has no dispose() — migration removed per-clip state', () => {
    expect(rgbSplitPlugin.dispose).toBeUndefined();
  });

  // --- uniform forwarding ---

  it('forwards exactly the 3 FX uniforms (u_shift, u_env, u_intensity)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    rgbSplitPlugin.render(rc, baseParams);
    const args = mockedRenderGlFx.mock.calls[0][0];
    expect(args.uniformNames).toEqual(['u_shift', 'u_env', 'u_intensity']);
  });

  it('u_shift = params.offset (UV-direct, no pixel→UV conversion)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    rgbSplitPlugin.render(rc, { ...baseParams, offset: 0.012 });
    const u = mockedRenderGlFx.mock.calls[0][0].uniforms;
    expect(u.u_shift).toBe(0.012);
  });

  it('u_intensity = params.intensity (behavior-drift guard: param survives migration)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    rgbSplitPlugin.render(rc, { ...baseParams, intensity: 0.42 });
    const u = mockedRenderGlFx.mock.calls[0][0].uniforms;
    expect(u.u_intensity).toBeCloseTo(0.42, 5);
  });

  it('default source resolves to bitmap (omitting `source` in args)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    rgbSplitPlugin.render(rc, baseParams);
    const args = mockedRenderGlFx.mock.calls[0][0];
    // RGBSplit sampelt das Original-Bitmap. We deliberately don't pass
    // `source` — relying on the pipeline default of 'bitmap'.
    expect(args.source).toBeUndefined();
  });

  // --- env / beatSync semantics (Plan 8g) ---

  it('beatSync=1, beatPhase=0 → u_env = 1.0', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    rgbSplitPlugin.render(rc, { ...baseParams, beatSync: 1 });
    const u = mockedRenderGlFx.mock.calls[0][0].uniforms;
    expect(u.u_env).toBeCloseTo(1.0, 5);
  });

  it('beatSync=1 decays with beat phase (env = 1 - beatPhase/decay, clamped ≥ 0)', () => {
    // beatPhase=0.075, decay=0.15 → env = 1 - 0.5 = 0.5
    const rc = makeRenderContext({ beatPhase: 0.075, flowMode: false });
    rgbSplitPlugin.render(rc, { ...baseParams, beatSync: 1, decay: 0.15 });
    const u = mockedRenderGlFx.mock.calls[0][0].uniforms;
    expect(u.u_env as number).toBeCloseTo(0.5, 5);
  });

  it('beatSync=0 pins u_env=1.0 regardless of beatPhase (Flow-Mode-like)', () => {
    // Without beatSync=0 this would be env ≈ 0 and skipped entirely.
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: false });
    rgbSplitPlugin.render(rc, { ...baseParams, beatSync: 0, decay: 0.1 });
    expect(mockedRenderGlFx).toHaveBeenCalledTimes(1);
    const u = mockedRenderGlFx.mock.calls[0][0].uniforms;
    expect(u.u_env).toBe(1.0);
  });
});
