import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppState } from './types';
import { createTimelineSlice, initialTimelineState } from './timeline-slice';
import { createAudioSlice } from './audio-slice';
import { createMediaSlice } from './media-slice';
import type { Track } from '@/lib/timeline/types';

export const useAppStore = create<AppState>()(
  persist(
    (set, get, store) => ({
      // UI state lives inline — no ui-slice.ts. expandedAutomationClipId
      // and automationSnap are transient (never persisted; see partialize).
      ui: {
        zoom: 1,
        selectedClipId: null,
        expandedAutomationClipId: null,
        automationSnap: 'off'
      },
      setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
      setSelectedClipId: (id) =>
        set((s) => ({
          ui:
            id !== s.ui.expandedAutomationClipId
              ? { ...s.ui, selectedClipId: id, expandedAutomationClipId: null }
              : { ...s.ui, selectedClipId: id }
        })),
      setExpandedAutomationClipId: (clipId) =>
        set((s) => ({ ui: { ...s.ui, expandedAutomationClipId: clipId } })),
      setAutomationSnap: (snap) =>
        set((s) => ({ ui: { ...s.ui, automationSnap: snap } })),
      ...createTimelineSlice(set, get, store),
      ...createAudioSlice(set, get, store),
      ...createMediaSlice(set, get, store)
    }),
    {
      name: 'vibegrid-store',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      // v1 → v2: ensure all default TrackKind tracks exist (Plan 5 fix).
      // v2 → v3: same merge re-runs after Plan 5.5 adds the zoom-pulse track.
      migrate: (persistedState, version) => {
        const s = persistedState as { timeline?: { tracks?: Track[] } } | null;
        if (version < 3 && s?.timeline) {
          const existing: Track[] = Array.isArray(s.timeline.tracks) ? s.timeline.tracks : [];
          const existingKinds = new Set(existing.map((t) => t.kind));
          const missing = initialTimelineState.tracks.filter((t) => !existingKinds.has(t.kind));
          s.timeline.tracks = [...existing, ...missing].sort((a, b) => a.order - b.order);
        }
        return s;
      },

      // Persist only serializable data slices — never actions, never blobs.
      // playhead.playing is forced to false on persist: after a page reload
      // the audio element is gone and "playing" would be a lie.
      // media.mediaRefs are URLs + metadata only — never the underlying blobs.
      partialize: (state) => ({
        // selectedClipId, expandedAutomationClipId, and automationSnap are
        // all transient UI state. Persisting them would confuse users on
        // reload (Inspector jumps to a clip they didn't select; automation
        // lane re-opens without context; snap mode resets to a half-tried
        // value). Only `zoom` survives reloads.
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
