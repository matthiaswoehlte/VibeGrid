'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { createVideoEngine, type VideoEngine } from '@/lib/video/engine';
import type { TimelineState, Clip } from '@/lib/timeline/types';
import type { MediaRef } from '@/lib/storage/types';
import type { AppState } from '@/lib/store/types';

// Plan 8d — drift tolerance for native video playback vs the audio-
// driven timeline clock. The two clocks aren't bit-identical, so we
// only seek-correct when the drift exceeds this; otherwise we let
// native playback advance at its own rate (re-seeking every frame
// would interrupt the decoder and visibly stutter).
const VIDEO_DRIFT_TOLERANCE_S = 0.2;

/**
 * Plan 8d — for a video mediaId, find the clip that is currently
 * ACTIVE at the playhead (any clip whose [startBeat, startBeat +
 * lengthBeats) contains the current beat), and compute the source-
 * relative time the video element should be at.
 *
 * Returns null when no referencing clip is active. The caller should
 * pause the element in that case.
 *
 * This is the live-preview counterpart of the offline-render formula:
 *   sourceTime = globalTime - clipStartSec + sourceInPointSec
 * documented in docs/architecture/export-pipeline.md ("Source-relative
 * Time-Mapping"). Without it, multi-clip-per-track scenarios (e.g. a
 * SceneFlow Transfer with four scene clips on one main-video track)
 * leave scenes 2-N frozen on whatever frame the native decoder
 * happened to deliver when the user hit Play.
 */
function findActiveSourceTime(
  state: AppState,
  mediaId: string
): { sourceTimeSec: number; videoDurationHint: number | null } | null {
  const beats = state.timeline.playhead.beats;
  const bpm = state.audio.grid.bpm || 120;
  for (const clip of state.timeline.clips) {
    if (clip.mediaId !== mediaId) continue;
    if (clip.kind !== 'video') continue;
    if (beats < clip.startBeat || beats >= clip.startBeat + clip.lengthBeats) {
      continue;
    }
    const sourceInPointSec =
      (clip.params as { sourceInPointSec?: number } | undefined)
        ?.sourceInPointSec ?? 0;
    const sourceTimeSec =
      ((beats - clip.startBeat) * 60) / bpm + sourceInPointSec;
    // mediaRef.duration is a hint — useful to know when target exceeds
    // the source's actual length so we freeze on the last frame rather
    // than letting the video element loop back to 0 on play().
    const ref = state.media.mediaRefs.find((m) => m.id === mediaId);
    return {
      sourceTimeSec,
      videoDurationHint: ref?.duration ?? null
    };
  }
  return null;
}

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
  // Hand for the load()-success path to invoke the latest
  // syncVideoPlayback closure (captured fresh on each engine init).
  const syncOnLoadRef = useRef<(() => void) | null>(null);

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
          // Plan 8d — immediately sync the newly-loaded element's
          // play/pause/currentTime against the current timeline state.
          // Without this, a scene that finishes loading AFTER the user
          // hit Play stays paused at frame 0 forever (the subscription
          // already fired with this mediaId NOT in loadedIds()).
          syncOnLoadRef.current?.();
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

    /**
     * Plan 8d — per-clip playback sync. Replaces the old engine.play()-
     * everything approach which broke multi-clip-per-track scenarios.
     *
     * For each loaded video element:
     *  - If a clip referencing it is active at the current playhead AND
     *    the timeline is playing: seek to source-relative time (only if
     *    drift exceeds tolerance) and play().
     *  - If active but timeline paused: seek to source-relative time
     *    and ensure the element is paused (for scrubbing).
     *  - If no referencing clip is active: pause the element.
     *
     * Called from the subscription on every relevant state change AND
     * from the load() success path so newly-loaded videos get into
     * sync the moment their bytes arrive.
     */
    function syncVideoPlayback(state: AppState): void {
      if (!newEngine) return;
      const isPlaying = state.timeline.playhead.playing;
      for (const mediaId of newEngine.loadedIds()) {
        const el = newEngine.getElement(mediaId);
        if (!el) continue;
        const active = findActiveSourceTime(state, mediaId);
        if (!active) {
          // No referencing clip active at the playhead — pause and reset
          // to the start so the next time this video becomes active we
          // see frame 0 rather than wherever native playback drifted to.
          if (!el.paused) el.pause();
          if (el.currentTime !== 0) {
            try {
              el.currentTime = 0;
            } catch {
              /* ignore — element may not yet be seekable */
            }
          }
          continue;
        }
        // Clamp target to the video duration (the clip can outlast the
        // source if snap rounding stretched lengthBeats — without the
        // clamp, play() on a video at currentTime>=duration loops back
        // to 0 and we get a flicker at the boundary).
        const target =
          active.videoDurationHint !== null && active.videoDurationHint > 0
            ? Math.min(active.sourceTimeSec, active.videoDurationHint - 0.01)
            : active.sourceTimeSec;
        if (Math.abs(el.currentTime - target) > VIDEO_DRIFT_TOLERANCE_S) {
          try {
            el.currentTime = Math.max(0, target);
          } catch {
            /* not seekable yet — will retry next tick */
          }
        }
        if (isPlaying) {
          if (el.paused) {
            el.play().catch(() => {
              /* autoplay-blocked is OK; user re-clicks Play */
            });
          }
        } else if (!el.paused) {
          el.pause();
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

      // Per-clip playback sync — fires on play/pause toggle, on every
      // playhead-beats advance, and when clips themselves change (so
      // newly-added clips immediately get into sync).
      if (
        state.timeline.playhead.playing !== prev.timeline.playhead.playing ||
        state.timeline.playhead.beats !== prev.timeline.playhead.beats ||
        state.timeline.clips !== prev.timeline.clips
      ) {
        syncVideoPlayback(state);
      }
    });

    // Expose syncVideoPlayback to the load-success path via a closure-
    // captured reference. Newly-loaded videos need an immediate sync —
    // they weren't in `loadedIds()` when the last subscriber tick ran.
    syncOnLoadRef.current = () =>
      syncVideoPlayback(useAppStore.getState());

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
      syncOnLoadRef.current = null;
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
