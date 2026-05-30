/**
 * Plan 9c.2 Task 2 — AudioContext-based fallback clock tests.
 *
 * These tests cover the "no audioEl" code path where `play()` must NOT
 * throw and must instead start a setInterval-based fallback clock that
 * advances `currentTime` from the AudioContext delta.
 *
 * Mocking strategy:
 *   - `vi.useFakeTimers()` drives `setInterval` ticks synchronously.
 *   - We capture the AudioContext *instance* by intercepting `new AudioContext()`
 *     so we can advance `instance.currentTime` directly to simulate a
 *     running AudioContext clock.
 *   - The `play()` call in the fallback path MUST call `audioContext.resume()`,
 *     which sets `state = 'running'` in the mock (required for the guard to pass).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAudioEngine, FALLBACK_CLOCK_INTERVAL_MS } from '@/lib/audio/engine';

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Intercepts `new AudioContext()` and returns both the captured instance
 * (populated after the first construction) and a cleanup fn.
 *
 * Strategy: replace `globalThis.AudioContext` with a Proxy class that calls
 * the real MockAudioContext constructor but stores `this` after construction.
 */
function captureAudioContextInstance(): {
  getInstance: () => InstanceType<typeof AudioContext> | null;
  restore: () => void;
} {
  const OrigClass = (globalThis as { AudioContext: new () => AudioContext }).AudioContext;
  let captured: AudioContext | null = null;

  class SpyAudioContext extends (OrigClass as unknown as new () => object) {
    constructor() {
      super();
      // `this` at this point is the constructed instance. Last-write-wins:
      // the fallback path constructs exactly one context per test, so the
      // most-recent reference is the one under test.
      captured = this as unknown as AudioContext;
    }
  }

  (globalThis as { AudioContext: unknown }).AudioContext = SpyAudioContext;

  return {
    getInstance: () => captured,
    restore: () => {
      (globalThis as { AudioContext: unknown }).AudioContext = OrigClass;
      captured = null;
    }
  };
}

/** Advance the captured AudioContext's currentTime and fire all pending fake timers. */
function tick(instance: AudioContext, advanceSec: number, intervalMs = FALLBACK_CLOCK_INTERVAL_MS): void {
  (instance as unknown as { currentTime: number }).currentTime += advanceSec;
  vi.advanceTimersByTime(intervalMs);
}

// ─── test suite ───────────────────────────────────────────────────────────────

describe('AudioEngine — fallback clock (Plan 9c.2 T2)', () => {
  let ctxCapture: ReturnType<typeof captureAudioContextInstance>;

  beforeEach(() => {
    vi.useFakeTimers();
    ctxCapture = captureAudioContextInstance();
  });

  afterEach(() => {
    vi.useRealTimers();
    ctxCapture.restore();
    vi.restoreAllMocks();
  });

  // ── Test 1 (B1 anchor, red→green) ─────────────────────────────────────────
  // No audioEl loaded + play() → currentTime advances as AudioContext time advances.
  // Was frozen at 0 before this task; NOW it must advance.
  it('Test 1 (B1): play() without audioEl advances currentTime via AudioContext delta', async () => {
    const engine = createAudioEngine();

    // No engine.load() — audioEl is null.
    expect(engine.getState().currentTime).toBe(0);

    await engine.play();

    // AudioContext is now created + resumed. Get the instance.
    const ctx = ctxCapture.getInstance()!;
    expect(ctx).not.toBeNull();

    // Advance AudioContext time by 1 second and fire the interval tick.
    tick(ctx, 1);
    expect(engine.getState().currentTime).toBeCloseTo(1, 5);

    // Another 0.5 s.
    tick(ctx, 0.5);
    expect(engine.getState().currentTime).toBeCloseTo(1.5, 5);

    engine.destroy();
  });

  // ── Test 12b (B2 resume) ───────────────────────────────────────────────────
  // The fallback play() must call audioContext.resume() explicitly so the
  // context exits the 'suspended' state and its clock starts advancing.
  it('Test 12b (B2): fallback play() calls audioContext.resume() and currentTime advances', async () => {
    const engine = createAudioEngine();

    // Spy on the prototype BEFORE play() is called (which creates the context).
    const ctxProto = (
      globalThis as unknown as { AudioContext: { prototype: AudioContext } }
    ).AudioContext.prototype;
    const resumeSpy = vi.spyOn(ctxProto, 'resume');

    await engine.play();

    expect(resumeSpy).toHaveBeenCalled();

    const ctx = ctxCapture.getInstance()!;
    tick(ctx, 2);
    // currentTime advanced — context wasn't stuck in suspended mode.
    expect(engine.getState().currentTime).toBeCloseTo(2, 5);

    engine.destroy();
  });

  // ── Test 6: pause holds currentTime ───────────────────────────────────────
  it('Test 6: pause() while in fallback mode holds currentTime (no reset)', async () => {
    const engine = createAudioEngine();
    await engine.play();

    const ctx = ctxCapture.getInstance()!;
    tick(ctx, 1);
    const heldTime = engine.getState().currentTime;
    expect(heldTime).toBeCloseTo(1, 5);

    engine.pause();

    // After pause, further tick must not advance currentTime.
    tick(ctx, 1);
    expect(engine.getState().currentTime).toBeCloseTo(heldTime, 5);

    // Status is 'ready', not 'idle' (no reset to 0).
    expect(engine.getState().status).toBe('ready');

    engine.destroy();
  });

  // ── Test 9: BPM change does NOT affect currentTime ─────────────────────────
  it('Test 9: setBPM() during fallback playback does NOT change currentTime', async () => {
    const engine = createAudioEngine();
    await engine.play();

    const ctx = ctxCapture.getInstance()!;
    tick(ctx, 1);
    const timeBefore = engine.getState().currentTime;

    engine.setBPM(160);

    // No tick advancement needed — just confirm BPM change left currentTime alone.
    expect(engine.getState().currentTime).toBe(timeBefore);
    expect(engine.getState().beatGrid.bpm).toBe(160);

    engine.destroy();
  });

  // ── Test 12: exactly one active clock (with audioEl, fallback does NOT run) ─
  it('Test 12: with audioEl loaded, fallback clock is NOT started (no double-advance)', async () => {
    // Patch audio element so engine.load() succeeds.
    const origSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      set(value: string) {
        origSrc?.set?.call(this, value);
        queueMicrotask(() => {
          Object.defineProperty(this, 'duration', { value: 60, configurable: true });
          this.dispatchEvent(new Event('loadedmetadata'));
        });
      },
      get() { return origSrc?.get?.call(this); }
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(8)
    } as Response);
    const ctxProto = (globalThis as unknown as { AudioContext: { prototype: AudioContext } })
      .AudioContext.prototype;
    const decodeSpy = vi.spyOn(ctxProto, 'decodeAudioData').mockResolvedValue({
      sampleRate: 44100, length: 1, duration: 0, numberOfChannels: 1,
      getChannelData: () => new Float32Array(1)
    } as unknown as AudioBuffer);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    const engine = createAudioEngine();
    await engine.load('blob:test');
    await engine.play();

    const ctx = ctxCapture.getInstance()!;

    // Record the currentTime right after play (audioEl path: timeupdate drives it, NOT the interval).
    const beforeTick = engine.getState().currentTime;

    // Advance AudioContext time and fire fake timers: if the fallback clock is
    // NOT running, the setInterval callback never fires → currentTime stays
    // where timeupdate left it (0 in jsdom since audioEl.currentTime doesn't advance).
    tick(ctx, 5);

    // The value should NOT have been advanced by the fallback clock.
    // In the audioEl path, only timeupdate events advance currentTime.
    // jsdom doesn't fire timeupdate, so it stays at `beforeTick`.
    expect(engine.getState().currentTime).toBe(beforeTick);

    fetchSpy.mockRestore();
    decodeSpy.mockRestore();
    if (origSrc) Object.defineProperty(HTMLMediaElement.prototype, 'src', origSrc);
    engine.destroy();
  });

  // ── Test 2 (no regress): with audioEl, play() uses audioEl path exactly ───
  it('Test 2 (no regress): with audioEl, play() resumes context + plays element, no fallback', async () => {
    const origSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      set(value: string) {
        origSrc?.set?.call(this, value);
        queueMicrotask(() => {
          Object.defineProperty(this, 'duration', { value: 60, configurable: true });
          this.dispatchEvent(new Event('loadedmetadata'));
        });
      },
      get() { return origSrc?.get?.call(this); }
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(8)
    } as Response);
    const ctxProto = (globalThis as unknown as { AudioContext: { prototype: AudioContext } })
      .AudioContext.prototype;
    const decodeSpy = vi.spyOn(ctxProto, 'decodeAudioData').mockResolvedValue({
      sampleRate: 44100, length: 1, duration: 0, numberOfChannels: 1,
      getChannelData: () => new Float32Array(1)
    } as unknown as AudioBuffer);

    const resumeSpy = vi.spyOn(ctxProto, 'resume');
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    const engine = createAudioEngine();
    await engine.load('blob:test');
    await engine.play();

    // Case a: both resume AND audioEl.play() must be called.
    expect(resumeSpy).toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalled();
    // resume before play (same spec §5.1 invariant as existing engine test).
    expect(resumeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      playSpy.mock.invocationCallOrder[0]
    );
    // Status is 'playing'.
    expect(engine.getState().status).toBe('playing');

    fetchSpy.mockRestore();
    decodeSpy.mockRestore();
    if (origSrc) Object.defineProperty(HTMLMediaElement.prototype, 'src', origSrc);
    engine.destroy();
  });

  // ── seek() re-anchors the fallback clock ──────────────────────────────────
  it('seek() while fallback is playing re-anchors the clock from the new position', async () => {
    const engine = createAudioEngine();
    await engine.play();

    const ctx = ctxCapture.getInstance()!;
    // Advance 1 second — clock should read ~1.
    tick(ctx, 1);
    expect(engine.getState().currentTime).toBeCloseTo(1, 5);

    // Seek to 10.
    engine.seek(10);
    expect(engine.getState().currentTime).toBe(10);

    // Advance another 1 second — clock should read ~11.
    tick(ctx, 1);
    expect(engine.getState().currentTime).toBeCloseTo(11, 5);

    engine.destroy();
  });

  // ── destroy() stops the fallback clock ───────────────────────────────────
  it('destroy() stops the fallback clock', async () => {
    const engine = createAudioEngine();
    await engine.play();

    const ctx = ctxCapture.getInstance()!;
    tick(ctx, 1);
    expect(engine.getState().currentTime).toBeCloseTo(1, 5);

    engine.destroy();

    // destroy() resets currentTime to 0 AND clears the interval. If the
    // interval were still alive, this tick would write baseTime+elapsed;
    // instead currentTime stays at the post-destroy reset value (0).
    tick(ctx, 5);
    expect(engine.getState().currentTime).toBe(0);
  });

  // Mid-play soundtrack switch is owned by the useAudioEngine reconciler
  // (it pause()s + play()s to swap clock source); engine-level source
  // selection happens at play-start. Covered in T6 integration.
  it.todo('Test 7: soundtrack removed mid-play → fallback takes over from current time');
  it.todo('Test 8: soundtrack loaded → next play-start uses audioEl');
});
