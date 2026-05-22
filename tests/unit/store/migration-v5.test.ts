import { describe, it, expect } from 'vitest';
import { INITIAL_TRACKS_V5 } from '@/lib/store/timeline-slice';

/**
 * v4-shape Track — `kind` is a plain string because v4 snapshots
 * predate Plan 5.9c's TrackKind narrowing. Migration tests work in
 * this loose shape so they can keep simulating real legacy data.
 */
interface LooseTrack {
  id: string;
  kind: string;
  name: string;
  muted: boolean;
  order?: number;
}

/**
 * Plan-5.9a Task 2 — verify the v4 → v5 migration adds the new video
 * track without dropping any v4 user state.
 *
 * Plan 5.9c migration note: the migration target switched from
 * `initialTimelineState.tracks` (now 4 lanes after FX consolidation)
 * to the frozen `INITIAL_TRACKS_V5` constant (the v4-era 10-lane
 * default). The test continues to verify the v4 → v5 behaviour;
 * the v5 → v6 FX-kind rewrite is covered separately in
 * `migration-v5-v6.test.ts`.
 */
function migrateV4ToV5(persisted: { timeline: { tracks: LooseTrack[]; clips: unknown[] } }) {
  const existing = [...persisted.timeline.tracks];
  existing.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const existingKinds = new Set<string>(existing.map((t) => t.kind));
  const missing = INITIAL_TRACKS_V5.filter(
    (t) => !existingKinds.has(t.kind)
  );
  return {
    ...persisted,
    timeline: {
      ...persisted.timeline,
      tracks: [...existing, ...missing]
    }
  };
}

/** Realistic v4 snapshot — what a user would have after Plan 5.8a. */
const v4Snapshot = {
  timeline: {
    tracks: [
      { id: 'track-image', kind: 'image', name: 'Image', muted: false, order: 0 },
      { id: 'track-contour', kind: 'contour', name: 'Contour', muted: false, order: 1 },
      { id: 'track-zoom-pulse', kind: 'zoom-pulse', name: 'Zoom Pulse', muted: false, order: 2 },
      { id: 'track-sweep', kind: 'sweep', name: 'Sweep', muted: false, order: 3 },
      { id: 'track-particles', kind: 'particles', name: 'Particles', muted: false, order: 4 },
      { id: 'track-pulse', kind: 'pulse', name: 'Pulse', muted: false, order: 5 },
      { id: 'track-dissolve', kind: 'dissolve', name: 'Dissolve', muted: false, order: 6 },
      { id: 'track-sunray', kind: 'sunray', name: 'Sunray', muted: false, order: 7 },
      { id: 'track-text', kind: 'text', name: 'Text', muted: false, order: 8 }
    ] as LooseTrack[],
    clips: [
      { id: 'clip-a', trackId: 'track-image', kind: 'image', startBeat: 0, lengthBeats: 16 },
      { id: 'clip-b', trackId: 'track-pulse', kind: 'pulse', startBeat: 4, lengthBeats: 4 }
    ]
  }
};

describe('Store migration v4 → v5 (Plan 5.9a)', () => {
  it('adds the new video track to a v4 snapshot', () => {
    const migrated = migrateV4ToV5(v4Snapshot);
    const kinds = migrated.timeline.tracks.map((t) => t.kind);
    expect(kinds).toContain('video');
  });

  it('does NOT add an audio track by default (audio is a v0.2 stub)', () => {
    const migrated = migrateV4ToV5(v4Snapshot);
    const kinds = migrated.timeline.tracks.map((t) => t.kind);
    expect(kinds).not.toContain('audio');
  });

  it('preserves the legacy ordering of pre-existing tracks via their .order field', () => {
    // Shuffle the v4 tracks so they're not already in order — migration
    // must still produce the order 0..8 sequence at the top of the array.
    const shuffled = {
      timeline: {
        tracks: [...v4Snapshot.timeline.tracks].reverse() as LooseTrack[],
        clips: v4Snapshot.timeline.clips
      }
    };
    const migrated = migrateV4ToV5(shuffled);
    const firstNine = migrated.timeline.tracks.slice(0, 9).map((t) => t.kind);
    expect(firstNine).toEqual([
      'image', 'contour', 'zoom-pulse', 'sweep', 'particles',
      'pulse', 'dissolve', 'sunray', 'text'
    ]);
  });

  it('new tracks (video) are appended at the END — array index = render order', () => {
    const migrated = migrateV4ToV5(v4Snapshot);
    expect(migrated.timeline.tracks[migrated.timeline.tracks.length - 1].kind).toBe(
      'video'
    );
  });

  it('preserves all clips through the migration', () => {
    const migrated = migrateV4ToV5(v4Snapshot);
    expect(migrated.timeline.clips).toEqual(v4Snapshot.timeline.clips);
  });

  it('idempotent: running on a v5 snapshot is a no-op for track count', () => {
    const v5Snapshot = {
      timeline: {
        tracks: [...INITIAL_TRACKS_V5] as LooseTrack[],
        clips: []
      }
    };
    const migrated = migrateV4ToV5(v5Snapshot);
    expect(migrated.timeline.tracks.length).toBe(INITIAL_TRACKS_V5.length);
  });
});
