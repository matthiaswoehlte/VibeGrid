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
