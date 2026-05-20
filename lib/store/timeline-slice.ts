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

// Default tracks — one per TrackKind per Spec §6. Without these, the timeline
// renders no lanes and there's nowhere to drop clips. Order matches visual
// stacking (image at top, FX layered above per RENDER_ORDER).
export const initialTimelineState: TimelineState = {
  tracks: [
    { id: 'track-image', kind: 'image', name: 'Image', muted: false, order: 0 },
    { id: 'track-contour', kind: 'contour', name: 'Contour', muted: false, order: 1 },
    { id: 'track-sweep', kind: 'sweep', name: 'Sweep', muted: false, order: 2 },
    { id: 'track-particles', kind: 'particles', name: 'Particles', muted: false, order: 3 },
    { id: 'track-pulse', kind: 'pulse', name: 'Pulse', muted: false, order: 4 }
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
      addClip: (clip) => set({ timeline: ops.addClip(get().timeline, clip) }),
      moveClip: (clipId, newStartBeat) =>
        set({ timeline: ops.moveClip(get().timeline, clipId, newStartBeat) }),
      resizeClip: (clipId, newLengthBeats) =>
        set({ timeline: ops.resizeClip(get().timeline, clipId, newLengthBeats) }),
      removeClip: (clipId) =>
        set((s) => ({
          timeline: ops.removeClip(s.timeline, clipId),
          ui:
            s.ui.expandedAutomationClipId === clipId
              ? { ...s.ui, expandedAutomationClipId: null }
              : s.ui
        })),
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
      convertParamToAutomation: (clipId, key, beat) =>
        patchClipParam(clipId, key, (current) =>
          isAutomationCurve(current) ? current : makeCurve(current, beat, 'linear')
        ),
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
        )
    }
  };
};
