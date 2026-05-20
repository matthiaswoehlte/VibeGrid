import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppState } from './types';
import { createTimelineSlice, initialTimelineState } from './timeline-slice';
import { createAudioSlice } from './audio-slice';
import { createMediaSlice } from './media-slice';
import type { Track } from '@/lib/timeline/types';
import { EXPORT_INITIAL_STATE, reduceExportState } from '@/lib/export/state-machine';

export const useAppStore = create<AppState>()(
  persist(
    (set, get, store) => ({
      // UI state lives inline — no ui-slice.ts. automationEditorClipId and
      // automationSnap are transient (never persisted; see partialize).
      // automationEditorClipId was named expandedAutomationClipId in
      // Plan 5.5/5.6 (inline-lane toggle). Plan 5.7-R repurposed the same
      // field to drive the full-screen AutomationEditorModal; cleanup
      // semantics on selectedClipId/removeClip are unchanged.
      ui: {
        zoom: 1,
        selectedClipId: null,
        automationEditorClipId: null,
        automationSnap: 'off',
        exportState: EXPORT_INITIAL_STATE
      },
      setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
      setSelectedClipId: (id) =>
        set((s) => ({
          ui:
            id !== s.ui.automationEditorClipId
              ? { ...s.ui, selectedClipId: id, automationEditorClipId: null }
              : { ...s.ui, selectedClipId: id }
        })),
      setAutomationEditorClipId: (clipId) =>
        set((s) => ({ ui: { ...s.ui, automationEditorClipId: clipId } })),
      setAutomationSnap: (snap) =>
        set((s) => ({ ui: { ...s.ui, automationSnap: snap } })),
      setExportState: (patch) =>
        set((s) => ({
          ui: { ...s.ui, exportState: reduceExportState(s.ui.exportState, patch) }
        })),
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

      // Deep-merge `ui` so the persisted partial (`{ zoom }` only) doesn't
      // replace the entire `ui` object on rehydrate. Without this, every
      // new UIState field added by later plans (Plan 5.5's
      // automationEditorClipId, Plan 5.7's automationSnap, Plan 6's
      // exportState) ends up `undefined` for any user with a pre-existing
      // localStorage entry — and reading `ui.exportState.status` throws.
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AppState> | undefined;
        return {
          ...currentState,
          ...persisted,
          ui: {
            ...currentState.ui,
            ...(persisted?.ui ?? {})
          }
        };
      },

      // Persist only serializable data slices — never actions, never blobs.
      // playhead.playing is forced to false on persist: after a page reload
      // the audio element is gone and "playing" would be a lie.
      // media.mediaRefs are URLs + metadata only — never the underlying blobs.
      partialize: (state) => ({
        // selectedClipId, automationEditorClipId, automationSnap, and
        // exportState are all transient UI state. Persisting them would
        // confuse users on reload (Inspector jumps to a clip they didn't
        // select; editor re-opens without context; snap mode resets;
        // exportState would resume a recording session that no longer
        // has a MediaRecorder). Only `zoom` survives reloads.
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
