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

  // Auto-load the SYNC audio MediaRef into the engine.
  //
  // The `<audio>` element wired up by `engine.load` is the *time-source*
  // for the playhead — its `timeupdate` event drives `engine.currentTime`,
  // which drives the visual playhead AND the renderer's `getCurrentTime`.
  // After Plan 5.9d (Multi-Audio) it's also kept MUTED, because the
  // audible audio comes from the per-clip reconciler below.
  //
  // CRITICAL — only sync audio belongs here. The original implementation
  // picked "the most recently added audio MediaRef" which worked while a
  // project's only audio MediaRef WAS the sync song. Multi-Audio (Plan
  // 5.9d), user-uploaded audio clips, and Sound Library drops (Plan 8.7)
  // all invalidate that assumption: replacing audioEl with a short
  // Library MP3 (~3 s) makes timeupdate stop firing after the file
  // ends — playhead + canvas freeze while per-clip BufferSources still
  // play the actual song audibly (exactly the bug Matthias hit after
  // dragging VG_BOOM-CUNNING onto an audio track).
  //
  // Convention: sync-audio MediaRefs use the id prefix `sync-` (set by
  // SyncAudioDropZone and the SceneFlow Transfer flow). Library
  // (`library-…`) and multi-audio (raw UUID) refs do NOT match, so this
  // filter cleanly routes only the sync source into `engine.load`.
  useEffect(() => {
    if (!engine) return;
    const muteAutoloaded = (): void => {
      const audioEl = engine.getAudioElement();
      if (audioEl) audioEl.muted = true;
    };
    const isSyncAudioRef = (m: MediaRef): boolean =>
      m.kind === 'audio' && m.id.startsWith('sync-');
    // Prime once on mount from current state (handles rehydrated mediaRefs).
    const initialSync = useAppStore
      .getState()
      .media.mediaRefs.find(isSyncAudioRef);
    if (initialSync) {
      engine.load(initialSync.url).then(muteAutoloaded).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[useAudioEngine] initial sync-audio load failed:', err);
      });
    }
    // Subscribe to future sync-audio additions only.
    const unsub = useAppStore.subscribe((state, prev) => {
      const added = state.media.mediaRefs.filter(
        (m) =>
          isSyncAudioRef(m) &&
          !prev.media.mediaRefs.find((p) => p.id === m.id)
      );
      const latestSync = added[added.length - 1];
      if (latestSync) {
        engine.load(latestSync.url).then(muteAutoloaded).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('[useAudioEngine] sync-audio load failed:', err);
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
      //
      // CRITICAL: distinguish USER-INITIATED seek from natural playback
      // advance. `useAudioEngine`'s currentTime mirror writes
      // playhead.beats on every audioEl `timeupdate` event (~4-25 Hz
      // depending on browser). Without this gate, every timeupdate
      // tick during playback would tear down and restart every audio
      // source — audible as a rapid pulsing / glitching glued to the
      // playhead-tick frequency (smoke-reported as "volume pulses to
      // the beat" in Bug C). User-initiated seeks are characterised
      // by either:
      //   - a rewind (beats < prev.beats), or
      //   - a forward jump larger than any single timeupdate could
      //     produce (> 1.0 beats = 500 ms @ 120 BPM).
      const beatsDelta =
        state.timeline.playhead.beats - prev.timeline.playhead.beats;
      const isUserSeek = beatsDelta < 0 || beatsDelta > 1.0;
      if (isPlaying && wasPlaying && isUserSeek) {
        engine.stopAllClips();
        startAllActiveClips(state.timeline, engine, bpm, LOOKAHEAD);
      }
    });

    return unsub;
  }, [engine]);

  return { engine };
}
