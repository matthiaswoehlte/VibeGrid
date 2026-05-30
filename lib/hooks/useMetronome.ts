'use client';
/**
 * Plan 9c.2 T5 — metronome wiring hook.
 *
 * Starts/stops the look-ahead metronome scheduler based on the conjunction
 * of two store fields:
 *   - `ui.metronomeEnabled`  (persistent toggle, Plan 9c.2 T5)
 *   - `timeline.playhead.playing`  (playback gate)
 *
 * Design decisions:
 *   - Accepts `engine: AudioEngine | null` as a parameter (not via
 *     `getAudioEngine()` singleton) so the caller — StudioPage — passes
 *     the SAME instance it got from `useAudioEngine`. Both hooks therefore
 *     share one AudioContext clock without extra coupling.
 *   - The metronome instance is created once and reused for every
 *     start/stop cycle (lazy ref). It is recreated if the engine changes
 *     (engine effect dependency), but NOT on every play/pause toggle.
 *   - SSR-safe: all logic runs inside useEffect. Nothing executes at
 *     module top level.
 *   - Seek-robust: `createMetronome` already handles seek re-seeding
 *     internally (MAX_SCHEDULE_DRIFT_BEATS guard in T4). No stop/start
 *     on seek is needed here.
 *   - Runs even with a sync soundtrack loaded — the engine's AudioContext
 *     exists from the first `play()` call regardless of whether `audioEl`
 *     is present.
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { createMetronome, type Metronome } from '@/lib/audio/metronome';
import type { AudioEngine } from '@/lib/audio/engine';

export function useMetronome(engine: AudioEngine | null): void {
  const metronomeRef = useRef<Metronome | null>(null);

  useEffect(() => {
    if (!engine) return;

    // Capture engine in a local variable so TypeScript can narrow it as
    // non-null inside the nested `sync` closure (the `if (!engine) return`
    // guard above doesn't flow into closures defined after it).
    const eng = engine;

    // Synchronise metronome state with the store. We subscribe to the store
    // so we re-run when either `metronomeEnabled` or `playing` changes.
    function sync(): void {
      const state = useAppStore.getState();
      const enabled = state.ui.metronomeEnabled;
      const playing = state.timeline.playhead.playing;

      if (enabled && playing) {
        // Lazily create the metronome on first activation.
        if (!metronomeRef.current) {
          const audioCtx = eng.getAudioContext();
          if (!audioCtx) {
            // AudioContext not yet available (engine not started) — skip.
            return;
          }
          metronomeRef.current = createMetronome({
            audioContext: audioCtx,
            getContextTime: () => eng.getContextTime(),
            getCurrentTime: () => eng.getState().currentTime,
            getGrid: () => useAppStore.getState().audio.grid
          });
        }
        metronomeRef.current.start();
      } else {
        // Either disabled or paused — stop if running.
        metronomeRef.current?.stop();
      }
    }

    // Run once synchronously to align with current state on mount.
    sync();

    // Subscribe to future store changes.
    const unsub = useAppStore.subscribe(sync);

    return () => {
      unsub();
      // Stop the metronome on unmount (and on engine change before re-run).
      metronomeRef.current?.stop();
      // Drop the instance so the next engine gets a fresh one.
      metronomeRef.current = null;
    };
  }, [engine]);
}
