import type { StateCreator } from 'zustand';
import type { AppState } from './types';
import type { TimelineState } from '@/lib/timeline/types';
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

// Default tracks — one per TrackKind per Spec §6. Without these, the timeline
// renders no lanes and there's nowhere to drop clips. Order matches visual
// stacking (image at top, FX layered above per RENDER_ORDER).
export const initialTimelineState: TimelineState = {
  tracks: [
    { id: 'track-image', kind: 'image', name: 'Image', muted: false, order: 0 },
    { id: 'track-contour', kind: 'contour', name: 'Contour', muted: false, order: 1 },
    { id: 'track-zoom-pulse', kind: 'zoom-pulse', name: 'Zoom Pulse', muted: false, order: 2 },
    { id: 'track-sweep', kind: 'sweep', name: 'Sweep', muted: false, order: 3 },
    { id: 'track-particles', kind: 'particles', name: 'Particles', muted: false, order: 4 },
    { id: 'track-pulse', kind: 'pulse', name: 'Pulse', muted: false, order: 5 },
    // Plan 5.8a — three new tracks. Order continues from existing 0..5.
    { id: 'track-dissolve', kind: 'dissolve', name: 'Dissolve', muted: false, order: 6 },
    { id: 'track-sunray', kind: 'sunray', name: 'Sunray', muted: false, order: 7 },
    { id: 'track-text', kind: 'text', name: 'Text', muted: false, order: 8 }
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
          return {
            timeline: regenerated,
            ui:
              s.ui.automationEditorClipId === clipId
                ? { ...s.ui, automationEditorClipId: null }
                : s.ui
          };
        });
      },
      setClipParams: (clipId, params) =>
        set({ timeline: ops.setClipParams(get().timeline, clipId, params) }),
      setPlayhead: (beats) => set({ timeline: ops.setPlayhead(get().timeline, beats) }),
      setMuted: (trackId, muted) =>
        set({ timeline: ops.setMuted(get().timeline, trackId, muted) }),
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
      }
    }
  };
};
