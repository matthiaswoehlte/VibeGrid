import type { StateCreator } from 'zustand';
import type { AppState } from './types';
import type { MediaRef } from '@/lib/storage/types';

export const initialMediaState = { mediaRefs: [] as MediaRef[] };

export const createMediaSlice: StateCreator<
  AppState,
  [],
  [],
  Pick<AppState, 'media' | 'mediaActions'>
> = (set, get) => ({
  media: { mediaRefs: [] },
  mediaActions: {
    addMediaRef: (ref) => {
      const existing = get().media.mediaRefs.find((m) => m.id === ref.id);
      if (existing) return; // dedupe by id — second add is a no-op
      set({ media: { mediaRefs: [...get().media.mediaRefs, ref] } });
    },
    removeMediaRef: (id) => {
      set({
        media: { mediaRefs: get().media.mediaRefs.filter((m) => m.id !== id) }
      });
    },
    getMediaRef: (id) => get().media.mediaRefs.find((m) => m.id === id),
    addMediaRefMeta: (id, partial) => {
      const list = get().media.mediaRefs;
      const idx = list.findIndex((m) => m.id === id);
      if (idx === -1) return;
      const merged = { ...list[idx], ...partial };
      const next = [...list];
      next[idx] = merged;
      set({ media: { mediaRefs: next } });
    }
  }
});
