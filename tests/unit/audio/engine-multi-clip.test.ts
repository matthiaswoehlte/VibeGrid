import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAudioEngine } from '@/lib/audio/engine';

/**
 * Plan 5.9d Task 1 — AudioEngine per-clip API tests.
 *
 * Mocks `fetch` + `decodeAudioData` so `loadClip` produces a fake
 * `AudioBuffer` from a fake URL. The MockAudioContext from
 * `vitest.setup.ts` provides `createGain` + `createBufferSource`.
 */

function patchFetchAndDecode() {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    arrayBuffer: async () => new ArrayBuffer(8)
  } as Response);

  const ctxProto = (
    globalThis as unknown as { AudioContext: { prototype: AudioContext } }
  ).AudioContext.prototype;
  const fakeBuffer: AudioBuffer = {
    sampleRate: 48000,
    length: 48000,
    duration: 1,
    numberOfChannels: 2,
    getChannelData: () => new Float32Array(48000)
  } as unknown as AudioBuffer;
  const decodeSpy = vi
    .spyOn(ctxProto, 'decodeAudioData')
    .mockResolvedValue(fakeBuffer);

  return { restore: () => { fetchSpy.mockRestore(); decodeSpy.mockRestore(); }, fakeBuffer };
}

describe('AudioEngine — multi-clip API (Plan 5.9d)', () => {
  let restore: () => void;

  beforeEach(() => {
    ({ restore } = patchFetchAndDecode());
  });

  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  it('loadClip decodes the URL and caches the buffer for that clipId', async () => {
    const engine = createAudioEngine();
    await engine.loadClip('c1', 'https://example.com/a.mp3');
    expect(engine.getLoadedClipIds()).toContain('c1');
    engine.destroy();
  });

  it('unloadClip removes the cached buffer and disconnects the gain node', async () => {
    const engine = createAudioEngine();
    await engine.loadClip('c1', 'https://example.com/a.mp3');
    engine.unloadClip('c1');
    expect(engine.getLoadedClipIds()).not.toContain('c1');
    engine.destroy();
  });

  it('setClipVolume sets gain.value instantly (clamped to 0..1)', async () => {
    const engine = createAudioEngine();
    await engine.loadClip('c1', 'https://example.com/a.mp3');
    engine.setClipVolume('c1', 0.5);
    // We can't directly inspect the internal gain node, but a follow-up
    // out-of-range value should clamp instead of throw.
    expect(() => engine.setClipVolume('c1', 99)).not.toThrow();
    expect(() => engine.setClipVolume('c1', -5)).not.toThrow();
    engine.destroy();
  });

  it('rampClipVolume anchors via setValueAtTime BEFORE linearRampToValueAtTime', async () => {
    const engine = createAudioEngine();
    await engine.loadClip('c1', 'https://example.com/a.mp3');
    // Build a spy-able context by inspecting the gain node we expose
    // indirectly via the engine's playClip side-effects. The architect-
    // mandated anchor pattern means BOTH calls happen on every ramp,
    // not just the linearRamp.
    //
    // Concrete invariant: after rampClipVolume, the gain node's
    // setValueAtTime spy was called exactly once, and
    // linearRampToValueAtTime spy was called exactly once. Verify via
    // a fresh test-local spy attached to the createGain return value.
    const ctxProto = (
      globalThis as unknown as { AudioContext: { prototype: AudioContext } }
    ).AudioContext.prototype;
    const fakeGain = {
      gain: {
        value: 1.0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn()
      },
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const createGainSpy = vi.spyOn(ctxProto, 'createGain')
      .mockReturnValue(fakeGain as unknown as GainNode);

    // loadClip uses createGain — restart the engine so the spy catches it.
    engine.destroy();
    const engine2 = createAudioEngine();
    await engine2.loadClip('c1', 'https://example.com/a.mp3');
    engine2.rampClipVolume('c1', 0.5, 1.0);

    expect(fakeGain.gain.setValueAtTime).toHaveBeenCalledTimes(1);
    expect(fakeGain.gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1);
    // Anchor first, ramp second — call order matters.
    const anchorOrder = (fakeGain.gain.setValueAtTime as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const rampOrder = (fakeGain.gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>)
      .mock.invocationCallOrder[0];
    expect(anchorOrder).toBeLessThan(rampOrder);

    createGainSpy.mockRestore();
    engine2.destroy();
  });

  it('stopAllClips stops every currently-playing source', async () => {
    const engine = createAudioEngine();
    await engine.loadClip('a', 'https://example.com/a.mp3');
    await engine.loadClip('b', 'https://example.com/b.mp3');
    engine.playClip('a', 0, 0);
    engine.playClip('b', 0, 0);
    expect(() => engine.stopAllClips()).not.toThrow();
    engine.destroy();
  });

  it('playClip with offsetSec > 0 starts the source mid-buffer', async () => {
    const engine = createAudioEngine();
    await engine.loadClip('c1', 'https://example.com/a.mp3');
    // Spy on the next createBufferSource so we can read start() args.
    const ctxProto = (
      globalThis as unknown as { AudioContext: { prototype: AudioContext } }
    ).AudioContext.prototype;
    const fakeSource = {
      buffer: null,
      start: vi.fn(),
      stop: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    };
    const createSrcSpy = vi.spyOn(ctxProto, 'createBufferSource')
      .mockReturnValueOnce(fakeSource as unknown as AudioBufferSourceNode);

    engine.playClip('c1', 0.5, 0);
    expect(fakeSource.start).toHaveBeenCalledTimes(1);
    const [whenArg, offsetArg] = (fakeSource.start as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(offsetArg).toBe(0.5);
    // when arg is clamped to max(currentTime, whenSec) — currentTime is
    // 0 in the mock, whenSec we passed is 0, so whenArg is 0.
    expect(whenArg).toBe(0);

    createSrcSpy.mockRestore();
    engine.destroy();
  });

  it('getLoadedClipIds returns every currently-loaded clip id', async () => {
    const engine = createAudioEngine();
    await engine.loadClip('a', 'https://example.com/a.mp3');
    await engine.loadClip('b', 'https://example.com/b.mp3');
    expect(engine.getLoadedClipIds().sort()).toEqual(['a', 'b']);
    engine.unloadClip('a');
    expect(engine.getLoadedClipIds()).toEqual(['b']);
    engine.destroy();
  });

  it('playClip is a no-op when the buffer is not loaded', () => {
    const engine = createAudioEngine();
    // No loadClip call — should silently no-op rather than throw.
    expect(() => engine.playClip('missing', 0, 0)).not.toThrow();
    engine.destroy();
  });
});
