import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppState } from './types';
import { createTimelineSlice } from './timeline-slice';
import { createAudioSlice } from './audio-slice';
import { createMediaSlice } from './media-slice';

export const useAppStore = create<AppState>()(
  persist(
    (set, get, store) => ({
      ui: { zoom: 1, selectedClipId: null },
      setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
      setSelectedClipId: (id) => set((s) => ({ ui: { ...s.ui, selectedClipId: id } })),
      ...createTimelineSlice(set, get, store),
      ...createAudioSlice(set, get, store),
      ...createMediaSlice(set, get, store)
    }),
    {
      name: 'vibegrid-store',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Persist only serializable data slices — never actions, never blobs.
      // playhead.playing is forced to false on persist: after a page reload
      // the audio element is gone and "playing" would be a lie.
      // media.mediaRefs are URLs + metadata only — never the underlying blobs.
      partialize: (state) => ({
        // selectedClipId is transient — never persist (stale id after reload
        // would silently confuse the Inspector). Only `zoom` survives reloads.
        ui: { zoom: state.ui.zoom },
        timeline: {
          ...state.timeline,
          playhead: {
            ...state.timeline.playhead,
            playing: false
          }
        },
        audio: state.audio,
        media: state.media
      })
    }
  )
);
