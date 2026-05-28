import { describe, it, expect } from 'vitest';
import {
  RGB_SPLIT_FRAG_SRC,
  RGB_SPLIT_UNIFORM_NAMES
} from '@/lib/renderer/webgl/programs/rgb-split';

describe('RGB_SPLIT_FRAG_SRC', () => {
  it('declares all FX uniforms (u_shift, u_env, u_intensity)', () => {
    expect(RGB_SPLIT_FRAG_SRC).toMatch(/uniform\s+float\s+u_shift/);
    expect(RGB_SPLIT_FRAG_SRC).toMatch(/uniform\s+float\s+u_env/);
    expect(RGB_SPLIT_FRAG_SRC).toMatch(/uniform\s+float\s+u_intensity/);
  });

  it('uses the standard `v_texCoord` vertex-out (NOT v_uv)', () => {
    expect(RGB_SPLIT_FRAG_SRC).toMatch(/in\s+vec2\s+v_texCoord/);
    expect(RGB_SPLIT_FRAG_SRC).not.toMatch(/in\s+vec2\s+v_uv\b/);
  });

  it('declares the pipeline-injected u_contain / u_image / u_resolution uniforms', () => {
    expect(RGB_SPLIT_FRAG_SRC).toMatch(/uniform\s+sampler2D\s+u_image/);
    expect(RGB_SPLIT_FRAG_SRC).toMatch(/uniform\s+vec4\s+u_contain/);
    expect(RGB_SPLIT_FRAG_SRC).toMatch(/uniform\s+vec2\s+u_resolution/);
  });

  it('maps texture coords through u_contain (xy + v_texCoord * zw)', () => {
    // Without this mapping the fragment shader stretches the bitmap across
    // the full quad, ignoring the contain-rect — that was the Rev 1 bug.
    expect(RGB_SPLIT_FRAG_SRC).toMatch(/u_contain\.xy\s*\+\s*v_texCoord\s*\*\s*u_contain\.zw/);
  });

  it('mixes between original and split using u_intensity (no behavior-drift)', () => {
    // u_intensity must appear inside a mix(...) call so the slider acts as
    // a linear blend between the unprocessed sample and the aberrated one.
    expect(RGB_SPLIT_FRAG_SRC).toMatch(/mix\([^)]*u_intensity[^)]*\)/);
  });

  it('uses #version 300 es + precision highp float', () => {
    expect(RGB_SPLIT_FRAG_SRC).toContain('#version 300 es');
    expect(RGB_SPLIT_FRAG_SRC).toContain('precision highp float');
  });
});

describe('RGB_SPLIT_UNIFORM_NAMES', () => {
  it('lists exactly the three FX-specific uniforms in the expected order', () => {
    expect([...RGB_SPLIT_UNIFORM_NAMES]).toEqual([
      'u_shift',
      'u_env',
      'u_intensity'
    ]);
  });
});
