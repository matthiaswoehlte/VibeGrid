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
  /** Plan-5.9b — threaded through to createRenderer's RendererDeps so
   *  the live preview can draw the current frame of each loaded video. */
  getVideoElement?: (mediaId: string) => HTMLVideoElement | null;
}

export interface UseRendererReturn {
  /** Plan-6-R: read-only accessor into the hook's private ImageBitmap cache.
   *  The offline export pipeline (`useVideoExporter` → `renderOffline`)
   *  passes this through so the offline render shares the same loaded
   *  bitmaps as the live preview — no re-fetch from R2, no duplicate
   *  decode. Returns `undefined` when the bitmap isn't loaded yet. */
  getBitmap: (mediaId: string) => ImageBitmap | undefined;
}

/**
 * Mounts a renderer + image cache + DPR observer against `canvasRef`. The hook
 * is intentionally NOT reactive to `getCurrentTime` / `getSeekCounter` — those
 * are kept in refs so callers can pass fresh arrow functions every render
 * without the effect tearing the renderer down. The renderer is set up exactly
 * once per canvas mount and torn down on unmount.
 */
export function useRenderer({
  canvasRef,
  getCurrentTime,
  getSeekCounter,
  getVideoElement
}: UseRendererOptions): UseRendererReturn {
  const cacheRef = useRef(createImageBitmapCache());
  const getBitmapRef = useRef<(mediaId: string) => ImageBitmap | undefined>(
    (mediaId) => cacheRef.current.get(mediaId)
  );
  const getCurrentTimeRef = useRef(getCurrentTime);
  const getSeekCounterRef = useRef(getSeekCounter);
  const getVideoElementRef = useRef(getVideoElement);
  // Keep refs in sync with the latest props — runs on every render, no re-mount.
  getCurrentTimeRef.current = getCurrentTime;
  getSeekCounterRef.current = getSeekCounter;
  getVideoElementRef.current = getVideoElement;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Capture the cache instance once so the cleanup closure doesn't follow
    // a future ref reassignment (React-hooks lint rule).
    const cache = cacheRef.current;
    const ctx = canvas.getContext('2d');

    // Prime the cache from any mediaRefs already in the store (post-rehydrate).
    const initial = useAppStore.getState().media.mediaRefs;
    const warnUnlessCancelled = (m: { id: string; url: string }) => (err: unknown) => {
      // Strict Mode double-mount cancels the first inflight; the second mount
      // re-loads cleanly. Suppress that benign warning; report everything else.
      if (err instanceof Error && err.message.includes('cancelled by evict')) return;
      // eslint-disable-next-line no-console
      console.warn(
        `[useRenderer] failed to load image ${m.id} from ${m.url}:`,
        err
      );
    };

    initial
      .filter((m) => m.kind === 'image')
      .forEach((m) => {
        cache.load(m.id, m.url).catch(warnUnlessCancelled(m));
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
        cache.load(m.id, m.url).catch(warnUnlessCancelled(m));
      });
      removed.forEach((m) => cache.evict(m.id));
    });

    const renderer = createRenderer({
      canvas,
      getCurrentTime: () => getCurrentTimeRef.current(),
      getBeatGrid: () => useAppStore.getState().audio.grid,
      getTimelineState: () => useAppStore.getState().timeline,
      getImageBitmap: (mediaId) => cache.get(mediaId),
      getVideoElement: (mediaId) =>
        getVideoElementRef.current?.(mediaId) ?? null,
      getSeekCounter: () => getSeekCounterRef.current?.() ?? 0,
      getFlowMode: () => useAppStore.getState().ui.flowMode
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

  // Stable identity across renders — the consumer (useVideoExporter via
  // page.tsx) shouldn't have to re-wire the offline pipeline every time
  // the parent re-renders.
  return { getBitmap: getBitmapRef.current };
}
