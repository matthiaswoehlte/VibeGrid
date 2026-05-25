import type { StateCreator } from 'zustand';
import type { AppState } from './types';
import type { MediaRef } from '@/lib/storage/types';

export const initialMediaState = {
  mediaRefs: [] as MediaRef[],
  videoLoadProgress: {} as Record<string, { received: number; total: number }>
};

export const createMediaSlice: StateCreator<
  AppState,
  [],
  [],
  Pick<AppState, 'media' | 'mediaActions'>
> = (set, get) => ({
  media: { mediaRefs: [], videoLoadProgress: {} },
  mediaActions: {
    addMediaRef: (ref) => {
      const existing = get().media.mediaRefs.find((m) => m.id === ref.id);
      if (existing) return; // dedupe by id — second add is a no-op
      set({
        media: {
          ...get().media,
          mediaRefs: [...get().media.mediaRefs, ref]
        }
      });
    },
    removeMediaRef: (id) => {
      const m = get().media;
      // Also drop any stale progress for this id.
      const nextProgress = { ...m.videoLoadProgress };
      delete nextProgress[id];
      set({
        media: {
          ...m,
          mediaRefs: m.mediaRefs.filter((r) => r.id !== id),
          videoLoadProgress: nextProgress
        }
      });
    },
    getMediaRef: (id) => get().media.mediaRefs.find((m) => m.id === id),
    addMediaRefMeta: (id, partial) => {
      const m = get().media;
      const idx = m.mediaRefs.findIndex((r) => r.id === id);
      if (idx === -1) return;
      const merged = { ...m.mediaRefs[idx], ...partial };
      const next = [...m.mediaRefs];
      next[idx] = merged;
      set({ media: { ...m, mediaRefs: next } });
    },
    setVideoLoadProgress: (mediaId, received, total) => {
      const m = get().media;
      // Skip if value unchanged — Zustand subscribers compare by
      // reference, but the wrapping object would always be new.
      const prev = m.videoLoadProgress[mediaId];
      if (prev && prev.received === received && prev.total === total) return;
      set({
        media: {
          ...m,
          videoLoadProgress: {
            ...m.videoLoadProgress,
            [mediaId]: { received, total }
          }
        }
      });
    },
    // Plan 8d — drop SceneFlow-owned mediaRefs of this user+story before
    // a Transfer rebuild so the library doesn't accumulate orphans.
    // Match by URL substring — every SceneFlow asset is uploaded under
    // `/sceneflow/{userId}/{storyId}/...` (see lib/sceneflow/fal-to-r2.ts).
    purgeSceneflowMediaRefs: (storyId, userId) => {
      const m = get().media;
      const needle = `/sceneflow/${userId}/${storyId}/`;
      const toDrop = m.mediaRefs.filter((r) => r.url.includes(needle));
      if (toDrop.length === 0) return;
      const droppedIds = new Set(toDrop.map((r) => r.id));
      const nextProgress = { ...m.videoLoadProgress };
      for (const id of droppedIds) delete nextProgress[id];
      set({
        media: {
          ...m,
          mediaRefs: m.mediaRefs.filter((r) => !droppedIds.has(r.id)),
          videoLoadProgress: nextProgress
        }
      });
    }
  }
});
