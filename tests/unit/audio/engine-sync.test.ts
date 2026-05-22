import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAudioEngine } from '@/lib/audio/engine';

/**
 * Plan 5.9d Task 1 — sync-specific cases for `playClip(when, offset)`.
 *
 * The reconciler (Task 2) computes `whenSec` and `offsetSec` so all
 * active audio clips start in sync on the AudioContext clock. These
 * tests pin down the engine's behaviour for the two interesting
 * sync scenarios: clip already-playing-mid-position (offsetSec > 0,
 * whenSec ≈ now) and clip starting-in-the-future (offsetSec = 0,
 * whenSec > now).
 */

function patchFetchAndDecode() {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    arrayBuffer: async () => new ArrayBuffer(8)
  } as Response);
  const ctxProto = (
    globalThis as unknown as { AudioContext: { prototype: AudioContext } }
  ).AudioContext.prototype;
  const decodeSpy = vi.spyOn(ctxProto, 'decodeAudioData').mockResolvedValue({
    sampleRate: 48000,
    length: 48000,
    duration: 1,
    numberOfChannels: 2,
    getChannelData: () => new Float32Array(48000)
  } as unknown as AudioBuffer);
  return () => {
    fetchSpy.mockRestore();
    decodeSpy.mockRestore();
  };
}

describe('AudioEngine — multi-clip sync (Plan 5.9d)', () => {
  let restore: () => void;
  beforeEach(() => { restore = patchFetchAndDecode(); });
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it('playClip with offsetSec=0 + whenSec > now schedules a future start', async () => {
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
    vi.spyOn(ctxProto, 'createBufferSource')
      .mockReturnValueOnce(fakeSource as unknown as AudioBufferSourceNode);

    const engine = createAudioEngine();
    await engine.loadClip('future', 'https://example.com/future.mp3');
    // Caller's whenSec is 5 seconds from "now". The mock context has
    // currentTime = 0, so the engine uses Math.max(0, 5) = 5.
    engine.playClip('future', 0, 5);

    const [whenArg, offsetArg] = (fakeSource.start as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(whenArg).toBe(5);
    expect(offsetArg).toBe(0);
    engine.destroy();
  });

  it('playClip with offsetSec > 0 (clip already mid-position) honors the offset', async () => {
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
    vi.spyOn(ctxProto, 'createBufferSource')
      .mockReturnValueOnce(fakeSource as unknown as AudioBufferSourceNode);

    const engine = createAudioEngine();
    await engine.loadClip('mid', 'https://example.com/mid.mp3');
    // Mid-clip: started already, we're 2 seconds in. whenSec is 0
    // (engine clamps to currentTime).
    engine.playClip('mid', 2, 0);

    const [whenArg, offsetArg] = (fakeSource.start as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(whenArg).toBe(0);
    expect(offsetArg).toBe(2);
    engine.destroy();
  });
});
