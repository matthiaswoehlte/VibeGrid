import { describe, it, expect } from 'vitest';
import { EDGE_GLOW_FRAG_SRC } from '@/lib/renderer/webgl/programs/edge-glow';

describe('EDGE_GLOW_FRAG_SRC', () => {
  it('declares all 6 FX uniforms', () => {
    expect(EDGE_GLOW_FRAG_SRC).toMatch(/uniform\s+vec2\s+u_resolution/);
    expect(EDGE_GLOW_FRAG_SRC).toMatch(/uniform\s+float\s+u_threshold/);
    expect(EDGE_GLOW_FRAG_SRC).toMatch(/uniform\s+vec4\s+u_color/);
    expect(EDGE_GLOW_FRAG_SRC).toMatch(/uniform\s+float\s+u_glow/);
    expect(EDGE_GLOW_FRAG_SRC).toMatch(/uniform\s+float\s+u_bg_opacity/);
    expect(EDGE_GLOW_FRAG_SRC).toMatch(/uniform\s+float\s+u_intensity/);
  });

  it('uses 9-tap Sobel kernel constants (-1, -2, -1, 1, 2, 1)', () => {
    // Sobel coefficient signature — defensive check that someone hasn't
    // silently replaced the operator with a wrong kernel.
    const src = EDGE_GLOW_FRAG_SRC;
    expect(src).toContain('-2.0');
    expect(src).toContain('2.0');
    expect(src.match(/luma/g)?.length).toBeGreaterThanOrEqual(9);
  });
});
