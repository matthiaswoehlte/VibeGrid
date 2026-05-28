import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRenderContext } from '../renderer/_helpers';

vi.mock('@/lib/renderer/webgl/pipeline', () => ({
  renderGlFx: vi.fn()
}));

import { retroVhsPlugin } from '@/lib/fx/retro-vhs';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';

const mockedRenderGlFx = vi.mocked(renderGlFx);

describe('retroVhsPlugin', () => {
  beforeEach(() => {
    mockedRenderGlFx.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips renderGlFx when env < 0.01 in Beat Mode (envelope decayed)', () => {
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: false });
    retroVhsPlugin.render(rc, {
      ...retroVhsPlugin.getDefaultParams(),
      decay: 0.1 // env = 1 - 0.99/0.1 = -8.9 → clamped to 0
    });
    expect(mockedRenderGlFx).not.toHaveBeenCalled();
  });

  it('Flow Mode renders even at high beatPhase (Scanlines persistent)', () => {
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: true });
    retroVhsPlugin.render(rc, retroVhsPlugin.getDefaultParams());
    expect(mockedRenderGlFx).toHaveBeenCalledTimes(1);
    const args = mockedRenderGlFx.mock.calls[0][0];
    expect(args.uniforms.u_env).toBe(1.0);
  });

  it('Flow Mode forces u_dropout_intensity=0 (no beat-synchronous dropout)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: true });
    retroVhsPlugin.render(rc, {
      ...retroVhsPlugin.getDefaultParams(),
      dropoutIntensity: 0.8 // user-set value would normally be respected
    });
    const args = mockedRenderGlFx.mock.calls[0][0];
    expect(args.uniforms.u_dropout_intensity).toBe(0);
  });

  it('Flow Mode forces u_warp_intensity=0 (no beat warp)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: true });
    retroVhsPlugin.render(rc, {
      ...retroVhsPlugin.getDefaultParams(),
      warpIntensity: 0.01
    });
    const args = mockedRenderGlFx.mock.calls[0][0];
    expect(args.uniforms.u_warp_intensity).toBe(0);
  });

  it('passes u_seed through unchanged (deterministic dropout pattern)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    retroVhsPlugin.render(rc, {
      ...retroVhsPlugin.getDefaultParams(),
      seed: 42
    });
    const args = mockedRenderGlFx.mock.calls[0][0];
    expect(args.uniforms.u_seed).toBe(42);
  });

  it('passes u_beat_index through for per-beat seed mixing', () => {
    const rc = makeRenderContext({
      beatPhase: 0,
      beatIndex: 17,
      flowMode: false
    });
    retroVhsPlugin.render(rc, retroVhsPlugin.getDefaultParams());
    const args = mockedRenderGlFx.mock.calls[0][0];
    expect(args.uniforms.u_beat_index).toBe(17);
  });

  it('default params match the schema defaults', () => {
    const defaults = retroVhsPlugin.getDefaultParams();
    expect(defaults).toEqual({
      scanlineOpacity: 0.25,
      scanlineSpacing: 2,
      colorFringe: 0.003,
      dropoutIntensity: 0.4,
      dropoutCount: 3,
      warpIntensity: 0.004,
      decay: 0.3,
      seed: 7,
      beatSync: 1,
    });
  });

  it('Beat Mode includes all 10 FX uniforms in renderGlFx call', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    retroVhsPlugin.render(rc, retroVhsPlugin.getDefaultParams());
    const args = mockedRenderGlFx.mock.calls[0][0];
    expect(args.uniformNames).toEqual([
      'u_env',
      'u_beat_phase',
      'u_beat_index',
      'u_scanline_opacity',
      'u_scanline_spacing',
      'u_color_fringe',
      'u_dropout_intensity',
      'u_dropout_count',
      'u_warp_intensity',
      'u_seed'
    ]);
  });
});
