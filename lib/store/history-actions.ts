import type { Draft } from 'immer';
import { current } from 'immer';
import type { AppState } from './types';
import type { TimelineState } from '@/lib/timeline/types';

type ZustandImmerSet = (recipe: (draft: Draft<AppState>) => void) => void;

/**
 * Plan 10 — undo / redo / clearHistory actions.
 *
 * Lives in its own file (not inlined into store/index.ts) because
 * `history-actions.ts` is in the ESLint whitelist for raw `set()`
 * use — `index.ts` is NOT whitelisted (Rev.-3 feedback). All raw
 * `set()` calls that mutate `history.past` / `history.future`
 * directly must live here.
 *
 * Playhead handling (Architekt D3 / L4): `HistoryEntry.timeline`
 * excludes the playhead field. On restore, the current playhead is
 * preserved so undo/redo during playback doesn't kick the user back
 * to where they were 30 s ago.
 */
export function makeHistoryActions(set: ZustandImmerSet): {
  undo(): void;
  redo(): void;
  clearHistory(): void;
} {
  return {
    undo: () =>
      set((state) => {
        const past = state.history.past;
        if (past.length === 0) return;

        // Snapshot current state into `future` BEFORE restoring.
        // Label-propagation: the entry being undone carries the action
        // label (e.g. "Add contour"); preserve it on the future entry
        // so the Redo tooltip can say "Redo: Add contour" (not the
        // useless "Redo: current").
        const prev = past[past.length - 1];
        const timelineSnapshot = current(state.timeline);
        const { playhead: _excluded, ...currentWithoutPlayhead } =
          timelineSnapshot;
        const audioSnapshot = current(state.audio);
        state.history.future.unshift({
          timeline: structuredClone(currentWithoutPlayhead),
          audio: structuredClone(audioSnapshot),
          label: prev.label,
          timestamp: Date.now()
        });

        // Restore from past, KEEPING current playhead (Architekt D3).
        past.pop();
        const currentPlayhead = state.timeline.playhead;
        state.timeline = {
          ...prev.timeline,
          playhead: currentPlayhead
        } as TimelineState;
        state.audio = prev.audio;
      }),

    redo: () =>
      set((state) => {
        const future = state.history.future;
        if (future.length === 0) return;

        // Label-propagation: see undo() above. The redone action's
        // label travels back to past[last] so a subsequent Undo
        // tooltip surfaces the right action name.
        const next = future[0];
        const timelineSnapshot = current(state.timeline);
        const { playhead: _excluded, ...currentWithoutPlayhead } =
          timelineSnapshot;
        const audioSnapshot = current(state.audio);
        state.history.past.push({
          timeline: structuredClone(currentWithoutPlayhead),
          audio: structuredClone(audioSnapshot),
          label: next.label,
          timestamp: Date.now()
        });

        future.shift();
        const currentPlayhead = state.timeline.playhead;
        state.timeline = {
          ...next.timeline,
          playhead: currentPlayhead
        } as TimelineState;
        state.audio = next.audio;
      }),

    /**
     * [Rev.-2-Review Bug 1] — wipe past + future stacks. Called by
     * `lib/project/deserialize.ts` after a successful project-load:
     * the previous project's history is irrelevant once a new project
     * is loaded, and keeping it would let Ctrl+Z silently revert
     * across project boundaries (catastrophic UX).
     *
     * Lives in this file (not in `index.ts`) because the ESLint
     * `no-direct-set-in-store` rule whitelists `history-actions.ts`
     * for raw `set()` use — `index.ts` is NOT whitelisted.
     */
    clearHistory: () =>
      set((state) => {
        state.history = { past: [], future: [] };
      })
  };
}
