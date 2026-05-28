import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import type { AudioEngine } from '@/lib/audio/engine';

/**
 * Global Spacebar → play/pause shortcut (transport reflex).
 *
 * INTENTIONALLY fires even when an input / textarea / contenteditable is
 * focused. This is a DAW-first design decision: the user explicitly wants
 * Spacebar to always control the transport, regardless of where focus sits.
 * Contrast with useUndoRedoShortcuts which SKIPS when an input is focused.
 *
 * Mirrors the toggle logic in Transport.tsx exactly:
 *   - engine.pause() / engine.play() for the audio engine
 *   - recordingSet with { skip: true } so playhead.playing stays out of the
 *     undo history stack (Plan 10 invariant D3/L4).
 *
 * Mounted once at the Workspace level — duplicating it elsewhere would fire
 * the toggle twice per keypress.
 */
export function useTransportShortcuts(engine: AudioEngine | null): void {
  useEffect(() => {
    async function onKey(e: KeyboardEvent): Promise<void> {
      if (e.key !== ' ') return;

      // Suppress browser default (page scroll on Spacebar).
      e.preventDefault();

      // Engine-null guard: silently no-op if the engine hasn't mounted yet.
      if (!engine) return;

      const playing = useAppStore.getState().timeline.playhead.playing;

      if (playing) {
        engine.pause();
        // Plan 10 — skip:true because playhead.playing is transport state,
        // not editable content. The whole playhead is excluded from history
        // (D3/L4), so this mutation must bypass recordingSet's history push.
        useAppStore.getState().recordingSet(
          'Pause',
          (s) => {
            s.timeline.playhead.playing = false;
          },
          { skip: true }
        );
      } else {
        await engine.play();
        // Plan 10 — same rationale as the pause branch above.
        useAppStore.getState().recordingSet(
          'Play',
          (s) => {
            s.timeline.playhead.playing = true;
          },
          { skip: true }
        );
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);
}
