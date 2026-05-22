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

describe('Store Actions — addTrack (Plan 5.9a / 5.9c)', () => {
  it('adds a new fx track with auto-generated id and suffix label', () => {
    const before = useAppStore.getState().timeline.tracks.length;
    useAppStore.getState().timelineActions.addTrack('fx');
    const tracks = useAppStore.getState().timeline.tracks;
    expect(tracks.length).toBe(before + 1);
    const newTrack = tracks[tracks.length - 1];
    expect(newTrack.kind).toBe('fx');
    // initialTimelineState already has one FX lane named "FX" → suffix kicks in.
    expect(newTrack.name).toBe('FX 2');
    expect(newTrack.id.length).toBeGreaterThan(0);
    expect(newTrack.muted).toBe(false);
  });

  it('repeated addTrack("fx") yields FX 2 / FX 3 / FX 4', () => {
    const { addTrack } = useAppStore.getState().timelineActions;
    addTrack('fx');
    addTrack('fx');
    addTrack('fx');
    const fxNames = useAppStore
      .getState()
      .timeline.tracks.filter((t) => t.kind === 'fx')
      .map((t) => t.name);
    expect(fxNames).toEqual(['FX', 'FX 2', 'FX 3', 'FX 4']);
  });

  it('uses the explicit label when one is provided', () => {
    useAppStore.getState().timelineActions.addTrack('image', 'Hintergrund');
    const tracks = useAppStore.getState().timeline.tracks;
    expect(tracks[tracks.length - 1].name).toBe('Hintergrund');
  });

  it('addTrack("audio") creates a new audio lane (Multi-Audio enabled by Plan 5.9d)', () => {
    const before = useAppStore.getState().timeline.tracks
      .filter((t) => t.kind === 'audio').length;
    useAppStore.getState().timelineActions.addTrack('audio');
    const after = useAppStore.getState().timeline.tracks
      .filter((t) => t.kind === 'audio').length;
    expect(after).toBe(before + 1);
  });

  it('appends new tracks at the end (array index drives render order)', () => {
    useAppStore.getState().timelineActions.addTrack('fx');
    const tracks = useAppStore.getState().timeline.tracks;
    expect(tracks[tracks.length - 1].kind).toBe('fx');
  });
});

describe('Store Actions — removeTrack (Plan 5.9a)', () => {
  it('removes a track when it has no clips', () => {
    const t = useAppStore.getState().timeline.tracks[0];
    useAppStore.getState().timelineActions.removeTrack(t.id);
    expect(
      useAppStore.getState().timeline.tracks.find((tr) => tr.id === t.id)
    ).toBeUndefined();
  });

  it("throws when the track still has clips — toast.error in UI layer", () => {
    const fxTrack = useAppStore
      .getState()
      .timeline.tracks.find((t) => t.kind === 'fx')!;
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: [
          {
            id: 'p1',
            trackId: fxTrack.id,
            kind: 'pulse',
            fxId: 'pulse',
            startBeat: 0,
            lengthBeats: 4,
            label: 'p1'
          }
        ]
      }
    }));
    expect(() =>
      useAppStore.getState().timelineActions.removeTrack(fxTrack.id)
    ).toThrow(/Clips/);
  });

  it('non-existent track id is a no-op (no throw, no change)', () => {
    const before = useAppStore.getState().timeline.tracks.length;
    useAppStore.getState().timelineActions.removeTrack('does-not-exist');
    expect(useAppStore.getState().timeline.tracks.length).toBe(before);
  });
});

describe('Store Actions — reorderTracks (Plan 5.9a)', () => {
  it('reorders tracks to match the given id sequence', () => {
    const tracks = useAppStore.getState().timeline.tracks;
    const reversed = [...tracks].reverse().map((t) => t.id);
    useAppStore.getState().timelineActions.reorderTracks(reversed);
    const after = useAppStore.getState().timeline.tracks.map((t) => t.id);
    expect(after).toEqual(reversed);
  });

  it('appends tracks NOT mentioned in the order list at the end', () => {
    const tracks = useAppStore.getState().timeline.tracks;
    const partial = [tracks[2].id, tracks[0].id];
    useAppStore.getState().timelineActions.reorderTracks(partial);
    const after = useAppStore.getState().timeline.tracks;
    expect(after[0].id).toBe(tracks[2].id);
    expect(after[1].id).toBe(tracks[0].id);
    expect(after.length).toBe(tracks.length);
  });

  it('ignores unknown ids in the order list', () => {
    const tracks = useAppStore.getState().timeline.tracks;
    const withUnknown = ['unknown-id', tracks[0].id];
    useAppStore.getState().timelineActions.reorderTracks(withUnknown);
    expect(useAppStore.getState().timeline.tracks.length).toBe(tracks.length);
  });
});

describe('Store Actions — setTrackLabel (Plan 5.9a)', () => {
  it('updates the track name', () => {
    const t = useAppStore.getState().timeline.tracks[0];
    useAppStore.getState().timelineActions.setTrackLabel(t.id, 'My Custom Lane');
    const after = useAppStore.getState().timeline.tracks.find((tr) => tr.id === t.id);
    expect(after?.name).toBe('My Custom Lane');
  });

  it('rejects empty / whitespace-only labels (no-op)', () => {
    const t = useAppStore.getState().timeline.tracks[0];
    const before = t.name;
    useAppStore.getState().timelineActions.setTrackLabel(t.id, '   ');
    const after = useAppStore.getState().timeline.tracks.find((tr) => tr.id === t.id);
    expect(after?.name).toBe(before);
  });

  it('trims surrounding whitespace from labels', () => {
    const t = useAppStore.getState().timeline.tracks[0];
    useAppStore.getState().timelineActions.setTrackLabel(t.id, '  Stage  ');
    const after = useAppStore.getState().timeline.tracks.find((tr) => tr.id === t.id);
    expect(after?.name).toBe('Stage');
  });
});
