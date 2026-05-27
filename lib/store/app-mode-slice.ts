import type { StateCreator } from 'zustand';
import type { AppState } from './types';

export type AppMode = 'vibegrid' | 'sceneflow';

export interface AppModeState {
  appMode: AppMode;
}

export interface AppModeActions {
  setAppMode(mode: AppMode): void;
}

export const initialAppModeState: AppModeState = { appMode: 'vibegrid' };

/**
 * Plan 8a — transient app-mode slice. Mirrors `mobileUI` semantics:
 * lives in `useAppStore` (so consumers can subscribe directly without
 * a separate zustand store), excluded from `partialize` (so a reload
 * always lands the user back in the VibeGrid tab).
 */
export const createAppModeSlice: StateCreator<
  AppState,
  [],
  [],
  AppModeState & AppModeActions
> = (_set, get) => ({
  appMode: initialAppModeState.appMode,
  // Plan 10 — Undo: transient — skip (top-level workspace mode)
  setAppMode: (appMode) =>
    get().recordingSet(
      'AppMode',
      (s) => {
        s.appMode = appMode;
      },
      { skip: true }
    )
});
