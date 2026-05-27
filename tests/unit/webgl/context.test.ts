import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getGlContext,
  disposeContext,
  disposeAllContexts,
  _overrideContextFactory,
  _peekContextMap
} from '@/lib/renderer/webgl/context';
import {
  _resetCapabilities,
  _overrideCapabilities
} from '@/lib/renderer/webgl/capabilities';
import { setupWebGLMock, teardownWebGLMock } from '../../setup/webgl-mock';

describe('getGlContext', () => {
  beforeEach(async () => {
    _resetCapabilities();
    await setupWebGLMock();
  });
  afterEach(async () => {
    await teardownWebGLMock();
    _resetCapabilities();
  });

  it('returns a GlContext via the mock factory', () => {
    const ctx = getGlContext('clip-1', 1920, 1080);
    expect(ctx).not.toBeNull();
    expect(ctx?.canvas.width).toBe(1920);
    expect(ctx?.canvas.height).toBe(1080);
    expect(ctx?.lost).toBe(false);
  });

  it('caches per-clip — same clipId returns the same instance', () => {
    const a = getGlContext('clip-2', 1920, 1080);
    const b = getGlContext('clip-2', 1920, 1080);
    expect(a).toBe(b);
  });

  it('different clipIds yield independent contexts', () => {
    const a = getGlContext('clip-A', 800, 450);
    const b = getGlContext('clip-B', 800, 450);
    expect(a).not.toBe(b);
  });

  it('disposeContext removes the entry from the map', () => {
    getGlContext('clip-3', 800, 450);
    expect(_peekContextMap().has('clip-3')).toBe(true);
    disposeContext('clip-3');
    expect(_peekContextMap().has('clip-3')).toBe(false);
  });

  it('disposeAllContexts clears every entry', () => {
    getGlContext('a', 100, 100);
    getGlContext('b', 100, 100);
    expect(_peekContextMap().size).toBe(2);
    disposeAllContexts();
    expect(_peekContextMap().size).toBe(0);
  });

  it('returns null when no factory + webgl2=false (no OffscreenCanvas branch)', async () => {
    await teardownWebGLMock(); // detach factory
    _overrideCapabilities({
      webgl2: false,
      maxTextureSize: 0,
      highPrecision: false,
      isMobile: false,
      tier: 'low',
      maxParticles: 0,
      maxRaySteps: 0
    });
    const ctx = getGlContext('clip-no-gl', 800, 450);
    expect(ctx).toBeNull();
  });
});
