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

    // Retry state per mediaId. Tracks how many attempts have been made
    // and any pending setTimeout for the next attempt. Without this,
    // every store update (clip resize/move) re-tries failed URLs —
    // flooding the console with the same error and, worse, racing
    // AudioEngine.play() into AbortError because the video-side
    // onerror handler triggers a pause() partway through play().
    //
    // Policy:
    //  - 5 attempts max, exponential backoff: 5s, 10s, 20s, 40s, 80s
    //    between consecutive attempts (~155s total before giving up).
    //    Designed for unstable mobile/travel connections — short
    //    blips get caught by attempt 2 (5s later); longer outages
    //    get progressively-rarer retries to save battery & data.
    //  - HTMLMediaElement code=4 (MEDIA_ERR_SRC_NOT_SUPPORTED — CORS,
    //    codec, 404) bypasses the retry loop entirely. These errors
    //    are by nature permanent: retrying won't make a missing/
    //    CORS-blocked URL become accessible. ONE log per failed
    //    media, then we give up immediately.
    //  - Other codes (1=ABORTED, 2=NETWORK, 3=DECODE) get the full
    //    retry sequence — network and decode errors are sometimes
    //    transient, especially on flaky mobile connections.
    //
    // After give-up the entry stays in the map (with timerId=null)
    // to block further reconciler triggers. unload() on clip removal
    // clears the entry so a re-added clip gets a fresh attempt.
    const RETRY_MAX_ATTEMPTS = 5;
    const RETRY_BASE_MS = 5_000;
    type RetryState = {
      attempts: number;
      timerId: ReturnType<typeof setTimeout> | null;
    };
    const retryState = new Map<string, RetryState>();

    /** Exponential backoff: 5s, 10s, 20s, 40s, 80s. */
    function getRetryDelay(attemptsSoFar: number): number {
      return RETRY_BASE_MS * Math.pow(2, attemptsSoFar - 1);
    }

    /** Detect HTMLMediaElement `code=4 MEDIA_ERR_SRC_NOT_SUPPORTED` by
     *  parsing the engine's error message (engine.ts formats it as
     *  `... — code=N (message)`). Centralising the parse here keeps
     *  the engine's error contract simple — string only, no typed
     *  error subclass — while still letting the hook differentiate
     *  permanent vs transient failures. */
    function isPermanentError(err: unknown): boolean {
      const msg = err instanceof Error ? err.message : String(err);
      return /\bcode=4\b/.test(msg);
    }

    function attemptLoad(mediaId: string, url: string): void {
      const state = retryState.get(mediaId) ?? { attempts: 0, timerId: null };
      state.attempts += 1;
      state.timerId = null;
      retryState.set(mediaId, state);

      const { setVideoLoadProgress } = useAppStore.getState().mediaActions;
      void newEngine!
        .load(mediaId, url, (received, total) => {
          // Push live download progress into the store so MediaLibrary
          // can render a progress bar under the video tile.
          setVideoLoadProgress(mediaId, received, total);
        })
        .then(
        () => {
          // Success — drop the entry so future re-additions get a clean slate.
          retryState.delete(mediaId);
        },
        (err: unknown) => {
          if (isPermanentError(err)) {
            // eslint-disable-next-line no-console
            console.warn(
              `[useVideoEngine] permanent error for ${mediaId} (code=4 — CORS / codec / missing file) — not retrying. Fix the source URL and re-add the clip, or reload the page:`,
              err
            );
            // Leave in retryState with attempts at current value (no timer)
            // so reconciler skips it permanently for this session.
            return;
          }
          if (state.attempts >= RETRY_MAX_ATTEMPTS) {
            // eslint-disable-next-line no-console
            console.warn(
              `[useVideoEngine] giving up on ${mediaId} after ${state.attempts} attempts:`,
              err
            );
            return;
          }
          const delay = getRetryDelay(state.attempts);
          // eslint-disable-next-line no-console
          console.warn(
            `[useVideoEngine] load failed for ${mediaId} (attempt ${state.attempts}/${RETRY_MAX_ATTEMPTS}), retrying in ${delay / 1000}s:`,
            err
          );
          state.timerId = setTimeout(() => {
            state.timerId = null;
            // Refetch the URL from the current store — the user may have
            // re-uploaded the clip to a new R2 key while we were waiting.
            const currentRefs = useAppStore.getState().media.mediaRefs;
            const currentRef = currentRefs.find(
              (m) => m.id === mediaId && m.kind === 'video'
            );
            if (!currentRef) {
              // Clip was removed during the wait — drop retry state.
              retryState.delete(mediaId);
              return;
            }
            attemptLoad(mediaId, currentRef.url);
          }, delay);
        }
      );
    }

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
        // Skip if a retry is already pending or we've given up.
        // Pending timer → wait; attempts at max → permanently failed.
        if (retryState.has(id)) continue;
        const ref = mediaRefs.find((m) => m.id === id && m.kind === 'video');
        if (!ref) continue;
        attemptLoad(id, ref.url);
      }
      for (const id of loaded) {
        if (!wanted.has(id)) newEngine.unload(id);
      }
      // Drop retry state for mediaIds whose clips have been removed —
      // cancels pending timers and gives a fresh slate if the user
      // re-adds the clip later. Permanently-failed entries (attempts
      // at MAX, no timer) also get cleared by this loop.
      for (const id of [...retryState.keys()]) {
        if (!wanted.has(id)) {
          const s = retryState.get(id);
          if (s?.timerId !== null && s?.timerId !== undefined) clearTimeout(s.timerId);
          retryState.delete(id);
        }
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
      // Cancel any pending retry timers so they don't fire after the
      // engine is destroyed (Strict Mode mount → unmount → remount).
      for (const s of retryState.values()) {
        if (s.timerId !== null) clearTimeout(s.timerId);
      }
      retryState.clear();
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
