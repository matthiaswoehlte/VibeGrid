import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRenderContext } from '../renderer/_helpers';

vi.mock('@/lib/renderer/webgl/pipeline', () => ({
  renderGlFx: vi.fn()
}));

import { edgeGlowPlugin, _hexToRgba01 } from '@/lib/fx/edge-glow';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';

const mockedRenderGlFx = vi.mocked(renderGlFx);

describe('edgeGlowPlugin', () => {
  beforeEach(() => {
    mockedRenderGlFx.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('default params match the schema', () => {
    expect(edgeGlowPlugin.getDefaultParams()).toEqual({
      threshold: 0.10,
      color: '#00e5ff',
      glowAmount: 0.5,
      bgOpacity: 0.3,
      intensity: 1.0,
      decay: 0.25,
      beatSync: 1,
    });
  });

  it('kind is EdgeGlow and defaultTrigger is beat', () => {
    expect(edgeGlowPlugin.kind).toBe('EdgeGlow');
    expect(edgeGlowPlugin.defaultTrigger).toBe('beat');
  });

  it('skips renderGlFx when env < 0.01 (Beat Mode, past decay)', () => {
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: false });
    edgeGlowPlugin.render(rc, {
      threshold: 0.1, color: '#00e5ff', glowAmount: 0.5,
      bgOpacity: 0.3, intensity: 1.0, decay: 0.25, beatSync: 1,
    });
    expect(mockedRenderGlFx).not.toHaveBeenCalled();
  });

  it('runs in Flow Mode even at beatPhase=0.99 (env pinned to 1)', () => {
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: true });
    edgeGlowPlugin.render(rc, {
      threshold: 0.1, color: '#00e5ff', glowAmount: 0.5,
      bgOpacity: 0.3, intensity: 1.0, decay: 0.25, beatSync: 1,
    });
    expect(mockedRenderGlFx).toHaveBeenCalledTimes(1);
    const args = mockedRenderGlFx.mock.calls[0][0];
    expect(args.uniforms.u_intensity).toBe(1.0);
  });

  it("uses source: 'canvas' so it samples composed frame", () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    edgeGlowPlugin.render(rc, {
      threshold: 0.1, color: '#00e5ff', glowAmount: 0.5,
      bgOpacity: 0.3, intensity: 1.0, decay: 0.25, beatSync: 1,
    });
    expect(mockedRenderGlFx.mock.calls[0][0].source).toBe('canvas');
  });

  it('passes all 6 uniforms + u_resolution from canvas dimensions', () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    edgeGlowPlugin.render(rc, {
      threshold: 0.15, color: '#ff8800', glowAmount: 0.8,
      bgOpacity: 0.5, intensity: 0.9, decay: 0.3, beatSync: 1,
    });
    const args = mockedRenderGlFx.mock.calls[0][0];
    expect(args.uniformNames).toEqual([
      'u_resolution', 'u_threshold', 'u_color',
      'u_glow', 'u_bg_opacity', 'u_intensity'
    ]);
    expect(args.uniforms.u_threshold).toBe(0.15);
    expect(args.uniforms.u_glow).toBe(0.8);
    expect(args.uniforms.u_bg_opacity).toBe(0.5);
    // intensity = params.intensity * env (env=1 at beatPhase=0)
    expect(args.uniforms.u_intensity).toBe(0.9);
    // color: '#ff8800' → (1, 0.533, 0, 1) approx
    const col = args.uniforms.u_color as readonly number[];
    expect(col[0]).toBeCloseTo(1, 5);
    expect(col[1]).toBeCloseTo(0x88 / 255, 5);
    expect(col[2]).toBeCloseTo(0, 5);
    expect(col[3]).toBe(1);
    // u_resolution = (canvas.width, canvas.height) from helpers = (800, 450)
    expect(args.uniforms.u_resolution).toEqual([800, 450]);
  });

  it('hexToRgba01 parses #rrggbb correctly', () => {
    expect(_hexToRgba01('#00e5ff')).toEqual([0, 0xe5 / 255, 1, 1]);
    expect(_hexToRgba01('ff0000')).toEqual([1, 0, 0, 1]);
    expect(_hexToRgba01('#000000')).toEqual([0, 0, 0, 1]);
    expect(_hexToRgba01('#ffffff')).toEqual([1, 1, 1, 1]);
  });

  it('hexToRgba01 falls back to white on invalid input', () => {
    expect(_hexToRgba01('not a color')).toEqual([1, 1, 1, 1]);
    expect(_hexToRgba01('')).toEqual([1, 1, 1, 1]);
    expect(_hexToRgba01('#abc')).toEqual([1, 1, 1, 1]); // 3-digit not supported
  });

  // --- beatSync tests (Plan 8g, Template B) ---

  it('beatSync=1 decays with beat phase (Beat Mode)', () => {
    // beatPhase=0.99, decay=0.25: env = 1 - 0.99/0.25 = -2.96 → 0 → skips (env < 0.01).
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: false });
    edgeGlowPlugin.render(rc, {
      threshold: 0.1, color: '#00e5ff', glowAmount: 0.5,
      bgOpacity: 0.3, intensity: 1.0, decay: 0.25, beatSync: 1,
    });
    expect(mockedRenderGlFx).not.toHaveBeenCalled();
  });

  it('beatSync=0 runs constant (env=1.0) in Beat Mode regardless of beatPhase', () => {
    // beatPhase=0.99 would normally skip with beatSync=1; with beatSync=0, env=1.0.
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: false });
    edgeGlowPlugin.render(rc, {
      threshold: 0.1, color: '#00e5ff', glowAmount: 0.5,
      bgOpacity: 0.3, intensity: 1.0, decay: 0.1, beatSync: 0,
    });
    expect(mockedRenderGlFx).toHaveBeenCalledTimes(1);
    const args = mockedRenderGlFx.mock.calls[0][0];
    // u_intensity = params.intensity * env = 1.0 * 1.0 = 1.0
    expect(args.uniforms.u_intensity).toBe(1.0);
  });

  it('beatSync=0 in Beat Mode produces the same u_intensity as flowMode=true (both pin env=1.0)', () => {
    // Both paths yield isConstant=true → env=1.0 → u_intensity = intensity * 1.0
    const params = {
      threshold: 0.1, color: '#00e5ff', glowAmount: 0.5,
      bgOpacity: 0.3, intensity: 1.0, decay: 0.25, beatSync: 0,
    };

    const rcBeatMode = makeRenderContext({ beatPhase: 0.5, flowMode: false });
    edgeGlowPlugin.render(rcBeatMode, params);
    const beatModeIntensity = mockedRenderGlFx.mock.calls[0][0].uniforms.u_intensity;
    mockedRenderGlFx.mockClear();

    edgeGlowPlugin.render(
      makeRenderContext({ beatPhase: 0.5, flowMode: true }),
      { ...params, beatSync: 1 }
    );
    const flowModeIntensity = mockedRenderGlFx.mock.calls[0][0].uniforms.u_intensity;

    expect(beatModeIntensity).toBe(flowModeIntensity);
  });
});
