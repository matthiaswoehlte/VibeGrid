import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRenderContext } from '../renderer/_helpers';

vi.mock('@/lib/renderer/webgl/pipeline', () => ({
  renderGlFx: vi.fn()
}));

import { glitchSlicePlugin } from '@/lib/fx/glitch-slice';
import { GLITCH_SLICE_FRAG_SRC } from '@/lib/renderer/webgl/programs/glitch-slice';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';

const mockedRenderGlFx = vi.mocked(renderGlFx);

const baseParams = {
  sliceCount: 4,
  maxOffset: 0.01,
  decay: 0.08,
  seed: 42,
  axis: 'h',
  beatSync: true
};

describe('glitchSlicePlugin (WebGL2, Plan 11b)', () => {
  beforeEach(() => {
    mockedRenderGlFx.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- plugin shape (preserved from pre-migration test) ---

  it('has the expected plugin shape', () => {
    expect(glitchSlicePlugin.id).toBe('glitch-slice');
    expect(glitchSlicePlugin.kind).toBe('GlitchSlice');
    expect(glitchSlicePlugin.defaultTrigger).toBe('beat');
    expect(glitchSlicePlugin.paramSchema.axis.kind).toBe('select');
  });

  it('default params match the schema', () => {
    expect(glitchSlicePlugin.getDefaultParams()).toEqual(baseParams);
  });

  it('has no dispose() — migration removed per-clip state', () => {
    expect(glitchSlicePlugin.dispose).toBeUndefined();
  });

  it('supportsSubdivision: true (Plan 9c preserved through migration)', () => {
    expect(glitchSlicePlugin.supportsSubdivision).toBe(true);
  });

  // --- shader source contract ---

  it('shader uses standard u_contain rect mapping (no aspect-stretch)', () => {
    // Pattern enforced by all WebGL FX in this repo. Without it the
    // shader would stretch the bitmap over the full canvas regardless
    // of source aspect ratio.
    expect(GLITCH_SLICE_FRAG_SRC).toMatch(/u_contain\.xy\s*\+\s*v_texCoord\s*\*\s*u_contain\.zw/);
  });

  // --- migration regression: no Canvas-2D fallback, only renderGlFx ---

  it('on beat (env > 0.01) → calls renderGlFx exactly once (no Canvas-2D fallback)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    glitchSlicePlugin.render(rc, baseParams);
    expect(mockedRenderGlFx).toHaveBeenCalledTimes(1);
  });

  it('flowMode=true → skips renderGlFx (no beat-pulse in Flow Mode)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: true });
    glitchSlicePlugin.render(rc, baseParams);
    expect(mockedRenderGlFx).not.toHaveBeenCalled();
  });

  it('env < 0.01 (beatPhase past decay) → skips renderGlFx', () => {
    // beatPhase=0.5, decay=0.08 → env = 1 - 0.5/0.08 = -5.25 → clamped to 0.
    const rc = makeRenderContext({ beatPhase: 0.5, flowMode: false });
    glitchSlicePlugin.render(rc, baseParams);
    expect(mockedRenderGlFx).not.toHaveBeenCalled();
  });

  it('no imageBitmap → early return (Kategorie-A guard preserved)', () => {
    const rc = makeRenderContext({
      beatPhase: 0,
      flowMode: false,
      imageBitmap: undefined
    });
    glitchSlicePlugin.render(rc, baseParams);
    expect(mockedRenderGlFx).not.toHaveBeenCalled();
  });

  // --- uniform forwarding ---

  it('forwards exactly the 5 FX uniforms (u_sliceCount, u_maxOffset, u_env, u_seed, u_axis)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    glitchSlicePlugin.render(rc, baseParams);
    const args = mockedRenderGlFx.mock.calls[0][0];
    expect(args.uniformNames).toEqual([
      'u_sliceCount',
      'u_maxOffset',
      'u_env',
      'u_seed',
      'u_axis'
    ]);
  });

  it('u_sliceCount = Math.round(params.sliceCount) — schema-int safety', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    glitchSlicePlugin.render(rc, { ...baseParams, sliceCount: 4 });
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_sliceCount).toBe(4);
    mockedRenderGlFx.mockReset();
    glitchSlicePlugin.render(rc, { ...baseParams, sliceCount: 6.7 });
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_sliceCount).toBe(7);
  });

  it('u_maxOffset = params.maxOffset (UV-direct, no pixel→UV conversion)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    glitchSlicePlugin.render(rc, { ...baseParams, maxOffset: 0.025 });
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_maxOffset).toBeCloseTo(0.025, 5);
  });

  it('default source resolves to bitmap (omitting `source` in args)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    glitchSlicePlugin.render(rc, baseParams);
    const args = mockedRenderGlFx.mock.calls[0][0];
    expect(args.source).toBeUndefined();
  });

  // --- env / beatSync semantics (Plan 8g) ---

  it('beatSync=true, beatPhase=0 → u_env = 1.0', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    glitchSlicePlugin.render(rc, { ...baseParams, beatSync: true });
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_env).toBeCloseTo(1.0, 5);
  });

  it('beatSync=true decays with beat phase (env = 1 - subdividedBeatPhase/decay)', () => {
    // beatPhase=0.04, decay=0.08 → env = 1 - 0.04/0.08 = 0.5
    const rc = makeRenderContext({ beatPhase: 0.04, flowMode: false });
    glitchSlicePlugin.render(rc, { ...baseParams, beatSync: true, decay: 0.08 });
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_env as number).toBeCloseTo(0.5, 5);
  });

  it('beatSync=false pins u_env=1.0 regardless of beatPhase (Plan-9c-Verhalten)', () => {
    // beatPhase=0.99 would normally clamp env to 0 → skip. With beatSync=false,
    // env is pinned to 1.0 and the call fires.
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: false });
    glitchSlicePlugin.render(rc, { ...baseParams, beatSync: false, decay: 0.1 });
    expect(mockedRenderGlFx).toHaveBeenCalledTimes(1);
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_env).toBe(1.0);
  });

  // --- Architekt-C: u_seed composition ---

  it('u_seed = params.seed + rc.beatIndex (Architekt-C, matches mulberry32 input)', () => {
    const rc1 = makeRenderContext({ beatPhase: 0, beatIndex: 0, flowMode: false });
    glitchSlicePlugin.render(rc1, { ...baseParams, seed: 42 });
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_seed).toBe(42);

    mockedRenderGlFx.mockReset();
    const rc2 = makeRenderContext({ beatPhase: 0, beatIndex: 1, flowMode: false });
    glitchSlicePlugin.render(rc2, { ...baseParams, seed: 42 });
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_seed).toBe(43);

    mockedRenderGlFx.mockReset();
    const rc3 = makeRenderContext({ beatPhase: 0, beatIndex: 5, flowMode: false });
    glitchSlicePlugin.render(rc3, { ...baseParams, seed: 100 });
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_seed).toBe(105);
  });

  // --- Architekt-B: u_axis ---

  it('u_axis = 0.0 at params.axis="h" (Architekt-B horizontal mode)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    glitchSlicePlugin.render(rc, { ...baseParams, axis: 'h' });
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_axis).toBe(0.0);
  });

  it('u_axis = 1.0 at params.axis="v" (Architekt-B vertical mode)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    glitchSlicePlugin.render(rc, { ...baseParams, axis: 'v' });
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_axis).toBe(1.0);
  });

  // --- Plan 9c subdivision cross-check ---

  it('9c-subdivision: subdivision=4× with beatPhase=0.025 pushes env to 0 → skip', () => {
    // subdividedBeatPhase = (0.025 * 4) % 1 = 0.1
    // env = 1 - 0.1/0.08 = -0.25 → clamped to 0 → skip.
    const rc = makeRenderContext({
      beatPhase: 0.025,
      subdividedBeatPhase: 0.1,
      subdivision: '4×',
      flowMode: false
    });
    glitchSlicePlugin.render(rc, { ...baseParams, decay: 0.08 });
    expect(mockedRenderGlFx).not.toHaveBeenCalled();
  });

  it('9c-subdivision: subdivision=1× has no envelope-shape effect vs. baseline', () => {
    // subdividedBeatPhase == beatPhase when subdivision is the default 1×.
    const rc = makeRenderContext({
      beatPhase: 0.04,
      subdividedBeatPhase: 0.04,
      subdivision: '1×',
      flowMode: false
    });
    glitchSlicePlugin.render(rc, { ...baseParams, beatSync: true, decay: 0.08 });
    // env = 1 - 0.04/0.08 = 0.5 — identical to pre-9c.
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_env as number).toBeCloseTo(0.5, 5);
  });
});
