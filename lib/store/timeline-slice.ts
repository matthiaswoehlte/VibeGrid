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
  // Plan 10 — small helper to route a clip-param patch through
  // recordingSet so each one becomes a proper history entry.
  const patchClipParam = (
    clipId: string,
    key: string,
    transform: (current: unknown) => unknown,
    label: string,
    options?: { coalesce?: boolean }
  ): void => {
    get().recordingSet(
      label,
      (state) => {
        state.timeline = {
          ...state.timeline,
          clips: state.timeline.clips.map((c) => {
            if (c.id !== clipId) return c;
            const params = c.params ?? {};
            if (!(key in params)) return c;
            const next = transform(params[key]);
            if (next === params[key]) return c;
            return { ...c, params: { ...params, [key]: next } };
          })
        };
      },
      options
    );
  };

  return {
    timeline: initialTimelineState,
    timelineActions: {
      // Plan 10 — addClip records as own history entry. Label uses
      // clip kind so the Undo tooltip is informative ("Add Pulse").
      addClip: (clip) => {
        get().recordingSet(`Add ${clip.kind}`, (s) => {
          const intermediate = ops.addClip(s.timeline, clip);
          s.timeline = regenerateBlendsForTrack(intermediate, clip.trackId);
        });
      },
      // Plan 10 — coalesce: true. See Plan-10-Rev3 Modul 6 / W2
      // comment: consecutive moves fold into one Undo step. Constant
      // label "Move Clip" preserves Label-Match (W8).
      moveClip: (clipId, newStartBeat) => {
        const current = get().timeline.clips.find((c) => c.id === clipId);
        if (!current) return;
        get().recordingSet('Move Clip', (s) => {
          const intermediate = ops.moveClip(s.timeline, clipId, newStartBeat);
          s.timeline = regenerateBlendsForTrack(intermediate, current.trackId);
        }, { coalesce: true });
      },
      // Plan 8h — cross-track drag for single clips (same-kind only).
      // coalesce: true folds rapid drop-then-adjust into one undo step.
      // Both the source and destination track get blend-regenerated so
      // __blend params stay consistent on both sides.
      moveClipToTrack: (clipId, newTrackId, newStartBeat) => {
        const current = get().timeline.clips.find((c) => c.id === clipId);
        if (!current) return;
        get().recordingSet('Move Clip', (s) => {
          const intermediate = ops.moveClipToTrack(s.timeline, clipId, newTrackId, newStartBeat);
          // Regenerate blends for both source and destination tracks.
          const afterSource = regenerateBlendsForTrack(intermediate, current.trackId);
          s.timeline = regenerateBlendsForTrack(afterSource, newTrackId);
        }, { coalesce: true });
      },
      // Plan 10 — coalesce: true (resize drag folds to one undo).
      resizeClip: (clipId, newLengthBeats) => {
        const current = get().timeline.clips.find((c) => c.id === clipId);
        if (!current) return;
        get().recordingSet('Resize Clip', (s) => {
          const intermediate = ops.resizeClip(s.timeline, clipId, newLengthBeats);
          s.timeline = regenerateBlendsForTrack(intermediate, current.trackId);
        }, { coalesce: true });
      },
      removeClip: (clipId) => {
        const current = get().timeline.clips.find((c) => c.id === clipId);
        if (!current) return;
        get().recordingSet('Delete Clip', (s) => {
          const intermediate = ops.removeClip(s.timeline, clipId);
          s.timeline = regenerateBlendsForTrack(intermediate, current.trackId);
          // Plan 9b — also strip from selectedClipIds + sync compat field.
          const nextSelectedIds = s.ui.selectedClipIds.filter((id) => id !== clipId);
          if (nextSelectedIds.length !== s.ui.selectedClipIds.length) {
            s.ui.selectedClipIds = nextSelectedIds;
            s.ui.selectedClipId =
              nextSelectedIds.length === 1 ? nextSelectedIds[0] : null;
          }
          if (s.ui.automationEditorClipId === clipId) {
            s.ui.automationEditorClipId = null;
          }
        });
      },
      setClipParams: (clipId, params) =>
        get().recordingSet('Clip Params', (s) => {
          s.timeline = ops.setClipParams(s.timeline, clipId, params);
        }),
      setPlayhead: (beats) =>
        // Undo: transient — skip (called 60×/s during playback)
        get().recordingSet('Playhead', (s) => {
          s.timeline = ops.setPlayhead(s.timeline, beats);
        }, { skip: true }),
      setMuted: (trackId, muted) =>
        // Plan 10 — coalesce: true. Architect L2: schnelles Mute-
        // Toggling = 1 Undo-Schritt. Bleibt rückgängig machbar.
        get().recordingSet('Mute Track', (s) => {
          s.timeline = ops.setMuted(s.timeline, trackId, muted);
        }, { coalesce: true }),

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
        get().recordingSet('Add Track', (s) => {
          s.timeline = {
            ...s.timeline,
            tracks: [
              ...s.timeline.tracks,
              { id, kind, name: finalLabel, muted: false }
            ]
          };
        });
        return id;
      },
      removeTrack: (trackId) => {
        const t = get().timeline;
        const hasClips = t.clips.some((c) => c.trackId === trackId);
        if (hasClips) {
          throw new Error('Track enthält Clips — erst leeren');
        }
        get().recordingSet('Remove Track', (s) => {
          s.timeline = {
            ...s.timeline,
            tracks: s.timeline.tracks.filter((tr) => tr.id !== trackId)
          };
        });
      },
      reorderTracks: (orderedIds) => {
        get().recordingSet('Reorder Tracks', (s) => {
          const byId = new Map(s.timeline.tracks.map((tr) => [tr.id, tr]));
          const next: typeof s.timeline.tracks = [];
          for (const id of orderedIds) {
            const tr = byId.get(id);
            if (tr) {
              next.push(tr);
              byId.delete(id);
            }
          }
          for (const tr of s.timeline.tracks) {
            if (byId.has(tr.id)) next.push(tr);
          }
          s.timeline = { ...s.timeline, tracks: next };
        });
      },
      setTrackLabel: (trackId, label) => {
        const trimmed = label.trim();
        if (!trimmed) return;
        // Plan 10 — coalesce: true. Typing into the track-name field
        // produces many setTrackLabel calls; folding to one undo.
        get().recordingSet('Rename Track', (s) => {
          s.timeline = {
            ...s.timeline,
            tracks: s.timeline.tracks.map((tr) =>
              tr.id === trackId ? { ...tr, name: trimmed } : tr
            )
          };
        }, { coalesce: true });
      },
      setClipParam: (clipId, key, value) => {
        // Plan 10 — coalesce: true. Slider drag in Inspector produces
        // many setClipParam calls per second; folding to one undo.
        get().recordingSet(key, (s) => {
          s.timeline = {
            ...s.timeline,
            clips: s.timeline.clips.map((c) =>
              c.id === clipId
                ? { ...c, params: { ...(c.params ?? {}), [key]: value } }
                : c
            )
          };
        }, { coalesce: true });
      },
      convertParamToAutomation: (clipId, key, beat, initialValue) => {
        get().recordingSet('Enable Automation', (s) => {
          s.timeline = {
            ...s.timeline,
            clips: s.timeline.clips.map((c) => {
              if (c.id !== clipId) return c;
              const params = c.params ?? {};
              const existing = key in params ? params[key] : initialValue;
              if (isAutomationCurve(existing)) return c;
              if (existing === undefined) return c;
              return { ...c, params: { ...params, [key]: makeCurve(existing, beat, 'linear') } };
            })
          };
        });
      },
      convertParamToStatic: (clipId, key) =>
        patchClipParam(clipId, key, (current) =>
          isAutomationCurve(current) ? toStaticValue(current) : current,
          'Disable Automation'
        ),
      addParamPoint: (clipId, key, point) =>
        patchClipParam(clipId, key, (current) =>
          isAutomationCurve(current)
            ? addPoint(current as AutomationCurve<unknown>, point as AutomationPoint<unknown>)
            : current,
          'Edit Automation',
          { coalesce: true }
        ),
      removeParamPoint: (clipId, key, index) =>
        patchClipParam(clipId, key, (current) =>
          isAutomationCurve(current)
            ? removePoint(current as AutomationCurve<unknown>, index)
            : current,
          'Edit Automation',
          { coalesce: true }
        ),
      updateParamPoint: (clipId, key, index, patch) =>
        patchClipParam(clipId, key, (current) =>
          isAutomationCurve(current)
            ? updatePoint(
                current as AutomationCurve<unknown>,
                index,
                patch as Partial<AutomationPoint<unknown>>
              )
            : current,
          'Edit Automation',
          { coalesce: true }
        ),
      setParamInterpolation: (clipId, key, interpolation) =>
        patchClipParam(clipId, key, (current) =>
          isAutomationCurve(current)
            ? { ...(current as AutomationCurve<unknown>), interpolation }
            : current,
          'Interpolation'
        ),
      updateParamPoints: (clipId, key, updates) => {
        if (updates.length === 0) return;
        // Plan 10 — coalesce: true (Editor multi-point drag)
        get().recordingSet('Edit Automation', (state) => {
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
          state.timeline = { ...state.timeline, clips };
        }, { coalesce: true });
      },
      setBlendInterpolation: (clipId, interpolation) => {
        get().recordingSet('Blend Interpolation', (s) => {
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
          s.timeline = { ...s.timeline, clips };
        });
      },
      // Plan 8d — Transfer-flow wipe.
      clearAllTracks: () => {
        get().recordingSet('Clear All Tracks', (s) => {
          s.timeline = { ...s.timeline, tracks: [], clips: [] };
          s.ui.selectedClipId = null;
          s.ui.automationEditorClipId = null;
        });
      },
      // Plan 8d — re-snap after BPM change.
      // Plan 10 — replaceMainVideoClips runs as part of the SceneFlow
      // Transfer flow. Per Architect-L3 the entire Transfer is OUT of
      // the Undo scope (skip + caller-side toast) because MediaRefs
      // are R2-bound and can't be reverted. Marking skip here means
      // any caller other than the Transfer-flow also can't undo it
      // — acceptable because there is no such caller.
      replaceMainVideoClips: (layoutByMediaId) => {
        get().recordingSet('Replace Main Video', (s) => {
          const mainTrackId = s.timeline.tracks.find(
            (t) => t.kind === 'main-video'
          )?.id;
          if (!mainTrackId) return;
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
          s.timeline = { ...s.timeline, clips };
        }, { skip: true });
      }
    }
  };
};
