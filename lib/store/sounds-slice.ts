import type { StateCreator } from 'zustand';
import type { AppState } from './types';
import type { SoundManifest } from '@/lib/sounds/types';

export interface SoundsState {
  manifest: SoundManifest | null;
  isLoading: boolean;
  error: string | null;
}

export interface SoundsActions {
  setManifest(manifest: SoundManifest): void;
  setLoading(isLoading: boolean): void;
  setError(error: string | null): void;
}

export const initialSoundsState: SoundsState = {
  manifest: null,
  isLoading: false,
  error: null
};

/**
 * Plan 8.7 — Sound Library state slice.
 *
 * Manifest is loaded once at app-start by `SoundManifestLoader.tsx` and
 * stored here. The UI (`SoundLibrary.tsx`) reads from this slice — no
 * per-component fetches.
 *
 * All 3 actions are `recordingSet(..., { skip: true })`. Manifest load
 * is transient bootstrap state, not a user action — undo must not be
 * able to "rewind" a manifest fetch.
 */
export const createSoundsSlice: StateCreator<
  AppState,
  [],
  [],
  Pick<AppState, 'sounds' | 'soundsActions'>
> = (_set, get) => ({
  sounds: initialSoundsState,
  soundsActions: {
    setManifest: (manifest) => {
      get().recordingSet(
        'SoundsManifest',
        (s) => {
          s.sounds = { manifest, isLoading: false, error: null };
        },
        { skip: true }
      );
    },
    setLoading: (isLoading) => {
      get().recordingSet(
        'SoundsLoading',
        (s) => {
          s.sounds = { ...s.sounds, isLoading };
        },
        { skip: true }
      );
    },
    setError: (error) => {
      get().recordingSet(
        'SoundsError',
        (s) => {
          s.sounds = { ...s.sounds, error, isLoading: false };
        },
        { skip: true }
      );
    }
  }
});
