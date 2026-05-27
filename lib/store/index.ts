import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppState } from './types';
import { createTimelineSlice, INITIAL_TRACKS_V5 } from './timeline-slice';
import { createAudioSlice } from './audio-slice';
import { createMediaSlice } from './media-slice';
import { createMobileUISlice } from './mobile-ui-slice';
import { createAppModeSlice } from './app-mode-slice';
import { toPersistedShape, STORE_VERSION } from './persist-shape';
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
        selectedClipIds: [],
        selectedClipId: null,
        automationEditorClipId: null,
        automationSnap: 'off',
        clipSnap: '1',
        exportState: EXPORT_INITIAL_STATE,
        flowMode: false
      },
      setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
      setSelectedClipId: (id) =>
        set((s) => {
          // Plan 9b — compat-shim: keep selectedClipIds[] in sync with
          // the singular field. When id changes away from the editor
          // target, close the editor modal (legacy behavior).
          const nextIds = id ? [id] : [];
          const nextEditor =
            id !== s.ui.automationEditorClipId ? null : s.ui.automationEditorClipId;
          return {
            ui: {
              ...s.ui,
              selectedClipId: id,
              selectedClipIds: nextIds,
              automationEditorClipId: nextEditor
            }
          };
        }),
      selectClips: (ids) =>
        set((s) => {
          // Dedup while preserving order; sync compat-field.
          const seen = new Set<string>();
          const deduped: string[] = [];
          for (const id of ids) {
            if (!seen.has(id)) {
              seen.add(id);
              deduped.push(id);
            }
          }
          const singular = deduped.length === 1 ? deduped[0] : null;
          // Mirror the editor-cleanup semantics of setSelectedClipId:
          // closing the editor when the selection no longer focuses
          // its target clip.
          const nextEditor =
            singular !== s.ui.automationEditorClipId ? null : s.ui.automationEditorClipId;
          return {
            ui: {
              ...s.ui,
              selectedClipIds: deduped,
              selectedClipId: singular,
              automationEditorClipId: nextEditor
            }
          };
        }),
      addToSelection: (ids) =>
        set((s) => {
          const seen = new Set(s.ui.selectedClipIds);
          const merged = [...s.ui.selectedClipIds];
          for (const id of ids) {
            if (!seen.has(id)) {
              seen.add(id);
              merged.push(id);
            }
          }
          const singular = merged.length === 1 ? merged[0] : null;
          return {
            ui: { ...s.ui, selectedClipIds: merged, selectedClipId: singular }
          };
        }),
      clearSelection: () =>
        set((s) => ({
          ui: {
            ...s.ui,
            selectedClipIds: [],
            selectedClipId: null,
            automationEditorClipId: null
          }
        })),
      setAutomationEditorClipId: (clipId) =>
        set((s) => ({ ui: { ...s.ui, automationEditorClipId: clipId } })),
      setAutomationSnap: (snap) =>
        set((s) => ({ ui: { ...s.ui, automationSnap: snap } })),
      setClipSnap: (snap) => set((s) => ({ ui: { ...s.ui, clipSnap: snap } })),
      setExportState: (patch) =>
        set((s) => ({
          ui: { ...s.ui, exportState: reduceExportState(s.ui.exportState, patch) }
        })),
      setFlowMode: (value) => set((s) => ({ ui: { ...s.ui, flowMode: value } })),

      // Plan 9b — group operations. Each one is a SINGLE `set()` call so
      // a future undo/redo layer collapses the whole group action to one
      // history entry (Architect-B5). Reads selectedClipIds from ui.
      moveSelectedClips: (deltaBeats) =>
        set((s) => {
          const ids = new Set(s.ui.selectedClipIds);
          if (ids.size === 0) return s;
          // Clamp delta so no clip lands at startBeat < 0.
          let allowed = deltaBeats;
          for (const c of s.timeline.clips) {
            if (!ids.has(c.id)) continue;
            const target = c.startBeat + deltaBeats;
            if (target < 0) {
              allowed = Math.max(allowed, -c.startBeat);
            }
          }
          if (allowed === 0) return s;
          return {
            timeline: {
              ...s.timeline,
              clips: s.timeline.clips.map((c) =>
                ids.has(c.id) ? { ...c, startBeat: c.startBeat + allowed } : c
              )
            }
          };
        }),
      resizeSelectedClips: (deltaBeats, edge) =>
        set((s) => {
          const ids = new Set(s.ui.selectedClipIds);
          if (ids.size === 0) return s;
          const MIN_LEN = 0.5;
          return {
            timeline: {
              ...s.timeline,
              clips: s.timeline.clips.map((c) => {
                if (!ids.has(c.id)) return c;
                if (edge === 'end') {
                  // Clamp per-clip (Architect L4 — einzeln klemmen).
                  const newLen = Math.max(MIN_LEN, c.lengthBeats + deltaBeats);
                  return { ...c, lengthBeats: newLen };
                }
                // edge === 'start': move startBeat AND shrink length.
                // Clamp at MIN_LEN so the clip never inverts.
                const rawLen = c.lengthBeats - deltaBeats;
                const newLen = Math.max(MIN_LEN, rawLen);
                const actualDelta = c.lengthBeats - newLen;
                const newStart = Math.max(0, c.startBeat + actualDelta);
                return { ...c, startBeat: newStart, lengthBeats: newLen };
              })
            }
          };
        }),
      duplicateSelectedClips: (offsetBeats) => {
        let dupedCount = 0;
        set((s) => {
          const ids = new Set(s.ui.selectedClipIds);
          if (ids.size === 0) return s;
          const newClips: typeof s.timeline.clips = [];
          const newIds: string[] = [];
          // Pre-build a set of existing (trackId, startBeat) pairs for
          // overlap detection — silent-skip per Architect L2 if a
          // duplicate would land on an exact-same position+track.
          const existingKeys = new Set(
            s.timeline.clips.map((c) => `${c.trackId}:${c.startBeat}`)
          );
          let skipped = 0;
          for (const c of s.timeline.clips) {
            if (!ids.has(c.id)) continue;
            const newStart = c.startBeat + offsetBeats;
            if (newStart < 0) {
              skipped++;
              continue;
            }
            const key = `${c.trackId}:${newStart}`;
            if (existingKeys.has(key)) {
              skipped++;
              continue;
            }
            existingKeys.add(key);
            const newId =
              typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            // Deep-clone params, handling AutomationCurves with beat-offset.
            const newParams = c.params
              ? Object.fromEntries(
                  Object.entries(c.params).map(([k, v]) => {
                    if (
                      v &&
                      typeof v === 'object' &&
                      'points' in (v as object) &&
                      Array.isArray((v as { points?: unknown }).points)
                    ) {
                      const curve = v as { points: { beat: number; value: unknown }[] };
                      return [
                        k,
                        {
                          ...curve,
                          points: curve.points.map((p) => ({
                            ...p,
                            beat: p.beat + offsetBeats
                          }))
                        }
                      ];
                    }
                    return [k, v];
                  })
                )
              : undefined;
            newClips.push({
              ...c,
              id: newId,
              startBeat: newStart,
              params: newParams
            });
            newIds.push(newId);
          }
          dupedCount = newClips.length;
          // Surface skipped overlaps via console (UI-toast handled by
          // the caller — store is side-effect-free for toasts).
          if (skipped > 0) {
            // eslint-disable-next-line no-console
            console.info(
              `[Plan 9b] duplicateSelectedClips: ${newClips.length} added, ${skipped} skipped (overlap or startBeat < 0)`
            );
          }
          if (newClips.length === 0) return s;
          // Replace the selection with the new clips so the user can
          // immediately drag them to the desired position.
          const singular = newIds.length === 1 ? newIds[0] : null;
          return {
            timeline: { ...s.timeline, clips: [...s.timeline.clips, ...newClips] },
            ui: {
              ...s.ui,
              selectedClipIds: newIds,
              selectedClipId: singular,
              automationEditorClipId: null
            }
          };
        });
        return dupedCount;
      },
      deleteSelectedClips: () =>
        set((s) => {
          const ids = new Set(s.ui.selectedClipIds);
          if (ids.size === 0) return s;
          return {
            timeline: {
              ...s.timeline,
              clips: s.timeline.clips.filter((c) => !ids.has(c.id))
            },
            ui: {
              ...s.ui,
              selectedClipIds: [],
              selectedClipId: null,
              automationEditorClipId: null
            }
          };
        }),

      ...createTimelineSlice(set, get, store),
      ...createAudioSlice(set, get, store),
      ...createMediaSlice(set, get, store),
      ...createMobileUISlice(set, get, store),
      ...createAppModeSlice(set, get, store)
    }),
    {
      name: 'vibegrid-store',
      version: STORE_VERSION,
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
      // Shape lives in lib/store/persist-shape.ts so the DB save/load path
      // (lib/project/serialize.ts) shares the same selector. Transient UI
      // fields (selectedClipId, exportState, flowMode, mobileUI, …) and
      // transient media fields (videoLoadProgress) are excluded by design.
      partialize: (state) => toPersistedShape(state)
    }
  )
);
