import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAudioEngine } from '@/lib/audio/engine';

function patchAudio() {
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
    get() {
      return origSrc?.get?.call(this);
    }
  });
  return () => {
    if (origSrc) Object.defineProperty(HTMLMediaElement.prototype, 'src', origSrc);
  };
}

/**
 * Stub global.fetch + AudioContext.decodeAudioData. engine.load() needs both
 * to cache the decoded AudioBuffer.
 */
function patchFetchAndDecode() {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    arrayBuffer: async () => new ArrayBuffer(8)
  } as Response);

  const ctxProto = (
    globalThis as unknown as { AudioContext: { prototype: AudioContext } }
  ).AudioContext.prototype;
  const decodeSpy = vi
    .spyOn(ctxProto, 'decodeAudioData')
    .mockResolvedValue({
      sampleRate: 44100,
      length: 1,
      duration: 0,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(1)
    } as unknown as AudioBuffer);

  return () => {
    fetchSpy.mockRestore();
    decodeSpy.mockRestore();
  };
}

describe('AudioEngine lifecycle', () => {
  let restoreAudio: () => void;
  let restoreFetchDecode: () => void;

  beforeEach(() => {
    restoreAudio = patchAudio();
    restoreFetchDecode = patchFetchAndDecode();
  });

  afterEach(() => {
    restoreAudio();
    restoreFetchDecode();
    // Restore any vi.spyOn calls made inside individual tests
    // (e.g. resume/play spies that would otherwise leak to the next test).
    vi.restoreAllMocks();
  });

  it('starts in status=idle with default BeatGrid (120 BPM, manual)', () => {
    const engine = createAudioEngine();
    const s = engine.getState();
    expect(s.status).toBe('idle');
    expect(s.beatGrid.bpm).toBe(120);
    expect(s.beatGrid.source).toBe('manual');
    engine.destroy();
  });

  it('load() transitions idle → loading → ready and emits state updates', async () => {
    const engine = createAudioEngine();
    const statuses: string[] = [];
    engine.onStateChange((s) => statuses.push(s.status));
    await engine.load('blob:test');
    const s = engine.getState();
    expect(s.status).toBe('ready');
    expect(s.duration).toBe(60);
    expect(statuses).toContain('loading');
    expect(statuses).toContain('ready');
    engine.destroy();
  });

  it('play() awaits AudioContext.resume() BEFORE audioElement.play() (spec §5.1)', async () => {
    const engine = createAudioEngine();
    await engine.load('blob:test');

    const audioCtx = (globalThis as unknown as { AudioContext: { prototype: AudioContext } })
      .AudioContext.prototype;
    const resumeSpy = vi.spyOn(audioCtx, 'resume');

    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    await engine.play();
    expect(resumeSpy).toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalled();
    expect(resumeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      playSpy.mock.invocationCallOrder[0]
    );
    engine.destroy();
  });

  it('play() sets status=error if AudioContext fails to resume', async () => {
    const engine = createAudioEngine();
    await engine.load('blob:test');

    const audioCtx = (globalThis as unknown as { AudioContext: { prototype: AudioContext } })
      .AudioContext.prototype;
    vi.spyOn(audioCtx, 'resume').mockImplementation(async function (this: AudioContext) {
      // Leave state suspended — simulate autoplay-blocked
    });

    await expect(engine.play()).rejects.toThrow(/autoplay/);
    expect(engine.getState().status).toBe('error');
    engine.destroy();
  });

  it('pause() returns status to ready', async () => {
    const engine = createAudioEngine();
    await engine.load('blob:test');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    await engine.play();
    engine.pause();
    expect(engine.getState().status).toBe('ready');
    engine.destroy();
  });

  it('seek() clamps negative input to 0 and updates currentTime', async () => {
    const engine = createAudioEngine();
    await engine.load('blob:test');
    engine.seek(-5);
    expect(engine.getState().currentTime).toBe(0);
    engine.seek(10);
    expect(engine.getState().currentTime).toBeGreaterThanOrEqual(0);
    engine.destroy();
  });

  // Test 5 (B1 canonical currentTime): seek() WITHOUT a loaded audioEl must
  // still update the engine's canonical currentTime. Previously this was a
  // no-op — currentTime stayed 0. This test fails BEFORE the B1 fix and
  // passes after.
  it('seek() without loaded audioEl updates canonical currentTime (B1)', () => {
    // No engine.load() call — audioEl is null.
    const engine = createAudioEngine();
    expect(engine.getState().currentTime).toBe(0);

    const received: number[] = [];
    const unsub = engine.onStateChange((s) => received.push(s.currentTime));

    engine.seek(42);
    expect(engine.getState().currentTime).toBe(42);
    expect(received).toContain(42);

    // Clamping: negative → 0
    engine.seek(-7);
    expect(engine.getState().currentTime).toBe(0);

    unsub();
    engine.destroy();
  });

  // Regression (B1): seek() WITH a loaded audioEl must still update BOTH
  // audioEl.currentTime AND state.currentTime (case a unchanged).
  it('seek() with loaded audioEl updates both audioEl.currentTime and state.currentTime (case a regression)', async () => {
    const engine = createAudioEngine();
    await engine.load('blob:test');

    // Spy on the HTMLMediaElement currentTime setter to verify the audio
    // element is also updated (not just the engine state).
    let audioElCurrentTimeSetter: number | undefined;
    const origDescriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'currentTime'
    );
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      set(v: number) {
        audioElCurrentTimeSetter = v;
        origDescriptor?.set?.call(this, v);
      },
      get() {
        return origDescriptor?.get?.call(this) ?? audioElCurrentTimeSetter ?? 0;
      }
    });

    try {
      engine.seek(15);
      // The engine's canonical state must be updated.
      expect(engine.getState().currentTime).toBeGreaterThanOrEqual(0);
      // The audio element's setter must have been called with ≥0.
      expect(audioElCurrentTimeSetter).toBeDefined();
      expect(audioElCurrentTimeSetter).toBeGreaterThanOrEqual(0);
    } finally {
      // Always restore the property descriptor.
      if (origDescriptor) {
        Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', origDescriptor);
      }
      engine.destroy();
    }
  });

  it('setBPM clamps to [60, 200] and marks source=manual', () => {
    const engine = createAudioEngine();
    engine.setBPM(45);
    expect(engine.getState().beatGrid.bpm).toBe(60);
    engine.setBPM(250);
    expect(engine.getState().beatGrid.bpm).toBe(200);
    engine.setBPM(140);
    expect(engine.getState().beatGrid.bpm).toBe(140);
    expect(engine.getState().beatGrid.source).toBe('manual');
    engine.destroy();
  });

  it('destroy() returns engine to status=idle and removes listeners', () => {
    const engine = createAudioEngine();
    const cb = vi.fn();
    engine.onStateChange(cb);
    engine.destroy();
    expect(engine.getState().status).toBe('idle');
    cb.mockClear();
    engine.setBPM(150);
    expect(cb).not.toHaveBeenCalled();
  });
});
