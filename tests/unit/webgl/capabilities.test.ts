import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getDeviceCapabilities,
  _overrideCapabilities,
  _resetCapabilities,
  type DeviceCapabilities
} from '@/lib/renderer/webgl/capabilities';

describe('getDeviceCapabilities', () => {
  // Test-isolation: other tests (plugin-contract.test.ts) install a
  // global OffscreenCanvas stub. Snapshot + restore so our SSR-Guard
  // tests see the canonical jsdom state (no OffscreenCanvas).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let savedOC: any;
  beforeEach(() => {
    _resetCapabilities();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    savedOC = (globalThis as any).OffscreenCanvas;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).OffscreenCanvas;
  });
  afterEach(() => {
    _resetCapabilities();
    if (savedOC) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).OffscreenCanvas = savedOC;
    }
  });

  it('returns low-tier fallback when OffscreenCanvas is undefined (SSR / jsdom)', () => {
    expect(typeof OffscreenCanvas).toBe('undefined');
    const caps = getDeviceCapabilities();
    expect(caps.webgl2).toBe(false);
    expect(caps.tier).toBe('low');
    expect(caps.maxTextureSize).toBe(0);
    expect(caps.maxParticles).toBe(0);
    expect(caps.maxRaySteps).toBe(0);
  });

  it('classifies high-tier with maxTextureSize >= 16384 + !isMobile', () => {
    _overrideCapabilities({
      webgl2: true,
      maxTextureSize: 16384,
      highPrecision: true,
      isMobile: false,
      tier: 'high',
      maxParticles: 500,
      maxRaySteps: 64
    });
    const caps = getDeviceCapabilities();
    expect(caps.tier).toBe('high');
    expect(caps.maxParticles).toBe(500);
    expect(caps.maxRaySteps).toBe(64);
  });

  it('classifies low-tier with maxTextureSize 4096 + isMobile', () => {
    _overrideCapabilities({
      webgl2: true,
      maxTextureSize: 4096,
      highPrecision: false,
      isMobile: true,
      tier: 'low',
      maxParticles: 80,
      maxRaySteps: 16
    });
    const caps = getDeviceCapabilities();
    expect(caps.tier).toBe('low');
    expect(caps.maxParticles).toBe(80);
    expect(caps.maxRaySteps).toBe(16);
  });

  it('caches the result — second call returns the same object instance', () => {
    const mock: DeviceCapabilities = {
      webgl2: true,
      maxTextureSize: 8192,
      highPrecision: true,
      isMobile: false,
      tier: 'mid',
      maxParticles: 200,
      maxRaySteps: 32
    };
    _overrideCapabilities(mock);
    const a = getDeviceCapabilities();
    const b = getDeviceCapabilities();
    expect(a).toBe(b);
  });

  it('_resetCapabilities forces the next call to re-detect', () => {
    _overrideCapabilities({
      webgl2: true,
      maxTextureSize: 16384,
      highPrecision: true,
      isMobile: false,
      tier: 'high',
      maxParticles: 500,
      maxRaySteps: 64
    });
    const first = getDeviceCapabilities();
    expect(first.tier).toBe('high');
    _resetCapabilities();
    // After reset + no override, we hit the jsdom/no-OffscreenCanvas fallback.
    const second = getDeviceCapabilities();
    expect(second.tier).toBe('low');
    expect(second.webgl2).toBe(false);
  });

  it('does not invoke browser-only globals when SSR guard returns', () => {
    // window-Guard greift in jsdom über OffscreenCanvas-undefined-Branch.
    // Wir verifizieren, dass kein navigator.userAgent gelesen wird, indem wir
    // eine spy installieren — die SSR-Branch sollte VOR jeglichem Browser-Code
    // returnen.
    const spy = vi.spyOn(navigator, 'userAgent', 'get');
    _resetCapabilities();
    getDeviceCapabilities();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
