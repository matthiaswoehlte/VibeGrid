import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupWebGLMock, teardownWebGLMock, type MockGL } from '../../setup/webgl-mock';
import { _overrideCapabilities, _resetCapabilities } from '@/lib/renderer/webgl/capabilities';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';
import { makeRenderContext } from '../renderer/_helpers';

const TINY_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec4 u_contain;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;
void main(){ fragColor = texture(u_image, v_texCoord); }`;

describe('renderGlFx — source option', () => {
  let gl: MockGL;
  beforeEach(async () => {
    _overrideCapabilities({
      webgl2: true, maxTextureSize: 4096, highPrecision: true,
      isMobile: false, tier: 'high', maxParticles: 500, maxRaySteps: 64
    });
    gl = await setupWebGLMock();
  });
  afterEach(async () => {
    await teardownWebGLMock();
    _resetCapabilities();
  });

  it("source='bitmap' (default) uploads from rc.imageBitmap", () => {
    const rc = makeRenderContext();
    renderGlFx({ rc, fragSrc: TINY_FRAG, uniforms: {}, uniformNames: [] });
    // texSubImage2D should have been called with the imageBitmap-shaped object.
    const sub = gl.__calls.find((c) => c.method === 'texSubImage2D');
    expect(sub).toBeDefined();
    // 7th arg (index 6) is the source. Mock bitmap has width/height props.
    const src = sub!.args[6] as { width: number; height: number };
    expect(src.width).toBe(100); // makeMockImageBitmap default
  });

  it("source='canvas' uploads from rc.ctx.canvas instead", () => {
    const rc = makeRenderContext();
    renderGlFx({
      rc, fragSrc: TINY_FRAG, uniforms: {}, uniformNames: [],
      source: 'canvas'
    });
    const sub = gl.__calls.find((c) => c.method === 'texSubImage2D');
    expect(sub).toBeDefined();
    const src = sub!.args[6] as { width: number; height: number };
    // makeMockCtx canvas is 800×450.
    expect(src.width).toBe(800);
    expect(src.height).toBe(450);
  });

  it("source='canvas' sets u_contain to identity (0,0,1,1)", () => {
    const rc = makeRenderContext();
    renderGlFx({
      rc, fragSrc: TINY_FRAG, uniforms: {}, uniformNames: [],
      source: 'canvas'
    });
    const containCall = gl.__calls.find(
      (c) => c.method === 'uniform4f'
    );
    expect(containCall).toBeDefined();
    // uniform4f(loc, x, y, w, h) — identity = (0, 0, 1, 1)
    expect(containCall!.args.slice(1)).toEqual([0, 0, 1, 1]);
  });

  it("source='bitmap' uses containRect-derived u_contain (not identity)", () => {
    // 800×450 main canvas, 100×100 bitmap → contained at (350, 175, 100, 100)
    const rc = makeRenderContext();
    renderGlFx({ rc, fragSrc: TINY_FRAG, uniforms: {}, uniformNames: [] });
    const containCall = gl.__calls.find((c) => c.method === 'uniform4f');
    expect(containCall).toBeDefined();
    // Should NOT be identity.
    expect(containCall!.args.slice(1)).not.toEqual([0, 0, 1, 1]);
  });
});
