import type { StateCreator } from 'zustand';
import type { AppState } from './types';
import type { TimelineState } from '@/lib/timeline/types';
import * as ops from '@/lib/timeline/operations';

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
> = (set, get) => ({
  timeline: initialTimelineState,
  timelineActions: {
    addClip: (clip) => set({ timeline: ops.addClip(get().timeline, clip) }),
    moveClip: (clipId, newStartBeat) =>
      set({ timeline: ops.moveClip(get().timeline, clipId, newStartBeat) }),
    resizeClip: (clipId, newLengthBeats) =>
      set({ timeline: ops.resizeClip(get().timeline, clipId, newLengthBeats) }),
    removeClip: (clipId) => set({ timeline: ops.removeClip(get().timeline, clipId) }),
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
    }
  }
});
