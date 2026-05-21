import { describe, it, expect } from 'vitest';
import { migrate } from '@/lib/store';
import v5Fixture from '../../fixtures/timeline-v5.json';
import type { Track } from '@/lib/timeline/types';

const FX_KIND_STRINGS = new Set([
  'contour', 'sweep', 'pulse', 'particles', 'zoom-pulse',
  'text', 'dissolve', 'sunray'
]);

/** Deep-clones so each test gets a fresh, unmodified input. */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

describe('Store migration v5 → v6 (Plan 5.9c)', () => {
  it('rewrites every FX-kind track to kind:"fx"; preserves track.name and clips', () => {
    const state = clone(v5Fixture.state);
    const result = migrate(state, 5) as typeof state;
    const tracks = result.timeline!.tracks as Track[];
    // No track retains a legacy FX-kind.
    for (const t of tracks) {
      expect(['image', 'video', 'audio', 'fx']).toContain(t.kind);
    }
    // The user-renamed "Mein Sweep" lane survives the rewrite.
    const meinSweep = tracks.find((t) => t.name === 'Mein Sweep');
    expect(meinSweep).toBeDefined();
    expect(meinSweep!.kind).toBe('fx');
    // Muted state preserved (pulse track was muted in the fixture).
    const pulseTrack = tracks.find((t) => t.id === 'track-pulse');
    expect(pulseTrack!.muted).toBe(true);
    // Clips are untouched.
    expect(result.timeline!.clips).toEqual(v5Fixture.state.timeline.clips);
  });

  it('does NOT append any tracks when migrating v5 → v6 (append-gate works)', () => {
    const state = clone(v5Fixture.state);
    const before = state.timeline!.tracks.length;
    const result = migrate(state, 5) as typeof state;
    expect(result.timeline!.tracks.length).toBe(before);
  });

  it('full v4 → v5 → v6: appends INITIAL_TRACKS_V5 missing entries, then rewrites FX-kinds', () => {
    // Synthetic v4 snapshot: only the image track + a user-renamed Contour.
    // Migration must first append the missing v5 tracks, then rewrite FX-kinds.
    const v4 = {
      timeline: {
        tracks: [
          { id: 'track-image', kind: 'image', name: 'Image', muted: false, order: 0 },
          { id: 'track-contour', kind: 'contour', name: 'My Contour', muted: false, order: 1 }
        ],
        clips: [],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      }
    };
    const result = migrate(clone(v4), 4) as typeof v4;
    const tracks = result.timeline!.tracks;
    // Append-logic added the 8 missing INITIAL_TRACKS_V5 entries
    // (the v4 snapshot had 2; INITIAL_TRACKS_V5 has 10).
    expect(tracks.length).toBe(10);
    // The renamed contour kept its name AND now has kind:'fx'.
    const myContour = tracks.find((t) => t.name === 'My Contour');
    expect(myContour).toBeDefined();
    expect(myContour!.kind).toBe('fx');
    // No track retains a legacy FX-kind.
    for (const t of tracks) {
      expect(FX_KIND_STRINGS.has(t.kind)).toBe(false);
    }
  });

  it('is a no-op on a v6-shape snapshot (image/video/audio/fx tracks only)', () => {
    const v6Shape = {
      timeline: {
        tracks: [
          { id: 'track-image', kind: 'image', name: 'Image', muted: false },
          { id: 'track-video', kind: 'video', name: 'Video', muted: false },
          { id: 'track-audio', kind: 'audio', name: 'Audio', muted: false },
          { id: 'track-fx-1', kind: 'fx', name: 'FX', muted: false }
        ],
        clips: [],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      }
    };
    const result = migrate(clone(v6Shape), 5) as typeof v6Shape;
    expect(result.timeline!.tracks).toHaveLength(4);
    expect(result.timeline!.tracks.map((t) => t.kind)).toEqual([
      'image', 'video', 'audio', 'fx'
    ]);
  });
});
