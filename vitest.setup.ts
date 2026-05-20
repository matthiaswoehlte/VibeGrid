import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// @testing-library/react does not auto-cleanup when vitest's `globals: false`
// is set — `afterEach` isn't on globalThis. Wire it explicitly so multi-render
// component tests don't leak DOM between cases (would cause "multiple elements
// with role X" errors).
afterEach(() => {
  cleanup();
});

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

  // jsdom does not implement URL.createObjectURL / revokeObjectURL.
  // VideoExporter (Plan 6) and the media-meta tests rely on them.
  if (typeof URL.createObjectURL !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = (_b: Blob) => 'blob:stub';
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).revokeObjectURL = (_u: string) => undefined;
  }

  // jsdom's File extends Blob but lacks .arrayBuffer(). Patch the prototype
  // so every File instance gets the polyfill — used by media-meta tests
  // and any future exporter consumer.
  if (
    typeof window.File !== 'undefined' &&
    typeof window.File.prototype.arrayBuffer !== 'function'
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.File.prototype as any).arrayBuffer = async function (this: File) {
      return await new Response(this).arrayBuffer();
    };
  }

  /**
   * MockMediaRecorder backs Plan 6's VideoExporter tests. Real MediaRecorder
   * is not available in jsdom. Fires `ondataavailable` + `onstop` synchronously
   * from `requestData()` / `stop()` so tests stay deterministic without fake
   * timers. `stop()` throws `InvalidStateError` when called outside 'recording'
   * — exactly the behaviour the cancel-guard (`recorder.state === 'recording'`)
   * is designed against.
   */
  class MockMediaRecorder {
    static isTypeSupported = vi.fn(
      (type: string) => type.startsWith('video/webm') || type.startsWith('video/mp4')
    );
    state: 'inactive' | 'recording' | 'paused' = 'inactive';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    readonly mimeType: string;
    readonly stream: MediaStream;
    constructor(stream: MediaStream, opts?: { mimeType?: string }) {
      this.stream = stream;
      this.mimeType = opts?.mimeType ?? 'video/webm';
    }
    start(_timeslice?: number): void {
      this.state = 'recording';
    }
    stop(): void {
      if (this.state !== 'recording') throw new Error('InvalidStateError');
      this.state = 'inactive';
      this.ondataavailable?.({
        data: new Blob([new Uint8Array([0])], { type: this.mimeType })
      });
      this.onstop?.();
    }
    requestData(): void {
      this.ondataavailable?.({
        data: new Blob([new Uint8Array([0])], { type: this.mimeType })
      });
    }
  }
  // @ts-expect-error — test-only global.
  globalThis.MediaRecorder = MockMediaRecorder;

  // jsdom has no MediaStream constructor. VideoExporter calls
  // `new MediaStream([videoTrack, audioTrack])` — a minimal stub satisfies it.
  if (typeof globalThis.MediaStream === 'undefined') {
    class MockMediaStream {
      private readonly tracks: MediaStreamTrack[];
      readonly id = 'mock-combined-stream';
      constructor(tracks: MediaStreamTrack[] = []) {
        this.tracks = tracks;
      }
      getTracks(): MediaStreamTrack[] {
        return this.tracks;
      }
      getVideoTracks(): MediaStreamTrack[] {
        return this.tracks.filter((t) => t.kind === 'video');
      }
      getAudioTracks(): MediaStreamTrack[] {
        return this.tracks.filter((t) => t.kind === 'audio');
      }
    }
    // @ts-expect-error — test-only global.
    globalThis.MediaStream = MockMediaStream;
  }
}
