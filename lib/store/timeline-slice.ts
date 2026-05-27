import type { StateCreator } from 'zustand';
import type { AppState } from './types';
import type { TimelineState, Track, TrackKind } from '@/lib/timeline/types';
import * as ops from '@/lib/timeline/operations';
import { isAutomationCurve } from '@/lib/automation/resolve';
import {
  makeCurve,
  toStaticValue,
  addPoint,
  removePoint,
  updatePoint
} from '@/lib/automation/operations';
import type { AutomationCurve, AutomationPoint } from '@/lib/automation/types';
import { regenerateBlendsForTrack } from '@/lib/timeline/blend-lifecycle';
import { BLEND_KEY } from '@/lib/timeline/blend';

/** Plan 5.9a / 5.9c — title-case mapping for default track labels when
 *  the user hits "+ Track" without typing a name. Multiple tracks of
 *  the same kind get numbered (`FX`, `FX 2`, …). */
const KIND_LABEL: Record<TrackKind, string> = {
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  fx: 'FX',
  // Plan 8d — singleton tracks, default labels only used when the
  // store creates them; UI labels are usually 'Main' / 'Sync' set
  // directly in clearAllTracks-then-create flow.
  'main-video': 'Main Video',
  'sync-audio': 'Sync Audio'
};

function defaultLabelFor(kind: TrackKind, existing: Track[]): string {
  const base = KIND_LABEL[kind];
  const sameKindCount = existing.filter((t) => t.kind === kind).length;
  return sameKindCount === 0 ? base : `${base} ${sameKindCount + 1}`;
}

/** Plan 5.9c — frozen copy of the v4-era 10-track default set. The
 *  v4 → v5 migration appends these to old snapshots that pre-date
 *  later FX additions (Plan 5.8a's text/dissolve/sunray, Plan 5.9a's
 *  video). After 5.9c `initialTimelineState.tracks` shrinks to 4
 *  lanes; without this frozen reference the migration would have
 *  nothing meaningful to append and v4 users would lose their FX
 *  lanes on rehydrate.
 *
 *  The shape is **deliberately not `Track`** — `Track.kind` narrows
 *  to the 4-entry `TrackKind`, but these legacy entries carry the
 *  v5 FX-kinds (`'contour'`, `'sweep'`, …). They're rewritten to
 *  `kind: 'fx'` by the v5→v6 migration step in `store/index.ts`.
 *  Treat them as raw v5 record data, NOT as live Track objects. */
export interface LegacyV5Track {
  id: string;
  kind: string;
  name: string;
  muted: boolean;
  order: number;
}

export const INITIAL_TRACKS_V5: ReadonlyArray<LegacyV5Track> = Object.freeze([
  { id: 'track-image', kind: 'image', name: 'Image', muted: false, order: 0 },
  { id: 'track-contour', kind: 'contour', name: 'Contour', muted: false, order: 1 },
  { id: 'track-zoom-pulse', kind: 'zoom-pulse', name: 'Zoom Pulse', muted: false, order: 2 },
  { id: 'track-sweep', kind: 'sweep', name: 'Sweep', muted: false, order: 3 },
  { id: 'track-particles', kind: 'particles', name: 'Particles', muted: false, order: 4 },
  { id: 'track-pulse', kind: 'pulse', name: 'Pulse', muted: false, order: 5 },
  { id: 'track-dissolve', kind: 'dissolve', name: 'Dissolve', muted: false, order: 6 },
  { id: 'track-sunray', kind: 'sunray', name: 'Sunray', muted: false, order: 7 },
  { id: 'track-text', kind: 'text', name: 'Text', muted: false, order: 8 },
  { id: 'track-video', kind: 'video', name: 'Video', muted: false, order: 9 }
]);

// Default tracks — one per TrackKind. Plan 5.9c collapsed eight
// per-FX-plugin lanes into one generic `'fx'` lane; users can add
// more FX lanes via "+ Track hinzufügen" if they want visual grouping
// or separate mute scopes. Plan 5.9d unlocks Multi-Audio — calling
// `addTrack('audio')` repeatedly produces "Audio 2", "Audio 3", …
// Array index drives render order.
export const initialTimelineState: TimelineState = {
  tracks: [
    { id: 'track-image', kind: 'image', name: 'Image', muted: false },
    { id: 'track-video', kind: 'video', name: 'Video', muted: false },
    { id: 'track-audio', kind: 'audio', name: 'Audio', muted: false },
    { id: 'track-fx-1', kind: 'fx',    name: 'FX',    muted: false }
  ],
  clips: [],
  playhead: { beats: 0, playing: false },
  zoom: 1,
  snap: 'beat'
};

export const createTimelineSlice: StateCreator<
  AppState,
  [],
  [],
  Pick<AppState, 'timeline' | 'timelineActions'>
> = (set, get) => {
  // Closes over the slice's `set` — avoids fragile Parameters<typeof …>[0]
  // indirection. No-op when clip or key is missing, and when transform returns
  // the same reference (used by isAutomationCurve guards).
  const patchClipParam = (
    clipId: string,
    key: string,
    transform: (current: unknown) => unknown
  ): void => {
    set((state) => ({
      timeline: {
        ...state.timeline,
        clips: state.timeline.clips.map((c) => {
          if (c.id !== clipId) return c;
          const params = c.params ?? {};
          if (!(key in params)) return c;
          const next = transform(params[key]);
          if (next === params[key]) return c;
          return { ...c, params: { ...params, [key]: next } };
        })
      }
    }));
  };

  return {
    timeline: initialTimelineState,
    timelineActions: {
      addClip: (clip) => {
        const intermediate = ops.addClip(get().timeline, clip);
        set({ timeline: regenerateBlendsForTrack(intermediate, clip.trackId) });
      },
      moveClip: (clipId, newStartBeat) => {
        const current = get().timeline.clips.find((c) => c.id === clipId);
        if (!current) return;
        const intermediate = ops.moveClip(get().timeline, clipId, newStartBeat);
        set({ timeline: regenerateBlendsForTrack(intermediate, current.trackId) });
      },
      resizeClip: (clipId, newLengthBeats) => {
        const current = get().timeline.clips.find((c) => c.id === clipId);
        if (!current) return;
        const intermediate = ops.resizeClip(get().timeline, clipId, newLengthBeats);
        set({ timeline: regenerateBlendsForTrack(intermediate, current.trackId) });
      },
      removeClip: (clipId) => {
        const current = get().timeline.clips.find((c) => c.id === clipId);
        set((s) => {
          const intermediate = ops.removeClip(s.timeline, clipId);
          const regenerated = current
            ? regenerateBlendsForTrack(intermediate, current.trackId)
            : intermediate;
          // Plan 9b — also strip from selectedClipIds + sync compat field.
          const nextSelectedIds = s.ui.selectedClipIds.filter((id) => id !== clipId);
          const selectionChanged =
            nextSelectedIds.length !== s.ui.selectedClipIds.length;
          const nextSelectedSingular =
            nextSelectedIds.length === 1 ? nextSelectedIds[0] : null;
          const editorChanged = s.ui.automationEditorClipId === clipId;
          if (!selectionChanged && !editorChanged) {
            return { timeline: regenerated };
          }
          return {
            timeline: regenerated,
            ui: {
              ...s.ui,
              selectedClipIds: selectionChanged ? nextSelectedIds : s.ui.selectedClipIds,
              selectedClipId: selectionChanged
                ? nextSelectedSingular
                : s.ui.selectedClipId,
              automationEditorClipId: editorChanged ? null : s.ui.automationEditorClipId
            }
          };
        });
      },
      setClipParams: (clipId, params) =>
        set({ timeline: ops.setClipParams(get().timeline, clipId, params) }),
      setPlayhead: (beats) => set({ timeline: ops.setPlayhead(get().timeline, beats) }),
      setMuted: (trackId, muted) =>
        set({ timeline: ops.setMuted(get().timeline, trackId, muted) }),

      // Plan 5.9a/5.9c/5.9d — dynamic multi-track actions. The
      // `'audio'` soft-reject from 5.9c is gone — Multi-Audio is the
      // headline feature of 5.9d. All four track kinds are now
      // user-creatable; numbering via defaultLabelFor handles
      // repeated calls ("Audio", "Audio 2", "Audio 3"…).
      addTrack: (kind, label) => {
        const id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const finalLabel = label ?? defaultLabelFor(kind, get().timeline.tracks);
        set((s) => ({
          timeline: {
            ...s.timeline,
            tracks: [
              ...s.timeline.tracks,
              { id, kind, name: finalLabel, muted: false }
            ]
          }
        }));
        // Plan 9a — return the generated id so callers (e.g.
        // findOrCreateFxTrack in lib/presets/store-bridge.ts) can use
        // it without needing a second `tracks.find()` round-trip.
        return id;
      },
      removeTrack: (trackId) => {
        const t = get().timeline;
        const hasClips = t.clips.some((c) => c.trackId === trackId);
        if (hasClips) {
          throw new Error('Track enthält Clips — erst leeren');
        }
        set((s) => ({
          timeline: {
            ...s.timeline,
            tracks: s.timeline.tracks.filter((tr) => tr.id !== trackId)
          }
        }));
      },
      reorderTracks: (orderedIds) => {
        set((s) => {
          const byId = new Map(s.timeline.tracks.map((tr) => [tr.id, tr]));
          const next: typeof s.timeline.tracks = [];
          for (const id of orderedIds) {
            const tr = byId.get(id);
            if (tr) {
              next.push(tr);
              byId.delete(id);
            }
          }
          // Append leftovers (unknown ids in `orderedIds` ignored; tracks
          // not mentioned keep their original relative order at the end).
          for (const tr of s.timeline.tracks) {
            if (byId.has(tr.id)) next.push(tr);
          }
          return { timeline: { ...s.timeline, tracks: next } };
        });
      },
      setTrackLabel: (trackId, label) => {
        const trimmed = label.trim();
        if (!trimmed) return;
        set((s) => ({
          timeline: {
            ...s.timeline,
            tracks: s.timeline.tracks.map((tr) =>
              tr.id === trackId ? { ...tr, name: trimmed } : tr
            )
          }
        }));
      },
      setClipParam: (clipId, key, value) => {
        set((s) => ({
          timeline: {
            ...s.timeline,
            clips: s.timeline.clips.map((c) =>
              c.id === clipId
                ? { ...c, params: { ...(c.params ?? {}), [key]: value } }
                : c
            )
          }
        }));
      },
      convertParamToAutomation: (clipId, key, beat, initialValue) => {
        // Can't use patchClipParam — that bails when the key is missing from
        // clip.params (true for fresh clips with no overrides). For those we
        // need to write a brand-new entry using `initialValue` (the resolved
        // default the Inspector passes from `plugin.getDefaultParams()`).
        set((state) => ({
          timeline: {
            ...state.timeline,
            clips: state.timeline.clips.map((c) => {
              if (c.id !== clipId) return c;
              const params = c.params ?? {};
              const existing = key in params ? params[key] : initialValue;
              if (isAutomationCurve(existing)) return c;
              if (existing === undefined) return c;
              return { ...c, params: { ...params, [key]: makeCurve(existing, beat, 'linear') } };
            })
          }
        }));
      },
      convertParamToStatic: (clipId, key) =>
        patchClipParam(clipId, key, (current) =>
          isAutomationCurve(current) ? toStaticValue(current) : current
        ),
      addParamPoint: (clipId, key, point) =>
        patchClipParam(clipId, key, (current) =>
          isAutomationCurve(current)
            ? addPoint(current as AutomationCurve<unknown>, point as AutomationPoint<unknown>)
            : current
        ),
      removeParamPoint: (clipId, key, index) =>
        patchClipParam(clipId, key, (current) =>
          isAutomationCurve(current)
            ? removePoint(current as AutomationCurve<unknown>, index)
            : current
        ),
      updateParamPoint: (clipId, key, index, patch) =>
        patchClipParam(clipId, key, (current) =>
          isAutomationCurve(current)
            ? updatePoint(
                current as AutomationCurve<unknown>,
                index,
                patch as Partial<AutomationPoint<unknown>>
              )
            : current
        ),
      setParamInterpolation: (clipId, key, interpolation) =>
        patchClipParam(clipId, key, (current) =>
          isAutomationCurve(current)
            ? { ...(current as AutomationCurve<unknown>), interpolation }
            : current
        ),
      updateParamPoints: (clipId, key, updates) => {
        if (updates.length === 0) return;
        set((state) => {
          const clips = state.timeline.clips.map((c) => {
            if (c.id !== clipId) return c;
            const params = c.params ?? {};
            if (!(key in params)) return c;
            const cur = params[key];
            if (!isAutomationCurve(cur)) return c;
            let curve = cur as AutomationCurve<unknown>;
            for (const u of updates) {
              const patch: Partial<AutomationPoint<unknown>> = {};
              if (u.beat !== undefined) patch.beat = u.beat;
              if (u.value !== undefined) patch.value = u.value;
              curve = updatePoint(curve, u.index, patch);
            }
            return { ...c, params: { ...params, [key]: curve } };
          });
          return { timeline: { ...state.timeline, clips } };
        });
      },
      setBlendInterpolation: (clipId, interpolation) => {
        set((s) => {
          const clips = s.timeline.clips.map((c) => {
            if (c.id !== clipId) return c;
            const blend = c.params?.[BLEND_KEY];
            if (!isAutomationCurve(blend)) return c;
            return {
              ...c,
              params: {
                ...c.params!,
                [BLEND_KEY]: { ...(blend as AutomationCurve<unknown>), interpolation }
              }
            };
          });
          return { timeline: { ...s.timeline, clips } };
        });
      },
      // Plan 8d — Transfer-flow wipe. All tracks + clips dropped; the
      // SceneFlow handler immediately re-adds main-video + sync-audio.
      // selectedClipId + automationEditorClipId in UI also cleared so
      // the Inspector doesn't keep a dangling reference to a deleted clip.
      clearAllTracks: () => {
        set((s) => ({
          timeline: { ...s.timeline, tracks: [], clips: [] },
          ui: {
            ...s.ui,
            selectedClipId: null,
            automationEditorClipId: null
          }
        }));
      },
      // Plan 8d — re-snap after BPM change. Map keyed by mediaId so
      // matching by content survives clip-array reordering. Clip.id is
      // PRESERVED (only startBeat + lengthBeats mutate) — Undo/Redo,
      // automation point references, and JSONB persistence stay valid.
      replaceMainVideoClips: (layoutByMediaId) => {
        set((s) => {
          const mainTrackId = s.timeline.tracks.find(
            (t) => t.kind === 'main-video'
          )?.id;
          if (!mainTrackId) return s;
          const clips = s.timeline.clips.map((c) => {
            if (c.trackId !== mainTrackId) return c;
            if (!c.mediaId) return c;
            const layout = layoutByMediaId.get(c.mediaId);
            if (!layout) return c;
            return {
              ...c,
              startBeat: layout.startBeat,
              lengthBeats: layout.lengthBeats
            };
          });
          return { timeline: { ...s.timeline, clips } };
        });
      }
    }
  };
};
