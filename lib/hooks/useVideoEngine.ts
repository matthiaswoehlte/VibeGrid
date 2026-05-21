'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { createVideoEngine, type VideoEngine } from '@/lib/video/engine';
import type { TimelineState, Clip } from '@/lib/timeline/types';
import type { MediaRef } from '@/lib/storage/types';

export interface UseVideoEngineReturn {
  /** Stable accessor across re-renders. Returns `null` when the
   *  requested video hasn't finished loading yet. */
  getElement: (mediaId: string) => HTMLVideoElement | null;
  /** The underlying engine — passed straight through to
   *  `renderOffline` so the offline path can await `seekAllTo`. */
  engine: VideoEngine | null;
}

/**
 * Plan 5.9b — owns a `VideoEngine` and keeps its element pool in sync
 * with the timeline.
 *
 * **Strict-Mode lifecycle fix**: in dev, React mounts an effect, runs
 * its cleanup, then mounts it again — WITHOUT re-running the
 * component body. An older version of this hook split the engine
 * creation into the component body (`if (engineRef.current === null)
 * engineRef.current = createVideoEngine()`) and the subscription into
 * a separate `useEffect([])`. The cleanup nulled out the ref; the
 * remount of the subscription effect then ran with a stale null
 * engine reference and never subscribed. Result: `engine.play()` was
 * never called when the user hit Play — the video stayed paused at
 * frame 0 even though the loaded element was visible in the live
 * preview's first-frame draw.
 *
 * Fix: ONE master `useEffect` that owns the full lifecycle — engine
 * creation, the store subscription that drives lazy load / play
 * sync / seek-while-paused, and the cleanup that destroys the engine.
 * Strict Mode now safely creates → destroys → re-creates without
 * stranding a subscription on a dead reference.
 */
export function useVideoEngine(): UseVideoEngineReturn {
  const engineRef = useRef<VideoEngine | null>(null);
  // Reactive engine reference so consumers re-render once the engine is
  // actually available. The `engineRef` is kept in parallel so the
  // stable `getElement` closure can read the latest engine without
  // capturing a stale value through the React state.
  const [engine, setEngine] = useState<VideoEngine | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const newEngine = createVideoEngine();
    if (!newEngine) return;
    engineRef.current = newEngine;
    setEngine(newEngine);

    /** Diff the desired video-element set against the loaded set and
     *  call `engine.load/unload` to match. Runs at mount + on every
     *  relevant store change. */
    function reconcile(timeline: TimelineState, mediaRefs: MediaRef[]): void {
      if (!newEngine) return;
      const wanted = new Set(
        timeline.clips
          .filter((c: Clip) => c.kind === 'video' && typeof c.mediaId === 'string')
          .map((c: Clip) => c.mediaId as string)
      );
      const loaded = new Set(newEngine.loadedIds());

      for (const id of wanted) {
        if (loaded.has(id)) continue;
        const ref = mediaRefs.find((m) => m.id === id && m.kind === 'video');
        if (!ref) continue;
        void newEngine.load(id, ref.url).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(`[useVideoEngine] failed to load ${id}:`, err);
        });
      }
      for (const id of loaded) {
        if (!wanted.has(id)) newEngine.unload(id);
      }
    }

    // Initial reconcile — load anything already in the rehydrated store.
    const initial = useAppStore.getState();
    reconcile(initial.timeline, initial.media.mediaRefs);

    // ONE subscription handles both reconciler updates AND playback sync.
    const unsub = useAppStore.subscribe((state, prev) => {
      // Reconciler — only re-diff when clips or mediaRefs actually changed.
      if (
        state.timeline.clips !== prev.timeline.clips ||
        state.media.mediaRefs !== prev.media.mediaRefs
      ) {
        reconcile(state.timeline, state.media.mediaRefs);
      }

      // Play / pause sync.
      const wasPlaying = prev.timeline.playhead.playing;
      const isPlaying = state.timeline.playhead.playing;
      if (isPlaying && !wasPlaying) newEngine.play();
      if (!isPlaying && wasPlaying) newEngine.pause();

      // Seek-while-paused: user is scrubbing.
      if (
        !isPlaying &&
        state.timeline.playhead.beats !== prev.timeline.playhead.beats
      ) {
        const grid = state.audio.grid;
        const sec =
          (state.timeline.playhead.beats * 60) / grid.bpm +
          grid.offsetMs / 1000;
        void newEngine.seekAllTo(sec);
      }
    });

    return () => {
      unsub();
      newEngine.destroy();
      engineRef.current = null;
      setEngine(null);
    };
  }, []);

  // Stable wrapper — the `getElement` reference must not churn across
  // renders, otherwise downstream `useMemo`/`useEffect` deps trigger
  // unnecessary work.
  const getElement = useMemo(
    () =>
      (mediaId: string): HTMLVideoElement | null =>
        engineRef.current?.getElement(mediaId) ?? null,
    []
  );

  return useMemo(
    () => ({ getElement, engine }),
    [getElement, engine]
  );
}
