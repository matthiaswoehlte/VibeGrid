'use client';
import { useEffect, useRef } from 'react';
import { createRenderer } from '@/lib/renderer/loop';
import { createImageBitmapCache } from '@/lib/renderer/image-cache';
import { attachDprObserver } from '@/lib/renderer/dpr';
import { useAppStore } from '@/lib/store';

export interface UseRendererOptions {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  getCurrentTime: () => number;
  getSeekCounter?: () => number;
}

/**
 * Mounts a renderer + image cache + DPR observer against `canvasRef`. The hook
 * is intentionally NOT reactive to `getCurrentTime` / `getSeekCounter` — those
 * are kept in refs so callers can pass fresh arrow functions every render
 * without the effect tearing the renderer down. The renderer is set up exactly
 * once per canvas mount and torn down on unmount.
 */
export function useRenderer({ canvasRef, getCurrentTime, getSeekCounter }: UseRendererOptions): void {
  const cacheRef = useRef(createImageBitmapCache());
  const getCurrentTimeRef = useRef(getCurrentTime);
  const getSeekCounterRef = useRef(getSeekCounter);
  // Keep refs in sync with the latest props — runs on every render, no re-mount.
  getCurrentTimeRef.current = getCurrentTime;
  getSeekCounterRef.current = getSeekCounter;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Capture the cache instance once so the cleanup closure doesn't follow
    // a future ref reassignment (React-hooks lint rule).
    const cache = cacheRef.current;
    const ctx = canvas.getContext('2d');

    // Prime the cache from any mediaRefs already in the store (post-rehydrate).
    const initial = useAppStore.getState().media.mediaRefs;
    initial
      .filter((m) => m.kind === 'image')
      .forEach((m) => {
        cache.load(m.id, m.url).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(
            `[useRenderer] failed to load image ${m.id} from ${m.url}:`,
            err
          );
        });
      });

    // Keep the cache in sync with subsequent additions / removals.
    const unsubMedia = useAppStore.subscribe((state, prev) => {
      const added = state.media.mediaRefs.filter(
        (m) => m.kind === 'image' && !prev.media.mediaRefs.find((p) => p.id === m.id)
      );
      const removed = prev.media.mediaRefs.filter(
        (m) => m.kind === 'image' && !state.media.mediaRefs.find((p) => p.id === m.id)
      );
      added.forEach((m) => {
        cache.load(m.id, m.url).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(
            `[useRenderer] failed to load image ${m.id} from ${m.url}:`,
            err
          );
        });
      });
      removed.forEach((m) => cache.evict(m.id));
    });

    const renderer = createRenderer({
      canvas,
      getCurrentTime: () => getCurrentTimeRef.current(),
      getBeatGrid: () => useAppStore.getState().audio.grid,
      getTimelineState: () => useAppStore.getState().timeline,
      getImageBitmap: (mediaId) => cache.get(mediaId),
      getSeekCounter: () => getSeekCounterRef.current?.() ?? 0
    });

    // DPR sizing — dpr.ts only computes; we set canvas.width/height and apply
    // ctx.setTransform here so renderer draws in CSS-pixel coordinates.
    const stopResize = attachDprObserver(canvas, ({ pxWidth, pxHeight, dpr }) => {
      canvas.width = pxWidth;
      canvas.height = pxHeight;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    });

    renderer.start();
    return () => {
      renderer.stop();
      stopResize();
      unsubMedia();
      cache.clear();
    };
    // Intentionally empty deps — refs above carry the latest callbacks.
    // canvasRef is a stable RefObject; React guarantees its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
