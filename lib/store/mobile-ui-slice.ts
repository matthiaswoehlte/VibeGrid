import type { StateCreator } from 'zustand';
import type { AppState } from './types';

export type MobileTab = 'timeline' | 'media' | 'fx';

export interface MobileUIState {
  mobileTab: MobileTab;
}

export interface MobileUIActions {
  setMobileTab(tab: MobileTab): void;
}

export const initialMobileUIState: MobileUIState = {
  mobileTab: 'timeline'
};

/**
 * Plan 5.10 — Mobile-only UI state.
 *
 * Lives in `useAppStore` as a dedicated slice (next to `ui`, `timeline`,
 * `audio`, `media`) but is intentionally excluded from `partialize` so
 * the active mobile tab does not survive page reloads. Refresh always
 * starts the user on the Timeline tab — matches how every other
 * transient UI flag (selectedClipId, flowMode, exportState) is handled.
 *
 * The slice avoids the alternative of a React Context + Provider tree:
 * Zustand-based access matches the existing UI-state pattern, sidesteps
 * provider plumbing for every consumer (TabBar, Drawers, InspectorSheet,
 * timeline pinch-zoom touchpoint detection), and the slice has zero
 * dependence on any DOM tree position.
 */
export const createMobileUISlice: StateCreator<
  AppState,
  [],
  [],
  Pick<AppState, 'mobileUI' | 'mobileUIActions'>
> = (set) => ({
  mobileUI: initialMobileUIState,
  mobileUIActions: {
    setMobileTab: (mobileTab) =>
      set((s) => ({ mobileUI: { ...s.mobileUI, mobileTab } }))
  }
});
