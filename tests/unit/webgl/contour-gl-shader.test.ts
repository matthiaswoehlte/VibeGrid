import { describe, it, expect } from 'vitest';
import { CONTOUR_GL_FRAG_SRC } from '@/lib/renderer/webgl/programs/contour-gl';

describe('CONTOUR_GL_FRAG_SRC', () => {
  it('declares all FX uniforms', () => {
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+vec2\s+u_resolution/);
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+float\s+u_threshold/);
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+vec4\s+u_color/);
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+float\s+u_dilate_px/);
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+float\s+u_stipple_size/);
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+float\s+u_sweep_dir/);
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+float\s+u_sweep_phase/);
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+float\s+u_reveal_trail/);
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+float\s+u_intensity/);
  });

  it('uses 9-tap Sobel kernel signature (-2.0 / 2.0 coefficients, 9+ luma samples)', () => {
    expect(CONTOUR_GL_FRAG_SRC).toContain('-2.0');
    expect(CONTOUR_GL_FRAG_SRC).toContain('2.0');
    expect(CONTOUR_GL_FRAG_SRC.match(/luma/g)?.length).toBeGreaterThanOrEqual(9);
  });

  it('references u_sweep_dir in the body (used for direction branching)', () => {
    expect(CONTOUR_GL_FRAG_SRC.match(/u_sweep_dir/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('references u_dilate_px for the dilate-pass branch', () => {
    expect(CONTOUR_GL_FRAG_SRC.match(/u_dilate_px/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('uses #version 300 es / precision highp float', () => {
    expect(CONTOUR_GL_FRAG_SRC).toContain('#version 300 es');
    expect(CONTOUR_GL_FRAG_SRC).toContain('precision highp float');
  });
});
