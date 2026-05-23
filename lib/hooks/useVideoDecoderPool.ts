'use client';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import {
  createVideoDecoderPool,
  type VideoDecoderPool
} from '@/lib/video/decoder-pool';

/**
 * Plan 5.10+ — long-lived VideoDecoderPool that pre-loads video MP4s
 * as soon as they're referenced by a timeline clip. Mirrors the
 * reconciler pattern in `useVideoEngine` (mediaRefs + clips → engine
 * state) but for the decoder pool, so by the time the user clicks
 * Export every needed video is already demuxed + decoder-configured.
 * Avoids the 30-60s "downloading 143 MB" wait on every Export click.
 *
 * Loads are tracked in three states:
 *   - in `pool.loadedIds()` → done, ready for getFrameAt
 *   - in `loadingRef` → fetch in flight, don't re-trigger
 *   - in `failedRef` → load rejected, don't retry this session
 *
 * Live-preview video pool (`useVideoEngine` / VideoEngine /
 * HTMLVideoElement) is unaffected — different concern, different
 * access pattern, runs in parallel.
 */
export function useVideoDecoderPool(): VideoDecoderPool | null {
  const [pool, setPool] = useState<VideoDecoderPool | null>(null);
  const loadingRef = useRef<Set<string>>(new Set());
  const failedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const newPool = createVideoDecoderPool();
    if (!newPool) return;
    setPool(newPool);

    function reconcile(): void {
      const state = useAppStore.getState();
      const wanted = new Set<string>();
      for (const clip of state.timeline.clips) {
        if (clip.kind === 'video' && typeof clip.mediaId === 'string') {
          wanted.add(clip.mediaId);
        }
      }
      const loaded = new Set(newPool!.loadedIds());
      for (const id of wanted) {
        if (loaded.has(id)) continue;
        if (loadingRef.current.has(id)) continue;
        if (failedRef.current.has(id)) continue;
        const ref = state.media.mediaRefs.find(
          (m) => m.id === id && m.kind === 'video'
        );
        if (!ref?.url) continue;
        loadingRef.current.add(id);
        newPool!.load(id, ref.url).then(
          () => {
            loadingRef.current.delete(id);
          },
          (err: unknown) => {
            loadingRef.current.delete(id);
            failedRef.current.add(id);
            // eslint-disable-next-line no-console
            console.warn(
              `[useVideoDecoderPool] background pre-load failed for ${id}:`,
              err
            );
          }
        );
      }
    }

    reconcile();
    const unsub = useAppStore.subscribe((state, prev) => {
      if (
        state.timeline.clips !== prev.timeline.clips ||
        state.media.mediaRefs !== prev.media.mediaRefs
      ) {
        reconcile();
      }
    });

    return () => {
      unsub();
      newPool.destroy();
      loadingRef.current.clear();
      failedRef.current.clear();
      setPool(null);
    };
  }, []);

  return pool;
}
