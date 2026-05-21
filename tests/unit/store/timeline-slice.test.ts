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
});
