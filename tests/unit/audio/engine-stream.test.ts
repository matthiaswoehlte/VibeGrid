import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAudioEngine } from '@/lib/audio/engine';
import type { AudioEngine } from '@/lib/audio/engine';

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

function patchFetchAndDecode() {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    arrayBuffer: async () => new ArrayBuffer(8)
  } as Response);
  const ctxProto = (
    globalThis as unknown as { AudioContext: { prototype: AudioContext } }
  ).AudioContext.prototype;
  const decodeSpy = vi.spyOn(ctxProto, 'decodeAudioData').mockResolvedValue({
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

describe('AudioEngine — getAudioStream / getAudioElement', () => {
  let engine: AudioEngine;
  let restoreAudio: (() => void) | null = null;
  let restoreFetch: (() => void) | null = null;

  beforeEach(() => {
    engine = createAudioEngine();
  });

  afterEach(() => {
    restoreAudio?.();
    restoreFetch?.();
    restoreAudio = null;
    restoreFetch = null;
  });

  it('getAudioStream returns null before load() is called', () => {
    expect(engine.getAudioStream()).toBeNull();
  });

  it('getAudioElement returns null before load() is called', () => {
    expect(engine.getAudioElement()).toBeNull();
  });

  it('getAudioStream returns a MediaStream after load() wires the audio graph', async () => {
    restoreAudio = patchAudio();
    restoreFetch = patchFetchAndDecode();
    await engine.load('blob:fake-url');
    const stream = engine.getAudioStream();
    expect(stream).not.toBeNull();
    expect((stream as MediaStream).id).toBe('mock-stream');
  });

  it('getAudioElement returns the HTMLAudioElement after load()', async () => {
    restoreAudio = patchAudio();
    restoreFetch = patchFetchAndDecode();
    await engine.load('blob:fake-url');
    const el = engine.getAudioElement();
    expect(el).not.toBeNull();
    expect((el as HTMLAudioElement).tagName).toBe('AUDIO');
  });
});
