import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppState } from './types';
import { createTimelineSlice, INITIAL_TRACKS_V5 } from './timeline-slice';
import { createAudioSlice } from './audio-slice';
import { createMediaSlice } from './media-slice';
import { createMobileUISlice } from './mobile-ui-slice';
import type { Track } from '@/lib/timeline/types';
import { TRACK_FX_KINDS } from '@/lib/timeline/plugin-mapping';
import { EXPORT_INITIAL_STATE, reduceExportState } from '@/lib/export/state-machine';

/** Plan 5.9c — exported so tests can exercise it without standing up
 *  the full persisted store. */
export function migrate(persistedState: unknown, version: number): unknown {
  const s = persistedState as { timeline?: { tracks?: Track[] } } | null;
  if (!s?.timeline) return s;

  // v4 → v5: legacy order-sort + append missing default tracks.
  // GATED so it only fires for genuine v4 snapshots — a fresh v5
  // snapshot must NOT trigger the append (else after 5.9c shrinks
  // `initialTimelineState` to 4 lanes, the snapshot already has the
  // v5 FX tracks and nothing should be appended).
  if (version < 5) {
    const existing: Track[] = Array.isArray(s.timeline.tracks) ? s.timeline.tracks : [];
    existing.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const existingKinds = new Set(existing.map((t) => t.kind));
    const missing = (INITIAL_TRACKS_V5 as readonly Track[]).filter(
      (t) => !existingKinds.has(t.kind)
    );
    s.timeline.tracks = [...existing, ...missing];
  }

  // v5 → v6: rewrite every legacy FX-kind track to `kind: 'fx'`.
  // Track.name and Track.id preserved (user-renamed lanes survive).
  // Clips are untouched — `clip.kind` already holds the lowercase
  // FX-kind that the renderer consumes for plugin dispatch.
  if (version < 6) {
    const fxSet = new Set<string>(TRACK_FX_KINDS);
    s.timeline.tracks = (s.timeline.tracks ?? []).map((t) =>
      fxSet.has(t.kind) ? { ...t, kind: 'fx' as Track['kind'] } : t
    );
  }

  return s;
}

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
        exportState: EXPORT_INITIAL_STATE,
        flowMode: false
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
      setFlowMode: (value) => set((s) => ({ ui: { ...s.ui, flowMode: value } })),
      ...createTimelineSlice(set, get, store),
      ...createAudioSlice(set, get, store),
      ...createMediaSlice(set, get, store),
      ...createMobileUISlice(set, get, store)
    }),
    {
      name: 'vibegrid-store',
      version: 6,
      storage: createJSONStorage(() => localStorage),
      // v1 → v2: ensure all default TrackKind tracks exist (Plan 5 fix).
      // v2 → v3: same merge re-runs after Plan 5.5 adds the zoom-pulse track.
      // v3 → v4: same merge re-runs after Plan 5.8a adds the text /
      //          dissolve / sunray tracks.
      // v4 → v5: Plan 5.9a — `Track.order` deprecated, array index is
      //          authoritative. Sort existing tracks by their legacy
      //          .order field one last time (preserves v1-v4 user order),
      //          then append missing default tracks (e.g. the new video
      //          track) at the end. GATED with `version < 5` so a fresh
      //          v5 snapshot does NOT trigger phantom appends now that
      //          `initialTimelineState` shrinks to 4 lanes.
      // v5 → v6: Plan 5.9c — collapse the 8 per-FX-plugin track-kinds
      //          (`contour`, `sweep`, …) to a single `'fx'`. Tracks
      //          retain their user-set `name` and `id`. Clips are
      //          untouched — `clip.kind` still carries the specific
      //          lowercase FX-kind for the renderer's plugin dispatch.
      migrate: (persistedState, version) => migrate(persistedState, version),

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
          },
          // Same shape-merge for media so new transient fields
          // (videoLoadProgress) keep their defaults when the
          // persisted partial only has mediaRefs.
          media: {
            ...currentState.media,
            ...(persisted?.media ?? {})
          }
        };
      },

      // Persist only serializable data slices — never actions, never blobs.
      // playhead.playing is forced to false on persist: after a page reload
      // the audio element is gone and "playing" would be a lie.
      // media.mediaRefs are URLs + metadata only — never the underlying blobs.
      partialize: (state) => ({
        // selectedClipId, automationEditorClipId, automationSnap,
        // exportState, and flowMode are all transient UI state. Persisting
        // them would confuse users on reload (Inspector jumps to a clip
        // they didn't select; editor re-opens without context; snap mode
        // resets; exportState would resume a recording session that no
        // longer has a MediaRecorder; flowMode would silently keep beat
        // triggers disabled). Only `zoom` survives reloads.
        //
        // Plan 5.10: `mobileUI` is intentionally absent from this return
        // object too — opt-in persistence means anything not listed is
        // dropped, so the active mobile tab resets to 'timeline' on
        // every refresh. Matches the rest of the transient UI state.
        ui: { zoom: state.ui.zoom },
        timeline: {
          ...state.timeline,
          playhead: {
            ...state.timeline.playhead,
            playing: false
          }
        },
        audio: state.audio,
        // Only persist mediaRefs — videoLoadProgress is transient
        // (recomputed by the live VideoEngine on every page mount).
        media: { mediaRefs: state.media.mediaRefs }
      })
    }
  )
);
