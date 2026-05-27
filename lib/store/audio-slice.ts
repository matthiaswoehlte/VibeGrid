import type { StateCreator } from 'zustand';
import type { AppState } from './types';
import { BPM_MAX, BPM_MIN, DEFAULT_BEAT_GRID, type BeatGrid } from '@/lib/audio/types';

export const initialAudioGrid: BeatGrid = { ...DEFAULT_BEAT_GRID };

/**
 * Plan 10 — All actions route through `recordingSet`:
 *  - `setBPM` records (user-action — manual BPM-change is undobar)
 *  - `setDetectedGrid` skips (engine-output via Plan-2 BPM detector —
 *    not a user-undo concern; the user didn't trigger it directly)
 *  - `resetGrid` records (deliberate user-reset)
 */
export const createAudioSlice: StateCreator<
  AppState,
  [],
  [],
  Pick<AppState, 'audio' | 'audioActions'>
> = (_set, get) => ({
  audio: { grid: initialAudioGrid },
  audioActions: {
    setBPM: (bpm) => {
      const clamped = Math.max(BPM_MIN, Math.min(BPM_MAX, bpm));
      get().recordingSet('Change BPM', (s) => {
        s.audio = {
          grid: { ...s.audio.grid, bpm: clamped, source: 'manual' }
        };
      });
    },
    setDetectedGrid: (grid) => {
      const clamped = Math.max(BPM_MIN, Math.min(BPM_MAX, grid.bpm));
      // Undo: transient — skip (engine-output, not a user action)
      get().recordingSet(
        'DetectedGrid',
        (s) => {
          s.audio = { grid: { ...grid, bpm: clamped, source: 'detected' } };
        },
        { skip: true }
      );
    },
    resetGrid: () =>
      get().recordingSet('Reset Grid', (s) => {
        s.audio = { grid: { ...initialAudioGrid } };
      })
  }
});
