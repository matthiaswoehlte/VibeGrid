import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getOrCompileProgram,
  getLocations
} from '@/lib/renderer/webgl/shader';
import {
  _resetCapabilities,
  _overrideCapabilities
} from '@/lib/renderer/webgl/capabilities';
import { createMockGL, type MockGL } from '../../setup/webgl-mock';

const FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D u_image;
in  vec2 v_texCoord;
out vec4 fragColor;
void main(){ fragColor = texture(u_image, v_texCoord); }`;

describe('getOrCompileProgram + getLocations', () => {
  let gl: MockGL;
  beforeEach(() => {
    _resetCapabilities();
    _overrideCapabilities({
      webgl2: true,
      maxTextureSize: 8192,
      highPrecision: true,
      isMobile: false,
      tier: 'mid',
      maxParticles: 200,
      maxRaySteps: 32
    });
    gl = createMockGL();
  });
  afterEach(() => {
    _resetCapabilities();
  });

  it('compiles + links without error (mock returns true for status)', () => {
    expect(() => getOrCompileProgram(gl, FRAG_SRC)).not.toThrow();
  });

  it('cache-hit: second call returns the same WebGLProgram', () => {
    const a = getOrCompileProgram(gl, FRAG_SRC);
    const b = getOrCompileProgram(gl, FRAG_SRC);
    expect(a).toBe(b);
  });

  it('highPrecision=false adapts "highp" → "mediump" in fragment source', () => {
    _resetCapabilities();
    _overrideCapabilities({
      webgl2: true,
      maxTextureSize: 4096,
      highPrecision: false,
      isMobile: true,
      tier: 'low',
      maxParticles: 80,
      maxRaySteps: 16
    });
    const gl2 = createMockGL();
    getOrCompileProgram(gl2, FRAG_SRC);
    const shaderSourceCalls = gl2.__calls.filter(
      (c) => c.method === 'shaderSource'
    );
    // Two calls: VERT_SRC + FRAG_SRC adapted. We check the FRAG call.
    const fragCall = shaderSourceCalls[1];
    const adaptedSrc = fragCall.args[1] as string;
    expect(adaptedSrc).toContain('precision mediump');
    expect(adaptedSrc).not.toContain('precision highp');
  });

  it('getLocations caches per WebGLProgram', () => {
    const prog = getOrCompileProgram(gl, FRAG_SRC);
    const cache = new WeakMap();
    const a = getLocations(gl, prog, cache, ['u_image']);
    const b = getLocations(gl, prog, cache, ['u_image']);
    expect(a).toBe(b);
  });
});
