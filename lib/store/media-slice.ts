import type { StateCreator } from 'zustand';
import type { AppState } from './types';
import type { MediaRef } from '@/lib/storage/types';

export const initialMediaState = {
  mediaRefs: [] as MediaRef[],
  videoLoadProgress: {} as Record<string, { received: number; total: number }>
};

/**
 * Plan 10 — All media-actions route through `recordingSet` with
 * `{ skip: true }`. Per Architect-Migrations-Tabelle (Modul 8): media
 * mutations involve side-effects against Cloudflare R2 that cannot be
 * reverted in-app (uploads, deletes, video-byte-cache progress).
 * Undo silently bypasses them.
 */
export const createMediaSlice: StateCreator<
  AppState,
  [],
  [],
  Pick<AppState, 'media' | 'mediaActions'>
> = (_set, get) => ({
  media: { mediaRefs: [], videoLoadProgress: {} },
  mediaActions: {
    addMediaRef: (ref) => {
      const existing = get().media.mediaRefs.find((m) => m.id === ref.id);
      if (existing) return;
      // Undo: skip — R2-bound (upload cannot be reverted in-app)
      get().recordingSet(
        'AddMediaRef',
        (s) => {
          s.media = {
            ...s.media,
            mediaRefs: [...s.media.mediaRefs, ref]
          };
        },
        { skip: true }
      );
    },
    removeMediaRef: (id) => {
      // Undo: skip — R2-bound
      get().recordingSet(
        'RemoveMediaRef',
        (s) => {
          const nextProgress = { ...s.media.videoLoadProgress };
          delete nextProgress[id];
          s.media = {
            ...s.media,
            mediaRefs: s.media.mediaRefs.filter((r) => r.id !== id),
            videoLoadProgress: nextProgress
          };
        },
        { skip: true }
      );
    },
    getMediaRef: (id) => get().media.mediaRefs.find((m) => m.id === id),
    addMediaRefMeta: (id, partial) => {
      const m = get().media;
      const idx = m.mediaRefs.findIndex((r) => r.id === id);
      if (idx === -1) return;
      // Undo: skip — Meta-Patch on uploaded asset, R2-bound
      get().recordingSet(
        'MediaRefMeta',
        (s) => {
          const merged = { ...s.media.mediaRefs[idx], ...partial };
          const next = [...s.media.mediaRefs];
          next[idx] = merged;
          s.media = { ...s.media, mediaRefs: next };
        },
        { skip: true }
      );
    },
    setVideoLoadProgress: (mediaId, received, total) => {
      const prev = get().media.videoLoadProgress[mediaId];
      if (prev && prev.received === received && prev.total === total) return;
      // Undo: skip — transient progress indicator
      get().recordingSet(
        'VideoLoadProgress',
        (s) => {
          s.media = {
            ...s.media,
            videoLoadProgress: {
              ...s.media.videoLoadProgress,
              [mediaId]: { received, total }
            }
          };
        },
        { skip: true }
      );
    },
    purgeSceneflowMediaRefs: (storyId, userId) => {
      const m = get().media;
      const needle = `/sceneflow/${userId}/${storyId}/`;
      const toDrop = m.mediaRefs.filter((r) => r.url.includes(needle));
      if (toDrop.length === 0) return;
      const droppedIds = new Set(toDrop.map((r) => r.id));
      // Undo: skip — R2-bound (Sceneflow asset purge)
      get().recordingSet(
        'PurgeSceneflowRefs',
        (s) => {
          const nextProgress = { ...s.media.videoLoadProgress };
          for (const id of droppedIds) delete nextProgress[id];
          s.media = {
            ...s.media,
            mediaRefs: s.media.mediaRefs.filter((r) => !droppedIds.has(r.id)),
            videoLoadProgress: nextProgress
          };
        },
        { skip: true }
      );
    }
  }
});
