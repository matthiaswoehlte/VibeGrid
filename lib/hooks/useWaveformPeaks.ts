'use client';
import { useEffect, useState } from 'react';
import { isClient } from '@/lib/utils/is-client';
import { type WaveformPeaks } from '@/lib/audio/peaks';
import { createWaveformWorker as defaultCreateWorker } from '@/lib/audio/worker-factory';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface PeaksCacheEntry {
  peaks: WaveformPeaks;
  targetCols: number;
}

// Module-scoped cache. Survives component remounts (StrictMode-safe).
// Reset between unit tests via _resetPeaksCacheForTests.
const cache = new Map<string, PeaksCacheEntry>();

export function _resetPeaksCacheForTests(): void {
  cache.clear();
}

export interface UseWaveformPeaksOpts {
  mediaId: string | null;
  audioUrl: string | null;
  targetCols?: number;
  /** Override the worker factory for tests. */
  createWorker?: () => Worker;
}

export interface UseWaveformPeaksResult {
  peaks: WaveformPeaks | null;
  status: Status;
}

export function useWaveformPeaks(opts: UseWaveformPeaksOpts): UseWaveformPeaksResult {
  const { mediaId, audioUrl, targetCols = 1024, createWorker = defaultCreateWorker } = opts;
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(() => {
    if (!mediaId) return null;
    return cache.get(mediaId)?.peaks ?? null;
  });
  const [status, setStatus] = useState<Status>(() => {
    if (!mediaId || !audioUrl) return 'idle';
    return cache.has(mediaId) ? 'ready' : 'loading';
  });

  useEffect(() => {
    if (!isClient()) return;
    if (!mediaId || !audioUrl) {
      setStatus('idle');
      setPeaks(null);
      return;
    }

    const cached = cache.get(mediaId);
    if (cached && cached.targetCols === targetCols) {
      setPeaks(cached.peaks);
      setStatus('ready');
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    let worker: Worker | null = null;

    (async () => {
      setStatus('loading');
      try {
        // Audio URL points to R2 `pub-*.r2.dev`. This fetch is subject to the
        // R2 CORS allowlist — the bucket must permit the current origin (dev:
        // localhost, prod: vercel domain). See scripts/diagnose-r2.mjs and the
        // CORS section in r2_setup_gotchas. A CORS rejection surfaces here as
        // a TypeError, NOT a non-200 response, and lands in the catch below.
        const resp = await fetch(audioUrl, { signal: controller.signal });
        if (!resp.ok) throw new Error(`fetch ${audioUrl} ${resp.status}`);
        const buf = await resp.arrayBuffer();
        if (cancelled) return;

        const Ctx =
          typeof OfflineAudioContext !== 'undefined'
            ? OfflineAudioContext
            : (
                globalThis as {
                  OfflineAudioContext?: typeof OfflineAudioContext;
                }
              ).OfflineAudioContext;
        if (!Ctx) throw new Error('OfflineAudioContext unavailable');
        const ctx = new Ctx(1, 1, 44100);
        const audioBuffer = await ctx.decodeAudioData(buf);
        if (cancelled) return;
        const samples = audioBuffer.getChannelData(0);

        worker = createWorker();
        const result = await new Promise<WaveformPeaks>((resolve, reject) => {
          if (!worker) {
            reject(new Error('worker init failed'));
            return;
          }
          worker.onmessage = (e: MessageEvent) => {
            const msg = e.data as
              | { type: 'peaks'; payload: WaveformPeaks }
              | { type: 'error'; message: string };
            if (msg.type === 'peaks') resolve(msg.payload);
            else reject(new Error(msg.message));
          };
          worker.postMessage({ type: 'downsample', data: samples, targetCols });
        });
        if (cancelled) return;

        cache.set(mediaId, { peaks: result, targetCols });
        setPeaks(result);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // eslint-disable-next-line no-console
        console.warn('[useWaveformPeaks] worker path failed:', err);
        setStatus('error');
        setPeaks(null);
      } finally {
        worker?.terminate();
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      worker?.terminate();
    };
  }, [mediaId, audioUrl, targetCols, createWorker]);

  return { peaks, status };
}
