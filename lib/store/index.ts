import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { setAutoFreeze } from 'immer';
import type { AppState } from './types';

// Plan 10 — Immer auto-freezes every produced state. That freezes
// `timelineActions`, `audioActions`, etc. too, which breaks
// `vi.spyOn(state.timelineActions, 'addTrack')` (the property is
// non-configurable on a frozen object). Production code never mutates
// action objects, so disabling auto-freeze costs nothing functionally
// and keeps the test ergonomics intact.
setAutoFreeze(false);
import { createTimelineSlice, INITIAL_TRACKS_V5 } from './timeline-slice';
import { createAudioSlice } from './audio-slice';
import { createMediaSlice } from './media-slice';
import { createMobileUISlice } from './mobile-ui-slice';
import { createAppModeSlice } from './app-mode-slice';
import { createSoundsSlice } from './sounds-slice';
import { toPersistedShape, STORE_VERSION } from './persist-shape';
import type { Track } from '@/lib/timeline/types';
import { TRACK_FX_KINDS } from '@/lib/timeline/plugin-mapping';
import { EXPORT_INITIAL_STATE, reduceExportState } from '@/lib/export/state-machine';
import { makeRecordingSet } from './recording-set';
import { makeHistoryActions } from './history-actions';

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
    immer((set, get, store) => {
      // Plan 10 — wire the History + recordingSet. All store-internal
      // raw `set()` calls live in `recording-set.ts` and
      // `history-actions.ts` (whitelisted by the ESLint rule). All
      // 14 top-level UI/selection/group-ops below go through
      // `recordingSet`, mostly with `skip: true` for transient UI
      // (per Migrations-Tabelle in Plan 10 Modul 8).
      const recordingSet = makeRecordingSet(set);
      const historyActions = makeHistoryActions(set);
      return {
        // Plan 10 — bounded undo/redo history. Transient (never persisted).
        history: { past: [], future: [] },
        recordingSet,
        ...historyActions,

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
        setZoom: (zoom) =>
          // Undo: transient — skip (UI-preference)
          recordingSet('Zoom', (s) => { s.ui.zoom = zoom; }, { skip: true }),
        setSelectedClipId: (id) =>
          // Undo: transient — skip (Selection is transient UI state)
          recordingSet('SelectClip', (s) => {
            const nextIds = id ? [id] : [];
            const nextEditor =
              id !== s.ui.automationEditorClipId ? null : s.ui.automationEditorClipId;
            s.ui.selectedClipId = id;
            s.ui.selectedClipIds = nextIds;
            s.ui.automationEditorClipId = nextEditor;
          }, { skip: true }),
        selectClips: (ids) =>
          // Undo: transient — skip
          recordingSet('SelectClips', (s) => {
            const seen = new Set<string>();
            const deduped: string[] = [];
            for (const id of ids) {
              if (!seen.has(id)) {
                seen.add(id);
                deduped.push(id);
              }
            }
            const singular = deduped.length === 1 ? deduped[0] : null;
            const nextEditor =
              singular !== s.ui.automationEditorClipId ? null : s.ui.automationEditorClipId;
            s.ui.selectedClipIds = deduped;
            s.ui.selectedClipId = singular;
            s.ui.automationEditorClipId = nextEditor;
          }, { skip: true }),
        addToSelection: (ids) =>
          // Undo: transient — skip
          recordingSet('AddToSelection', (s) => {
            const seen = new Set(s.ui.selectedClipIds);
            const merged = [...s.ui.selectedClipIds];
            for (const id of ids) {
              if (!seen.has(id)) {
                seen.add(id);
                merged.push(id);
              }
            }
            const singular = merged.length === 1 ? merged[0] : null;
            s.ui.selectedClipIds = merged;
            s.ui.selectedClipId = singular;
          }, { skip: true }),
        clearSelection: () =>
          // Undo: transient — skip
          recordingSet('ClearSelection', (s) => {
            s.ui.selectedClipIds = [];
            s.ui.selectedClipId = null;
            s.ui.automationEditorClipId = null;
          }, { skip: true }),
        setAutomationEditorClipId: (clipId) =>
          // Undo: transient — skip (modal-state)
          recordingSet('AutomationEditorClip', (s) => { s.ui.automationEditorClipId = clipId; }, { skip: true }),
        setAutomationSnap: (snap) =>
          // Undo: transient — skip (UI-preference)
          recordingSet('AutomationSnap', (s) => { s.ui.automationSnap = snap; }, { skip: true }),
        setClipSnap: (snap) =>
          // Undo: transient — skip (UI-preference)
          recordingSet('ClipSnap', (s) => { s.ui.clipSnap = snap; }, { skip: true }),
        setExportState: (patch) =>
          // Undo: transient — skip (Export state is transient)
          recordingSet('ExportState', (s) => {
            s.ui.exportState = reduceExportState(s.ui.exportState, patch);
          }, { skip: true }),
        setFlowMode: (value) =>
          // Undo: transient — skip (UI-toggle)
          recordingSet('FlowMode', (s) => { s.ui.flowMode = value; }, { skip: true }),

        // Plan 9b — group operations. Plan 10: routed through
        // recordingSet so each one is exactly one undo step.
        moveSelectedClips: (deltaBeats) => {
          const selCount = get().ui.selectedClipIds.length;
          if (selCount === 0) return;
          // [Plan 10] coalesce: true — consecutive group-moves of the
          // same selection fold into one undo step. Label is constant
          // for the group action so any other action breaks the chain.
          recordingSet(`Move ${selCount} Clips`, (s) => {
            const ids = new Set(s.ui.selectedClipIds);
            // Clamp delta so no clip lands at startBeat < 0.
            let allowed = deltaBeats;
            for (const c of s.timeline.clips) {
              if (!ids.has(c.id)) continue;
              const target = c.startBeat + deltaBeats;
              if (target < 0) {
                allowed = Math.max(allowed, -c.startBeat);
              }
            }
            if (allowed === 0) return;
            for (const c of s.timeline.clips) {
              if (ids.has(c.id)) c.startBeat = c.startBeat + allowed;
            }
          }, { coalesce: true });
        },
        resizeSelectedClips: (deltaBeats, edge) => {
          const selCount = get().ui.selectedClipIds.length;
          if (selCount === 0) return;
          // [Plan 10] coalesce: true — drag-resize folds to one undo.
          recordingSet(`Resize ${selCount} Clips`, (s) => {
            const ids = new Set(s.ui.selectedClipIds);
            const MIN_LEN = 0.5;
            for (const c of s.timeline.clips) {
              if (!ids.has(c.id)) continue;
              if (edge === 'end') {
                // Clamp per-clip (Architect L4 — einzeln klemmen).
                c.lengthBeats = Math.max(MIN_LEN, c.lengthBeats + deltaBeats);
              } else {
                // edge === 'start': move startBeat AND shrink length.
                const rawLen = c.lengthBeats - deltaBeats;
                const newLen = Math.max(MIN_LEN, rawLen);
                const actualDelta = c.lengthBeats - newLen;
                c.startBeat = Math.max(0, c.startBeat + actualDelta);
                c.lengthBeats = newLen;
              }
            }
          }, { coalesce: true });
        },
        duplicateSelectedClips: (offsetBeats) => {
          let dupedCount = 0;
          const selCount = get().ui.selectedClipIds.length;
          if (selCount === 0) return 0;
          recordingSet(`Duplicate ${selCount} Clips`, (s) => {
            const ids = new Set(s.ui.selectedClipIds);
            const newClips: typeof s.timeline.clips = [];
            const newIds: string[] = [];
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
              const newParams = c.params
                ? Object.fromEntries(
                    Object.entries(c.params).map(([k, v]) => {
                      if (
                        v &&
                        typeof v === 'object' &&
                        'points' in (v as object) &&
                        Array.isArray((v as { points?: unknown }).points)
                      ) {
                        // Curve points are stored CLIP-RELATIVE by the
                        // AutomationCurveEditor (X-axis spans 0..lengthBeats,
                        // see AutomationCurveEditor.tsx:80). Shifting them
                        // by offsetBeats here would push them outside the
                        // new clip's [0..lengthBeats] window, leaving the
                        // editor canvas blank and breaking per-clip Flow
                        // Mode evaluation. Copy verbatim (still a deep
                        // clone for mutation safety).
                        const curve = v as { points: { beat: number; value: unknown }[] };
                        return [
                          k,
                          {
                            ...curve,
                            points: curve.points.map((p) => ({ ...p }))
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
            if (skipped > 0) {
              // eslint-disable-next-line no-console
              console.info(
                `[Plan 9b] duplicateSelectedClips: ${newClips.length} added, ${skipped} skipped (overlap or startBeat < 0)`
              );
            }
            if (newClips.length === 0) return;
            const singular = newIds.length === 1 ? newIds[0] : null;
            s.timeline.clips.push(...newClips);
            s.ui.selectedClipIds = newIds;
            s.ui.selectedClipId = singular;
            s.ui.automationEditorClipId = null;
          });
          return dupedCount;
        },
        deleteSelectedClips: () => {
          const selCount = get().ui.selectedClipIds.length;
          if (selCount === 0) return;
          recordingSet(`Delete ${selCount} Clips`, (s) => {
            const ids = new Set(s.ui.selectedClipIds);
            s.timeline.clips = s.timeline.clips.filter((c) => !ids.has(c.id));
            s.ui.selectedClipIds = [];
            s.ui.selectedClipId = null;
            s.ui.automationEditorClipId = null;
          });
        },

        ...createTimelineSlice(set, get, store),
        ...createAudioSlice(set, get, store),
        ...createMediaSlice(set, get, store),
        ...createMobileUISlice(set, get, store),
        ...createAppModeSlice(set, get, store),
        ...createSoundsSlice(set, get, store)
      };
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
          // Plan 10 — history is transient, never persisted. Always
          // start with an empty stack on rehydrate (the persisted
          // partial doesn't include `history`, but be defensive
          // against future shape changes).
          history: { past: [], future: [] },
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
