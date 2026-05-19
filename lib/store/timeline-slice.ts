import type { StateCreator } from 'zustand';
import type { AppState } from './types';
import type { TimelineState } from '@/lib/timeline/types';
import * as ops from '@/lib/timeline/operations';

export const initialTimelineState: TimelineState = {
  tracks: [],
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
      set({ timeline: ops.setMuted(get().timeline, trackId, muted) })
  }
});
