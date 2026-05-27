import type { TimelineState } from '@/lib/timeline/types';
import type { AudioState } from './types';

/**
 * Plan 10 — Snapshot of the undobable slice of AppState.
 *
 * **Scope** (per Architekt-Decision D3 / L4 + Migrations-Tabelle):
 *   - `timeline` WITHOUT `playhead` (playhead stays at current position
 *     on undo — DAW-Standard, Ableton/Logic).
 *   - `audio` (whole slice — tiny `{ grid: { bpm, source } }`). Needed
 *     so undoing `setBPM` / `resetGrid` (marked as `record` in the
 *     Migrations-Tabelle) actually reverts the BPM value, not just the
 *     surrounding timeline geometry.
 *   - NOT included: `ui`, `media`, `mobileUI`, `appMode`
 *     (transient OR R2-gebunden — see Migrations-Tabelle in Plan 10).
 */
export interface HistoryEntry {
  /** Deep-cloned `timeline` minus the `playhead` field. */
  timeline: Omit<TimelineState, 'playhead'>;
  /** Deep-cloned `audio` slice (grid only — small + serialisable). */
  audio: AudioState;
  /** Human-readable label shown in the Undo/Redo button tooltip. */
  label: string;
  /** ms since epoch — for UI tooltips ("3s ago") and debugging. */
  timestamp: number;
}

export interface HistoryState {
  /** Index 0 = oldest, last = youngest (will be popped first by undo). */
  past: HistoryEntry[];
  /** Index 0 = next redo-target (will be shifted off). */
  future: HistoryEntry[];
}

/**
 * Cap on stack size. At 100 entries × ~1 MB/snapshot (worst-case
 * 100-Clip-Timeline with automation curves), total RAM cost is
 * bounded ~100 MB. Accepted trade-off — see KNOWN_LIMITATIONS.md
 * "Undo-Stack RAM Footprint" (Architekt L4).
 */
export const MAX_HISTORY = 100;
