import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  qualityManager,
  _resetQualityManagerForTests
} from '@/lib/renderer/webgl/quality';
import {
  _resetCapabilities,
  _overrideCapabilities
} from '@/lib/renderer/webgl/capabilities';

/**
 * Push `count` FPS samples into the manager at a target FPS. The initial
 * recordFrame seeds `lastMs` (no sample produced because `lastMs > 0` gate);
 * the subsequent `count` calls each produce one sample. `startMs` must be
 * > 0 so the seed call sets a positive `lastMs`.
 *
 * `count` ≥ FPS_WINDOW (=30) → rolling-average becomes stable.
 * `count` ≥ FPS_WINDOW + FRAMES_DOWN → first scale-down trigger.
 */
function pushFrames(fps: number, count: number, startMs = 16): number {
  const dt = 1000 / fps;
  let now = startMs;
  qualityManager.recordFrame(now);
  for (let i = 0; i < count; i++) {
    now += dt;
    qualityManager.recordFrame(now);
  }
  return now;
}

describe('qualityManager', () => {
  beforeEach(() => {
    _resetQualityManagerForTests();
    _resetCapabilities();
    // Pin caps so `getState()` doesn't trigger the real WebGL detection
    // path (other tests may have installed a non-WebGL OffscreenCanvas stub).
    _overrideCapabilities({
      webgl2: true,
      maxTextureSize: 8192,
      highPrecision: true,
      isMobile: false,
      tier: 'mid',
      maxParticles: 200,
      maxRaySteps: 32
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    _resetCapabilities();
    vi.restoreAllMocks();
  });

  it('initial scale is 1.0', () => {
    expect(qualityManager.scale).toBe(1.0);
  });

  it('30 warmup + 20 frames below 45 FPS → scale drops 1.0 → 0.75', () => {
    pushFrames(30, 50);
    expect(qualityManager.scale).toBe(0.75);
  });

  it('19 sub-threshold frames after warmup → no scale change (hysteresis)', () => {
    // 30 warmup samples at 60 FPS — fills FPS_WINDOW above UP_FPS but
    // can't scale up (already at idx=0).
    let now = pushFrames(60, 30);
    expect(qualityManager.scale).toBe(1.0);
    // 19 slow frames: at most ~4 of them have below counted (rolling avg
    // crosses DOWN_FPS only after ~15 slow samples have rotated in).
    // Either way below stays under FRAMES_DOWN=20.
    const slowDt = 1000 / 30;
    for (let i = 0; i < 19; i++) {
      now += slowDt;
      qualityManager.recordFrame(now);
    }
    expect(qualityManager.scale).toBe(1.0);
  });

  it('60 frames above 55 FPS after a downscale → scale-up by one step', () => {
    pushFrames(30, 50);
    expect(qualityManager.scale).toBe(0.75);
    // Continue with fast frames. Need rolling avg to exceed UP_FPS for
    // FRAMES_UP=60 consecutive samples. Push 90 fast frames so the slow
    // ones rotate out of history (30) then 60 consecutive avg>55 samples
    // accumulate above counter.
    let now = 50 * (1000 / 30);
    const fastDt = 1000 / 60;
    for (let i = 0; i < 90; i++) {
      now += fastDt;
      qualityManager.recordFrame(now);
    }
    expect(qualityManager.scale).toBe(1.0);
  });

  it('pinToMax(true) keeps scale at 1.0 regardless of FPS drops', () => {
    qualityManager.pinToMax(true);
    pushFrames(20, 50);
    expect(qualityManager.scale).toBe(1.0);
  });

  it('setOffline(true) → recordFrame is a no-op + scale forced to 1.0', () => {
    qualityManager.setOffline(true);
    pushFrames(20, 50);
    expect(qualityManager.scale).toBe(1.0);
    expect(qualityManager.avgFps).toBe(60);
  });

  it('setOffline(false) re-enables auto-scaling', () => {
    qualityManager.setOffline(true);
    pushFrames(30, 50);
    expect(qualityManager.scale).toBe(1.0);
    qualityManager.setOffline(false);
    pushFrames(30, 50);
    expect(qualityManager.scale).toBe(0.75);
  });

  it('20 more below-threshold frames after 0.75 → drops to 0.5', () => {
    pushFrames(30, 70);
    expect(qualityManager.scale).toBe(0.5);
  });

  it('getState exposes scale, userPinned, avgFps, tier, offline', () => {
    const s = qualityManager.getState();
    expect(s).toHaveProperty('scale');
    expect(s).toHaveProperty('userPinned');
    expect(s).toHaveProperty('avgFps');
    expect(s).toHaveProperty('tier');
    expect(s).toHaveProperty('offline');
  });
});
