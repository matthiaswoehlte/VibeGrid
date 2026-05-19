import type { StateCreator } from 'zustand';
import type { AppState } from './types';
import { DEFAULT_BEAT_GRID, type BeatGrid } from '@/lib/audio/types';

const BPM_MIN = 60;
const BPM_MAX = 200;

export const initialAudioGrid: BeatGrid = { ...DEFAULT_BEAT_GRID };

export const createAudioSlice: StateCreator<
  AppState,
  [],
  [],
  Pick<AppState, 'audio' | 'audioActions'>
> = (set, get) => ({
  audio: { grid: initialAudioGrid },
  audioActions: {
    setBPM: (bpm) => {
      const clamped = Math.max(BPM_MIN, Math.min(BPM_MAX, bpm));
      set({
        audio: { grid: { ...get().audio.grid, bpm: clamped, source: 'manual' } }
      });
    },
    setDetectedGrid: (grid) => {
      const clamped = Math.max(BPM_MIN, Math.min(BPM_MAX, grid.bpm));
      set({ audio: { grid: { ...grid, bpm: clamped, source: 'detected' } } });
    },
    resetGrid: () => set({ audio: { grid: { ...initialAudioGrid } } })
  }
});
