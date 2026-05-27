import type { Draft } from 'immer';
import { current } from 'immer';
import type { AppState } from './types';
import { MAX_HISTORY, type HistoryEntry } from './history-types';

/**
 * Plan 10 — Public type for the global `recordingSet` action. Exported
 * here and re-exported from `lib/store/types.ts` so external Callers
 * (NewProjectButton, Transport, deserialize) can invoke without
 * coupling to store-internals.
 */
export type RecordingSet = (
  label: string,
  mutator: (state: Draft<AppState>) => void,
  options?: RecordingOptions
) => void;

export interface RecordingOptions {
  /**
   * `coalesce: true` — fold this mutation into the previous history
   * entry instead of creating a new one. **Only takes effect when
   * the previous entry has the SAME `label`** (Architekt W8) — avoids
   * accidental merge of two unrelated actions that happen to coalesce
   * back-to-back.
   *
   * Usage: PointerDown (non-coalesce, fresh snapshot) followed by N×
   * PointerMove (coalesce: true, mutate only) collapses to 1 undo
   * step per drag.
   */
  coalesce?: boolean;

  /**
   * `skip: true` — bypass history entirely (transient UI mutations).
   * Caller MUST add an inline comment explaining why. Not a lazy
   * opt-out.
   */
  skip?: boolean;
}

/** Internal — Zustand+Immer signature. */
type ZustandImmerSet = (recipe: (draft: Draft<AppState>) => void) => void;

/**
 * Plan 10 — builds the `recordingSet` action with proper Coalesce-Fix
 * (Architekt B1), Label-Match (W8), Playhead-Exclude (D3/L4).
 *
 * **Coalesce semantics (CRITICAL)**: when `coalesce: true` AND the
 * last past-entry has a matching label, this function ONLY mutates
 * the current state — it does NOT push a new history entry and does
 * NOT take a new snapshot. That way the pre-drag snapshot in
 * past[last] remains intact; the next `undo()` jumps straight back
 * to the value BEFORE the entire coalescing drag started.
 *
 * The previous (Rev. 1) plan accidentally snapshotted at every
 * coalesce, which meant Undo landed at the LAST mid-drag value
 * instead of the pre-drag value. The fix is to skip the snapshot
 * entirely on coalesce — the existing past-entry already holds the
 * correct pre-coalesce state.
 */
export function makeRecordingSet(set: ZustandImmerSet): RecordingSet {
  return function recordingSet(label, mutator, options = {}) {
    set((state) => {
      // Skip — transient mutation, no history entry. Caller-owned
      // inline comment documents the intent.
      if (options.skip) {
        mutator(state);
        return;
      }

      // Coalesce — fold into previous entry if the label matches.
      // CRITICAL (Architekt B1 + W8): when coalescing with a label
      // match, DO NOT clone state. The pre-drag snapshot is already
      // in past[last] and stays untouched. Only the current state
      // advances. Undo then jumps back to the pre-drag value.
      const past = state.history.past;
      if (
        options.coalesce &&
        past.length > 0 &&
        past[past.length - 1].label === label
      ) {
        mutator(state);
        return;
      }

      // Normal record — snapshot BEFORE mutating, then mutate.
      // `playhead` excluded per Architekt-D3 / L4 — undo restores
      // clip structure, not playback position.
      //
      // `current()` from immer materialises a plain non-proxy snapshot
      // of the draft slice. structuredClone() on a raw Immer Draft
      // throws DataCloneError (Proxies are not cloneable in jsdom and
      // some browsers); current() resolves it to the underlying data.
      const timelineSnapshot = current(state.timeline);
      const { playhead: _excluded, ...timelineWithoutPlayhead } =
        timelineSnapshot;
      const audioSnapshot = current(state.audio);
      const entry: HistoryEntry = {
        timeline: structuredClone(timelineWithoutPlayhead),
        audio: structuredClone(audioSnapshot),
        label,
        timestamp: Date.now()
      };
      past.push(entry);
      if (past.length > MAX_HISTORY) past.shift();
      // Any new action invalidates the redo stack.
      state.history.future = [];

      mutator(state);
    });
  };
}
