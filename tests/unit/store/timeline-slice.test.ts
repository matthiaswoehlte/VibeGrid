import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { initialTimelineState } from '@/lib/store/timeline-slice';
import { OperationError } from '@/lib/timeline/operations';

describe('timeline store slice', () => {
  beforeEach(() => {
    useAppStore.setState({ timeline: initialTimelineState });
  });

  it('exposes initialTimelineState as the default', () => {
    expect(useAppStore.getState().timeline).toEqual(initialTimelineState);
  });

  it('addClip mutates the store via the pure operation', () => {
    useAppStore.getState().timelineActions.addClip({
      id: 'a',
      trackId: 't1',
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'a'
    });
    expect(useAppStore.getState().timeline.clips).toHaveLength(1);
  });

  it('addClip allows overlapping clips on the same track (transition prerequisite)', () => {
    const { timelineActions } = useAppStore.getState();
    timelineActions.addClip({
      id: 'a',
      trackId: 't1',
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 8,
      label: 'a'
    });
    timelineActions.addClip({
      id: 'b',
      trackId: 't1',
      kind: 'contour',
      startBeat: 4,
      lengthBeats: 4,
      label: 'b'
    });
    expect(useAppStore.getState().timeline.clips.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('setPlayhead updates the timeline.playhead.beats', () => {
    useAppStore.getState().timelineActions.setPlayhead(10);
    expect(useAppStore.getState().timeline.playhead.beats).toBe(10);
  });
});
