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

function patchFetchAndDecode(buffer: AudioBuffer) {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    arrayBuffer: async () => new ArrayBuffer(8)
  } as Response);
  const ctxProto = (
    globalThis as unknown as { AudioContext: { prototype: AudioContext } }
  ).AudioContext.prototype;
  const decodeSpy = vi.spyOn(ctxProto, 'decodeAudioData').mockResolvedValue(buffer);
  return () => {
    fetchSpy.mockRestore();
    decodeSpy.mockRestore();
  };
}

describe('AudioEngine.getDecodedBuffer', () => {
  let restoreAudio: () => void;

  beforeEach(() => {
    restoreAudio = patchAudio();
  });

  afterEach(() => {
    restoreAudio();
    vi.restoreAllMocks();
  });

  it('returns null before load()', () => {
    const engine = createAudioEngine();
    expect(engine.getDecodedBuffer()).toBeNull();
    engine.destroy();
  });

  it('returns the cached AudioBuffer after a successful load', async () => {
    const fakeBuffer = {
      sampleRate: 48000,
      length: 480,
      duration: 0.01,
      numberOfChannels: 2,
      getChannelData: () => new Float32Array(480)
    } as unknown as AudioBuffer;
    const restoreFetchDecode = patchFetchAndDecode(fakeBuffer);
    const engine = createAudioEngine();
    expect(engine.getDecodedBuffer()).toBeNull();
    await engine.load('blob:test');
    expect(engine.getDecodedBuffer()).toBe(fakeBuffer);
    expect(engine.getDecodedBuffer()?.sampleRate).toBe(48000);
    expect(engine.getDecodedBuffer()?.numberOfChannels).toBe(2);
    engine.destroy();
    restoreFetchDecode();
  });

  it('returns null again after destroy()', async () => {
    const fakeBuffer = {
      sampleRate: 48000,
      length: 1,
      duration: 0,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(1)
    } as unknown as AudioBuffer;
    const restoreFetchDecode = patchFetchAndDecode(fakeBuffer);
    const engine = createAudioEngine();
    await engine.load('blob:test');
    expect(engine.getDecodedBuffer()).not.toBeNull();
    engine.destroy();
    expect(engine.getDecodedBuffer()).toBeNull();
    restoreFetchDecode();
  });
});
