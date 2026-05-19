import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppState } from './types';
import { createTimelineSlice } from './timeline-slice';

export const useAppStore = create<AppState>()(
  persist(
    (set, get, store) => ({
      ui: { zoom: 1, inspectorOpen: true },
      setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
      setInspectorOpen: (open) => set((s) => ({ ui: { ...s.ui, inspectorOpen: open } })),
      ...createTimelineSlice(set, get, store)
    }),
    {
      name: 'vibegrid-store',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Persist only serializable data slices — never actions, never blobs.
      partialize: (state) => ({
        ui: state.ui,
        timeline: state.timeline
      })
    }
  )
);
