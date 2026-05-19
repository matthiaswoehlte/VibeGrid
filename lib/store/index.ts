import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppState } from './types';

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ui: { zoom: 1, inspectorOpen: true },
      setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
      setInspectorOpen: (open) => set((s) => ({ ui: { ...s.ui, inspectorOpen: open } }))
    }),
    {
      name: 'vibegrid-store',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Persist only serializable data slices — never actions, never blobs.
      // Later plans extend this object with timeline, audioGrid, mediaRefs.
      partialize: (state) => ({
        ui: state.ui
      })
    }
  )
);
