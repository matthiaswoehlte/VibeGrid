'use client';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { createAudioEngine, type AudioEngine } from '@/lib/audio/engine';
import type { TimelineState, Clip } from '@/lib/timeline/types';
import type { MediaRef } from '@/lib/storage/types';

/** Web Audio scheduler slack — clips that should "play now" are
 *  scheduled this many seconds in the future so the scheduler can
 *  align all of them on the same `whenSec`. 50 ms is the textbook
 *  value; smaller → underrun risk on slow machines, larger →
 *  perceptible play-button latency. */
const LOOKAHEAD = 0.05;

function isAudioClip(c: Clip): boolean {
  return c.kind === 'audio' && typeof c.mediaId === 'string';
}

/** Start every audio clip that's currently active at the playhead.
 *  Clips already mid-playback (currentBeat ≥ startBeat) start with
 *  the appropriate `offsetSec`; clips that begin in the future start
 *  with `offsetSec=0` and a delayed `whenSec`. All clips share the
 *  same `whenBase` so their playback is sample-aligned on the
 *  AudioContext clock. */
function startAllActiveClips(
  timeline: TimelineState,
  engine: AudioEngine,
  bpm: number,
  lookahead: number
): void {
  const currentBeat = timeline.playhead.beats;
  const whenBase = engine.getContextTime() + lookahead;
  for (const clip of timeline.clips) {
    if (!isAudioClip(clip)) continue;
    // Past the clip's end — skip.
    if (currentBeat >= clip.startBeat + clip.lengthBeats) continue;
    const clipStartSec = (clip.startBeat * 60) / bpm;
    const currentSec = (currentBeat * 60) / bpm;
    if (currentBeat >= clip.startBeat) {
      // Already playing — start mid-buffer.
      engine.playClip(clip.id, currentSec - clipStartSec, whenBase);
    } else {
      // Future start — no offset, delay `whenSec` by the gap.
      engine.playClip(clip.id, 0, whenBase + (clipStartSec - currentSec));
    }
  }
}

export interface UseAudioEngine {
  engine: AudioEngine | null;
}

/**
 * Bridge between the AudioEngine and the Zustand store.
 *
 * - User edits BPM via `setBPM` → audio-slice writes `source: 'manual'` →
 *   subscriber sees `manual` source and pushes the value to `engine.setBPM`.
 * - Engine detection writes via `setDetectedGrid` → audio-slice writes
 *   `source: 'detected'` → subscriber sees `detected` source and SKIPS the
 *   engine push (would otherwise loop).
 *
 * The source field is already part of `BeatGrid` (Plan 2), so no new actions
 * or runtime patching are needed.
 */
export function useAudioEngine(): UseAudioEngine {
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const lastSeenBpmRef = useRef<number | null>(null);

  useEffect(() => {
    const e = createAudioEngine();
    setEngine(e);
    lastSeenBpmRef.current = useAppStore.getState().audio.grid.bpm;
    return () => {
      e.destroy();
      setEngine(null);
    };
  }, []);

  useEffect(() => {
    if (!engine) return;
    const unsub = useAppStore.subscribe((state) => {
      const grid = state.audio.grid;
      if (grid.bpm === lastSeenBpmRef.current) return;
      lastSeenBpmRef.current = grid.bpm;
      // Source-guard: the BPM just changed because the ENGINE wrote it
      // (detected grid) — do not push back to the engine.
      if (grid.source === 'detected') return;
      engine.setBPM(grid.bpm);
    });
    return unsub;
  }, [engine]);

  // Mirror engine.currentTime into store.timeline.playhead.beats so the visual
  // <Playhead/> moves during playback. engine.onStateChange fires from audio's
  // timeupdate event (~4-25 Hz). Throttle: skip if delta < 0.02 beats to avoid
  // re-render spam.
  useEffect(() => {
    if (!engine) return;
    const unsub = engine.onStateChange((s) => {
      const t = s.currentTime;
      if (!Number.isFinite(t)) return;
      const grid = s.beatGrid;
      const beats = Math.max(0, ((t - grid.offsetMs / 1000) * grid.bpm) / 60);
      const current = useAppStore.getState().timeline.playhead.beats;
      if (Math.abs(current - beats) < 0.02) return;
      useAppStore.getState().timelineActions.setPlayhead(beats);
    });
    return unsub;
  }, [engine]);

  // Auto-load the most recently added audio MediaRef into the engine.
  // v0.1: kept for the engine's `cachedDecodedBuffer` API surface
  // (used by detectBPM and other diagnostic paths). After Plan 5.9d
  // shipped Multi-Audio, the `<audio>` element created by engine.load
  // is MUTED — playback comes exclusively from the per-clip
  // reconciler (`loadClip` / `playClip`) below. Without this mute,
  // Transport.play() (which calls engine.play() → audioEl.play())
  // would play the autoloaded soundtrack in parallel to the per-clip
  // path → audible double-volume.
  useEffect(() => {
    if (!engine) return;
    const muteAutoloaded = (): void => {
      const audioEl = engine.getAudioElement();
      if (audioEl) audioEl.muted = true;
    };
    // Prime once on mount from current state (handles rehydrated mediaRefs).
    const initial = useAppStore.getState().media.mediaRefs.filter((m) => m.kind === 'audio');
    const lastInitial = initial[initial.length - 1];
    if (lastInitial) {
      engine.load(lastInitial.url).then(muteAutoloaded).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[useAudioEngine] initial audio load failed:', err);
      });
    }
    // Subscribe to future audio additions.
    const unsub = useAppStore.subscribe((state, prev) => {
      const added = state.media.mediaRefs.filter(
        (m) => m.kind === 'audio' && !prev.media.mediaRefs.find((p) => p.id === m.id)
      );
      const latest = added[added.length - 1];
      if (latest) {
        engine.load(latest.url).then(muteAutoloaded).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('[useAudioEngine] audio load failed:', err);
        });
      }
    });
    return unsub;
  }, [engine]);

  // Plan 5.9d — multi-clip reconciler. Modeled on `useVideoEngine`
  // (commit 6265582): one effect closure owns the engine reference,
  // reconciles `loadClip` / `unloadClip` against the timeline, and
  // wires play / pause / seek to the per-clip API.
  useEffect(() => {
    if (!engine) return;

    function reconcile(timeline: TimelineState, mediaRefs: MediaRef[]): void {
      if (!engine) return;
      const wanted = new Set(
        timeline.clips.filter(isAudioClip).map((c) => c.id)
      );
      const loaded = new Set(engine.getLoadedClipIds());

      for (const clipId of wanted) {
        if (loaded.has(clipId)) continue;
        const clip = timeline.clips.find((c) => c.id === clipId);
        if (!clip) continue;
        const ref = mediaRefs.find((m) => m.id === clip.mediaId);
        if (!ref) continue;
        void engine.loadClip(clipId, ref.url).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(`[useAudioEngine] loadClip failed for ${clipId}:`, err);
        });
      }
      for (const clipId of loaded) {
        if (!wanted.has(clipId)) engine.unloadClip(clipId);
      }
    }

    // Initial reconcile — handles rehydrated state.
    const initial = useAppStore.getState();
    reconcile(initial.timeline, initial.media.mediaRefs);

    const unsub = useAppStore.subscribe((state, prev) => {
      // Re-diff only when clips or mediaRefs actually changed.
      if (
        state.timeline.clips !== prev.timeline.clips ||
        state.media.mediaRefs !== prev.media.mediaRefs
      ) {
        reconcile(state.timeline, state.media.mediaRefs);
      }

      const wasPlaying = prev.timeline.playhead.playing;
      const isPlaying = state.timeline.playhead.playing;
      const bpm = state.audio.grid.bpm;

      // Play (was paused → playing) — start every active clip in sync.
      if (isPlaying && !wasPlaying) {
        startAllActiveClips(state.timeline, engine, bpm, LOOKAHEAD);
      }

      // Pause (was playing → paused) — stop every clip.
      if (!isPlaying && wasPlaying) {
        engine.stopAllClips();
      }

      // Seek-while-paused — stop only; next Play restarts at the new pos.
      if (
        !isPlaying &&
        state.timeline.playhead.beats !== prev.timeline.playhead.beats
      ) {
        engine.stopAllClips();
      }

      // Seek-while-PLAYING — stop AND restart so audio re-syncs to the
      // new playhead. Placed AFTER the play-branch so a single Play
      // click doesn't double-fire startAllActiveClips.
      if (
        isPlaying &&
        wasPlaying &&
        state.timeline.playhead.beats !== prev.timeline.playhead.beats
      ) {
        engine.stopAllClips();
        startAllActiveClips(state.timeline, engine, bpm, LOOKAHEAD);
      }
    });

    return unsub;
  }, [engine]);

  return { engine };
}
