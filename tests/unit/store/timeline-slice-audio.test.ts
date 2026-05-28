import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { initialTimelineState } from '@/lib/store/timeline-slice';

beforeEach(() => {
  useAppStore.setState((s) => ({
    timeline: {
      ...s.timeline,
      tracks: [...initialTimelineState.tracks],
      clips: []
    }
  }));
});

describe('Multi-Audio-Tracks (Plan 5.9d)', () => {
  it('addTrack("audio") with one existing audio lane labels the new one "Audio 2"', () => {
    // After the initial-track redesign the default rig no longer ships
    // with a generic `audio` lane (Sync Audio is the singleton master).
    // Seed one Audio track first, then verify the suffix logic.
    useAppStore.getState().timelineActions.addTrack('audio');
    useAppStore.getState().timelineActions.addTrack('audio');
    const audio = useAppStore.getState().timeline.tracks.filter((t) => t.kind === 'audio');
    expect(audio.map((t) => t.name)).toEqual(['Audio', 'Audio 2']);
  });

  it('repeated addTrack("audio") yields Audio / Audio 2 / Audio 3 / Audio 4', () => {
    const { addTrack } = useAppStore.getState().timelineActions;
    addTrack('audio');
    addTrack('audio');
    addTrack('audio');
    addTrack('audio');
    const names = useAppStore
      .getState()
      .timeline.tracks
      .filter((t) => t.kind === 'audio')
      .map((t) => t.name);
    expect(names).toEqual(['Audio', 'Audio 2', 'Audio 3', 'Audio 4']);
  });
});
