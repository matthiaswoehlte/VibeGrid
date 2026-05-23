'use client';
import { useEffect, useState } from 'react';
import {
  createVideoDecoderPool,
  type VideoDecoderPool
} from '@/lib/video/decoder-pool';

/**
 * Plan 5.10+ — long-lived VideoDecoderPool. Creates the pool ONCE per
 * page mount and returns the SAME instance for the entire session.
 *
 * Why long-lived but NO auto-load:
 * - Auto-load (reconcile against timeline clips on mount) doubled the
 *   bandwidth: live preview's <video> elements already fetch the
 *   videos via the browser's media pipeline; an additional fetch
 *   from the decoder pool ran in parallel, since neither path shares
 *   bytes with the other. R2's `Cache-Control: no-cache` forces full
 *   re-download on the second fetch too (browser revalidates but
 *   gets 200 not 304). Result: 2× MB on app start.
 * - On-demand only (load at Export click) avoided the bandwidth
 *   waste but meant 30-60s wait every export.
 * - Compromise (this hook): pool is long-lived, useVideoExporter
 *   triggers loads at first Export click. SECOND export reuses the
 *   already-loaded videos — instant. Iterative debugging (re-export
 *   to test a small change) doesn't re-fetch.
 *
 * Live preview's VideoEngine (HTMLVideoElement pool) is completely
 * independent — different consumer, different access pattern.
 */
export function useVideoDecoderPool(): VideoDecoderPool | null {
  const [pool, setPool] = useState<VideoDecoderPool | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const newPool = createVideoDecoderPool();
    if (!newPool) return;
    setPool(newPool);
    return () => {
      newPool.destroy();
      setPool(null);
    };
  }, []);

  return pool;
}
