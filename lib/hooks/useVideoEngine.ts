'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { createVideoEngine, type VideoEngine } from '@/lib/video/engine';

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
 * with the timeline:
 *
 *  1. **Lazy load reconciler** — every store update that changes the
 *     set of video mediaIds referenced by active clips triggers an
 *     engine.load for new ids and engine.unload for removed ids. We
 *     never preload the entire media library (a single 1080p video
 *     can be 100+ MB of decoded buffer).
 *
 *  2. **Playback sync** — store subscription watches `playhead.playing`
 *     and `playhead.beats`. Play/pause toggles propagate to every
 *     loaded element. A beat change WHILE paused triggers
 *     `seekAllTo(secFromBeat)` so a manual scrub updates the video
 *     frame in the preview.
 *
 *  3. **Cleanup on unmount** — `engine.destroy()` releases all
 *     elements + their decoded buffers.
 */
export function useVideoEngine(): UseVideoEngineReturn {
  const engineRef = useRef<VideoEngine | null>(null);
  if (engineRef.current === null && typeof window !== 'undefined') {
    engineRef.current = createVideoEngine();
  }

  // Stable key for the active video mediaId set — used as a dependency
  // for the reconciler effect below.
  const activeIdsKey = useAppStore((s) =>
    [
      ...new Set(
        s.timeline.clips
          .filter((c) => c.kind === 'video' && typeof c.mediaId === 'string')
          .map((c) => c.mediaId as string)
      )
    ]
      .sort()
      .join(',')
  );

  const mediaRefs = useAppStore((s) => s.media.mediaRefs);

  // Reconciler: load newly-referenced videos, unload removed ones.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const wanted = new Set(activeIdsKey.split(',').filter((s) => s.length > 0));
    const loaded = new Set(engine.loadedIds());

    // Load anything wanted that isn't loaded yet.
    for (const id of wanted) {
      if (loaded.has(id)) continue;
      const ref = mediaRefs.find((m) => m.id === id && m.kind === 'video');
      if (!ref) continue;
      void engine.load(id, ref.url).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`[useVideoEngine] failed to load ${id}:`, err);
      });
    }
    // Unload anything loaded that isn't wanted anymore.
    for (const id of loaded) {
      if (!wanted.has(id)) engine.unload(id);
    }
  }, [activeIdsKey, mediaRefs]);

  // Playback + seek sync.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const unsub = useAppStore.subscribe((state, prev) => {
      const wasPlaying = prev.timeline.playhead.playing;
      const isPlaying = state.timeline.playhead.playing;
      if (isPlaying && !wasPlaying) engine.play();
      if (!isPlaying && wasPlaying) engine.pause();

      // Seek-while-paused: user is scrubbing.
      if (
        !isPlaying &&
        state.timeline.playhead.beats !== prev.timeline.playhead.beats
      ) {
        const grid = state.audio.grid;
        const sec =
          (state.timeline.playhead.beats * 60) / grid.bpm +
          grid.offsetMs / 1000;
        void engine.seekAllTo(sec);
      }
    });
    return unsub;
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
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
    () => ({ getElement, engine: engineRef.current }),
    [getElement]
  );
}
