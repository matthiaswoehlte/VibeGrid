import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { initialTimelineState } from '@/lib/store/timeline-slice';

describe('timeline store slice', () => {
  beforeEach(() => {
    useAppStore.setState({ timeline: initialTimelineState });
  });

  it('exposes initialTimelineState as the default', () => {
    expect(useAppStore.getState().timeline).toEqual(initialTimelineState);
  });

  it('initialTimelineState has exactly 4 lanes: image, video, audio, fx', () => {
    expect(initialTimelineState.tracks.map((t) => t.kind)).toEqual([
      'image', 'video', 'audio', 'fx'
    ]);
  });

  it('addClip mutates the store via the pure operation', () => {
    // Use the default fx track from initialTimelineState — clip.kind
    // is still the lowercase FX-kind for the renderer's plugin
    // dispatch.
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    useAppStore.getState().timelineActions.addClip({
      id: 'a',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'a'
    });
    expect(useAppStore.getState().timeline.clips).toHaveLength(1);
  });

  it('setPlayhead updates the timeline.playhead.beats', () => {
    useAppStore.getState().timelineActions.setPlayhead(10);
    expect(useAppStore.getState().timeline.playhead.beats).toBe(10);
  });

  // Plan 8h — cross-track drag store action.
  it('moveClipToTrack updates both trackId and startBeat and records an undo entry', () => {
    const tracks = initialTimelineState.tracks;
    const fxTrack = tracks.find((t) => t.kind === 'fx')!;
    // Add a second fx track so we have a valid cross-track destination.
    useAppStore.getState().timelineActions.addTrack('fx', 'FX 2');
    const state = useAppStore.getState();
    const fxTrack2 = state.timeline.tracks.find(
      (t) => t.kind === 'fx' && t.id !== fxTrack.id
    )!;

    // Place a clip on the first fx track.
    useAppStore.getState().timelineActions.addClip({
      id: 'clip-x',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'X'
    });

    // Snapshot undo stack depth before the cross-track move.
    const undoDepthBefore = useAppStore.getState().history.past.length;

    // Perform the cross-track move.
    useAppStore.getState().timelineActions.moveClipToTrack('clip-x', fxTrack2.id, 8);

    const after = useAppStore.getState();
    const moved = after.timeline.clips.find((c) => c.id === 'clip-x')!;
    expect(moved.trackId).toBe(fxTrack2.id);
    expect(moved.startBeat).toBe(8);

    // An undo entry must have been recorded (coalesced label = 'Move Clip').
    expect(after.history.past.length).toBeGreaterThan(undoDepthBefore);
  });
});
