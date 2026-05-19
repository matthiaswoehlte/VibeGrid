import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

/**
 * Minimal AudioContext mock for engine tests. Real WebAudio is not available in jsdom.
 * Tests that need to assert specific behavior (e.g. resume order) override these
 * methods per-test via vi.spyOn(audioContext, 'resume').
 */
class MockAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'suspended';
  destination = {} as AudioDestinationNode;
  currentTime = 0;

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }

  createMediaElementSource(_el: HTMLMediaElement): { connect: () => void; disconnect: () => void } {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }

  createAnalyser(): {
    fftSize: number;
    smoothingTimeConstant: number;
    connect: () => void;
    disconnect: () => void;
    getByteFrequencyData: (a: Uint8Array) => void;
  } {
    return {
      fftSize: 2048,
      smoothingTimeConstant: 0.8,
      connect: vi.fn(),
      disconnect: vi.fn(),
      getByteFrequencyData: vi.fn()
    };
  }

  createMediaStreamDestination(): {
    stream: MediaStream;
    connect: () => void;
    disconnect: () => void;
  } {
    return {
      stream: { id: 'mock-stream' } as MediaStream,
      connect: vi.fn(),
      disconnect: vi.fn()
    };
  }

  /**
   * Real WebAudio decodeAudioData accepts an ArrayBuffer. The mock returns a
   * minimal AudioBuffer-like object — tests that care about decoded content
   * override this via vi.spyOn(ctxProto, 'decodeAudioData').
   */
  async decodeAudioData(_buf: ArrayBuffer): Promise<AudioBuffer> {
    return {
      sampleRate: 44100,
      length: 0,
      duration: 0,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(0)
    } as unknown as AudioBuffer;
  }
}

// @ts-expect-error — assigning to globalThis for the test environment only.
globalThis.AudioContext = MockAudioContext;
// @ts-expect-error — Webkit alias used by some libs; keep for parity.
globalThis.webkitAudioContext = MockAudioContext;

// The remaining shims are jsdom-only — server-route integration tests run under
// the `node` environment (via `// @vitest-environment node`) and have no
// `window` / `HTMLMediaElement` / `ImageBitmap` to patch.
if (typeof window !== 'undefined') {
  /**
   * Silence jsdom's "Not implemented: HTMLMediaElement.prototype.play" stderr noise.
   * jsdom ships no media stack, so calling these methods logs an error that masks
   * real failures in later tests (especially Plan 3 renderer + canvas tests).
   * Tests that need spy behavior override these via vi.spyOn.
   */
  window.HTMLMediaElement.prototype.play = async () => {};
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLMediaElement.prototype.load = () => {};

  class MockResizeObserver {
    callback: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.callback = cb;
    }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

  // jsdom has no createImageBitmap. Return a minimal object — tests that need
  // pixel data override per-test.
  globalThis.createImageBitmap = (async (
    _source: ImageBitmapSource
  ): Promise<ImageBitmap> => {
    return {
      width: 100,
      height: 100,
      close: vi.fn()
    } as unknown as ImageBitmap;
  }) as typeof createImageBitmap;
}
