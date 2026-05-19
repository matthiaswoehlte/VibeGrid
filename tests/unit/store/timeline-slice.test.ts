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

  it('addClip re-throws OperationError on overlap so the UI can catch it', () => {
    const { timelineActions } = useAppStore.getState();
    timelineActions.addClip({
      id: 'a',
      trackId: 't1',
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 8,
      label: 'a'
    });
    expect(() =>
      timelineActions.addClip({
        id: 'b',
        trackId: 't1',
        kind: 'contour',
        startBeat: 4,
        lengthBeats: 4,
        label: 'b'
      })
    ).toThrow(OperationError);
  });

  it('setPlayhead updates the timeline.playhead.beats', () => {
    useAppStore.getState().timelineActions.setPlayhead(10);
    expect(useAppStore.getState().timeline.playhead.beats).toBe(10);
  });
});
