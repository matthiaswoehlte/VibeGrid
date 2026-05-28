import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRenderContext } from '../renderer/_helpers';

vi.mock('@/lib/renderer/webgl/pipeline', () => ({
  renderGlFx: vi.fn()
}));

import { contourGlPlugin } from '@/lib/fx/contour-gl';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';

const mockedRenderGlFx = vi.mocked(renderGlFx);

const baseParams = {
  color: '#a86bff',
  threshold: 0.15,
  lineWidth: 1.0,
  stippleSize: 0,
  sweepDirection: 'all' as const,
  sweepSpeed: 1,
  intensity: 1.0,
  decay: 0.25,
  beatSync: 1,
};

describe('contourGlPlugin', () => {
  beforeEach(() => {
    mockedRenderGlFx.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('default params match the schema', () => {
    expect(contourGlPlugin.getDefaultParams()).toEqual(baseParams);
  });

  it('kind is ContourGL, defaultTrigger is beat', () => {
    expect(contourGlPlugin.kind).toBe('ContourGL');
    expect(contourGlPlugin.defaultTrigger).toBe('beat');
  });

  it('paramSchema keys match getDefaultParams keys exactly', () => {
    const schemaKeys = Object.keys(contourGlPlugin.paramSchema).sort();
    const defaultKeys = Object.keys(contourGlPlugin.getDefaultParams()).sort();
    expect(defaultKeys).toEqual(schemaKeys);
  });

  // --- envelope behavior (mirrors Edge Glow) ---

  it('skips renderGlFx when env < 0.01 (Beat Mode, past decay)', () => {
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: false });
    contourGlPlugin.render(rc, baseParams);
    expect(mockedRenderGlFx).not.toHaveBeenCalled();
  });

  it('runs in Flow Mode even at beatPhase=0.99 (env pinned to 1)', () => {
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: true });
    contourGlPlugin.render(rc, baseParams);
    expect(mockedRenderGlFx).toHaveBeenCalledTimes(1);
    const args = mockedRenderGlFx.mock.calls[0][0];
    expect(args.uniforms.u_intensity).toBe(1.0);
  });

  it("uses source: 'canvas' so it samples the composed frame", () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    contourGlPlugin.render(rc, baseParams);
    expect(mockedRenderGlFx.mock.calls[0][0].source).toBe('canvas');
  });

  it('beatSync=0 pins env=1.0 in Beat Mode regardless of beatPhase', () => {
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: false });
    contourGlPlugin.render(rc, { ...baseParams, beatSync: 0 });
    expect(mockedRenderGlFx).toHaveBeenCalledTimes(1);
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_intensity).toBe(1.0);
  });

  // --- uniform forwarding ---

  it('passes all 9 named uniforms (excluding standard u_image/u_contain/u_resolution)', () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    contourGlPlugin.render(rc, baseParams);
    const args = mockedRenderGlFx.mock.calls[0][0];
    expect(args.uniformNames).toEqual([
      'u_resolution',
      'u_threshold',
      'u_color',
      'u_dilate_px',
      'u_stipple_size',
      'u_sweep_dir',
      'u_sweep_phase',
      'u_reveal_trail',
      'u_intensity'
    ]);
  });

  it('u_resolution comes from rc.ctx.canvas dims (mock: 800×450)', () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    contourGlPlugin.render(rc, baseParams);
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_resolution).toEqual([800, 450]);
  });

  it('threshold and intensity forwarded verbatim (intensity * env)', () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    contourGlPlugin.render(rc, { ...baseParams, threshold: 0.22, intensity: 0.7 });
    const u = mockedRenderGlFx.mock.calls[0][0].uniforms;
    expect(u.u_threshold).toBe(0.22);
    expect(u.u_intensity).toBeCloseTo(0.7, 5);
  });

  it('color parsed to RGBA tuple', () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    contourGlPlugin.render(rc, { ...baseParams, color: '#ff8800' });
    const col = mockedRenderGlFx.mock.calls[0][0].uniforms.u_color as readonly number[];
    expect(col[0]).toBeCloseTo(1, 5);
    expect(col[1]).toBeCloseTo(0x88 / 255, 5);
    expect(col[2]).toBeCloseTo(0, 5);
    expect(col[3]).toBe(1);
  });

  // --- lineWidth → dilatePx mapping ---

  it('lineWidth=0.5 → u_dilate_px ≈ 0', () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    contourGlPlugin.render(rc, { ...baseParams, lineWidth: 0.5 });
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_dilate_px as number).toBeCloseTo(0, 5);
  });

  it('lineWidth=4.0 → u_dilate_px = 2 (full dilate)', () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    contourGlPlugin.render(rc, { ...baseParams, lineWidth: 4.0 });
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_dilate_px as number).toBeCloseTo(2, 5);
  });

  // --- stipple ---

  it('stippleSize=0 (solid) → u_stipple_size = 0', () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    contourGlPlugin.render(rc, baseParams);
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_stipple_size).toBe(0);
  });

  it('stippleSize=8 → u_stipple_size = 8', () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    contourGlPlugin.render(rc, { ...baseParams, stippleSize: 8 });
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_stipple_size).toBe(8);
  });

  // --- sweep direction encoding + phase ---

  it("sweepDirection='all' → u_sweep_dir = 0", () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    contourGlPlugin.render(rc, baseParams);
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_sweep_dir).toBe(0);
  });

  it("sweepDirection='lr' → u_sweep_dir = 1 and u_sweep_phase ∈ [0, 1]", () => {
    const rc = makeRenderContext({ beatIndex: 1, beatPhase: 0.25, flowMode: true });
    contourGlPlugin.render(rc, { ...baseParams, sweepDirection: 'lr' });
    const u = mockedRenderGlFx.mock.calls[0][0].uniforms;
    expect(u.u_sweep_dir).toBe(1);
    expect(u.u_sweep_phase as number).toBeGreaterThanOrEqual(0);
    expect(u.u_sweep_phase as number).toBeLessThanOrEqual(1);
  });

  it("sweepDirection='br-tl' → u_sweep_dir = 8", () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    contourGlPlugin.render(rc, { ...baseParams, sweepDirection: 'br-tl' });
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_sweep_dir).toBe(8);
  });

  it('sweep phase wraps within cycleBeats (sweepSpeed=1 → cycle = 4 beats)', () => {
    // At beatIndex=4, beatPhase=0 → cyclePos = 4 % 4 = 0 → sweepPhase = 0.
    const rc = makeRenderContext({ beatIndex: 4, beatPhase: 0 });
    contourGlPlugin.render(rc, { ...baseParams, sweepDirection: 'lr', sweepSpeed: 1 });
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_sweep_phase as number).toBeCloseTo(0, 5);
  });

  it('u_reveal_trail forwarded as 0.2 (linear falloff constant)', () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    contourGlPlugin.render(rc, { ...baseParams, sweepDirection: 'lr' });
    expect(mockedRenderGlFx.mock.calls[0][0].uniforms.u_reveal_trail as number).toBeCloseTo(0.2, 5);
  });
});
