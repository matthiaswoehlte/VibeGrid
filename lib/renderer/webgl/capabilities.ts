import { isClient } from '@/lib/utils/is-client';

/**
 * Plan 8f.1 — Device WebGL2-Capabilities, einmalig beim ersten Aufruf
 * detektiert + gecached. SSR-safe (Next.js Server-Build sieht weder
 * `window` noch `OffscreenCanvas` — der Guard returnt eine Low-Tier-
 * Default-Capability ohne den Browser-Pfad anzufassen).
 *
 * Tier-Klassifikation basiert auf `gl.MAX_TEXTURE_SIZE` + isMobile-
 * Heuristik (`navigator.maxTouchPoints` + UA-Sniff für iPad Safari, das
 * `maxTouchPoints` auf macOS-Niveau hält).
 *
 * `maxParticles` / `maxRaySteps` sind für Plan 8g reserviert (Particles-FX
 * + Sunray-Rebuild). In 8f selbst werden die Werte nicht konsumiert.
 */
export interface DeviceCapabilities {
  webgl2: boolean;
  maxTextureSize: number;
  highPrecision: boolean;
  isMobile: boolean;
  tier: 'high' | 'mid' | 'low';
  maxParticles: number;
  maxRaySteps: number;
}

let cached: DeviceCapabilities | null = null;

const LOW_TIER_FALLBACK: DeviceCapabilities = {
  webgl2: false,
  maxTextureSize: 0,
  highPrecision: false,
  isMobile: false,
  tier: 'low',
  maxParticles: 0,
  maxRaySteps: 0
};

export function getDeviceCapabilities(): DeviceCapabilities {
  // Cache zuerst — `_overrideCapabilities` muss auch im SSR-/jsdom-Pfad
  // wirken (Tests setzen einen Override, dann erwarten sie deterministisches
  // tier='high' o.ä.). Production sieht den Cache erst nach der ersten
  // Client-Detection, also keine Race mit SSR.
  if (cached) return cached;

  // SSR-Guard: kein window → Server-Render. Kein OffscreenCanvas →
  // jsdom oder älterer Browser. In beiden Fällen kein WebGL2-Pfad.
  if (!isClient() || typeof OffscreenCanvas === 'undefined') {
    return LOW_TIER_FALLBACK;
  }

  const isMobile =
    navigator.maxTouchPoints > 1 ||
    /Android|iPhone|iPad/i.test(navigator.userAgent);

  const testCanvas = new OffscreenCanvas(1, 1);
  const gl = testCanvas.getContext('webgl2') as WebGL2RenderingContext | null;

  if (!gl) {
    cached = { ...LOW_TIER_FALLBACK, isMobile };
    return cached;
  }

  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const precFmt = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const highPrc = precFmt !== null && precFmt.precision > 0;

  const tier: DeviceCapabilities['tier'] =
    !isMobile && maxTex >= 16384
      ? 'high'
      : maxTex >= 8192 || (!isMobile && maxTex >= 4096)
        ? 'mid'
        : 'low';

  cached = {
    webgl2: true,
    maxTextureSize: maxTex,
    highPrecision: highPrc,
    isMobile,
    tier,
    maxParticles: tier === 'high' ? 500 : tier === 'mid' ? 200 : 80,
    maxRaySteps: tier === 'high' ? 64 : tier === 'mid' ? 32 : 16
  };
  return cached;
}

/** Test-Seam: überschreibt die gecachten Capabilities deterministisch. */
export function _overrideCapabilities(c: DeviceCapabilities): void {
  cached = c;
}

/** Test-Seam: leert den Cache, sodass der nächste Aufruf neu detektiert. */
export function _resetCapabilities(): void {
  cached = null;
}
