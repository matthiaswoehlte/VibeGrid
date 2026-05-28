import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import type { AudioEngine } from '@/lib/audio/engine';

/**
 * Global Spacebar → play/pause shortcut (transport reflex).
 *
 * DAW-standard behavior: toggles transport EVERYWHERE except when an input
 * / textarea / contenteditable has focus — there Spacebar inserts a space
 * normally so users can type text without unintentionally toggling
 * playback. Matches the useUndoRedoShortcuts focus-bail pattern.
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

      // Bail when focus is on a text-entry element — let the native space
      // insertion happen. Same pattern as useUndoRedoShortcuts. Check both
      // `isContentEditable` (production browsers) AND the property literal
      // `contentEditable === 'true'` (jsdom test environment lacks the
      // inheritance-aware getter implementation).
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.contentEditable === 'true')
      ) {
        return;
      }

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
