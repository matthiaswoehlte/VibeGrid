import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWaveformPeaks, _resetPeaksCacheForTests } from '@/lib/hooks/useWaveformPeaks';

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage = vi.fn(() => {
    queueMicrotask(() => {
      this.onmessage?.(
        new MessageEvent('message', {
          data: { type: 'peaks', payload: [[-0.5, 0.5], [-0.3, 0.3]] }
        })
      );
    });
  });
  terminate = vi.fn();
}

let mockWorker: MockWorker;
const createWorker = () => {
  mockWorker = new MockWorker();
  return mockWorker as unknown as Worker;
};

class MockOfflineCtx {
  constructor(_ch: number, _len: number, _rate: number) {}
  decodeAudioData = vi.fn(async (_buf: ArrayBuffer) => {
    return {
      length: 4,
      duration: 1,
      sampleRate: 44100,
      numberOfChannels: 1,
      getChannelData: (_ch: number) => new Float32Array([0.1, -0.2, 0.3, -0.4])
    } as unknown as AudioBuffer;
  });
}

beforeEach(() => {
  _resetPeaksCacheForTests();
  vi.restoreAllMocks();
  (globalThis as unknown as { OfflineAudioContext: typeof MockOfflineCtx }).OfflineAudioContext =
    MockOfflineCtx;
  globalThis.fetch = vi.fn(
    async () =>
      ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8)
      }) as unknown as Response
  ) as unknown as typeof fetch;
});

describe('useWaveformPeaks', () => {
  it('returns idle status when audioUrl is null', () => {
    const { result } = renderHook(() =>
      useWaveformPeaks({ mediaId: 'm1', audioUrl: null, targetCols: 2, createWorker })
    );
    expect(result.current.status).toBe('idle');
    expect(result.current.peaks).toBeNull();
  });

  it('happy path: fetch → decode → worker → peaks', async () => {
    const { result } = renderHook(() =>
      useWaveformPeaks({ mediaId: 'm1', audioUrl: 'https://x/a.mp3', targetCols: 2, createWorker })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.peaks).toEqual([[-0.5, 0.5], [-0.3, 0.3]]);
  });

  it('cache hit returns existing peaks without re-fetching', async () => {
    const { result: r1 } = renderHook(() =>
      useWaveformPeaks({ mediaId: 'm1', audioUrl: 'https://x/a.mp3', targetCols: 2, createWorker })
    );
    await waitFor(() => expect(r1.current.status).toBe('ready'));
    const callsBefore = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls
      .length;
    const { result: r2 } = renderHook(() =>
      useWaveformPeaks({ mediaId: 'm1', audioUrl: 'https://x/a.mp3', targetCols: 2, createWorker })
    );
    await waitFor(() => expect(r2.current.status).toBe('ready'));
    const callsAfter = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls
      .length;
    expect(callsAfter).toBe(callsBefore);
    expect(r2.current.peaks).toEqual([[-0.5, 0.5], [-0.3, 0.3]]);
  });

  it('error path sets status=error when fetch fails', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: false,
          status: 500,
          arrayBuffer: async () => new ArrayBuffer(0)
        }) as unknown as Response
    ) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useWaveformPeaks({
        mediaId: 'm-err',
        audioUrl: 'https://x/bad.mp3',
        targetCols: 2,
        createWorker
      })
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.peaks).toBeNull();
  });

  it('unmount aborts in-flight load', async () => {
    let abortSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
      abortSignal = init?.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        init?.signal?.addEventListener('abort', () =>
          resolve({
            ok: false,
            status: 0,
            arrayBuffer: async () => new ArrayBuffer(0)
          } as Response)
        );
      });
    }) as unknown as typeof fetch;

    const { unmount } = renderHook(() =>
      useWaveformPeaks({
        mediaId: 'm-abort',
        audioUrl: 'https://x/a.mp3',
        targetCols: 2,
        createWorker
      })
    );
    unmount();
    await waitFor(() => expect(abortSignal?.aborted).toBe(true));
  });
});
