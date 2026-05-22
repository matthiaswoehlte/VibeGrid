import { describe, it, expect } from 'vitest';
import {
  snapBeats,
  hasOverlap,
  activeClipsAt,
  activeImageClip,
  activeFxClipsByKind,
  activeClipOnTrack,
  totalBeats,
  beatsToTimecode
} from '@/lib/timeline/selectors';
import type { Clip } from '@/lib/timeline/types';
import { makeClip, makeState } from './_helpers';

describe('snapBeats', () => {
  it('rounds to nearest beat when mode=beat', () => {
    expect(snapBeats(2.3, 'beat')).toBe(2);
    expect(snapBeats(2.5, 'beat')).toBe(3);
    expect(snapBeats(2.7, 'beat')).toBe(3);
  });

  it('rounds to nearest half-beat when mode=half', () => {
    expect(snapBeats(2.3, 'half')).toBe(2.5);
    expect(snapBeats(2.2, 'half')).toBe(2);
    expect(snapBeats(2.74, 'half')).toBe(2.5);
    expect(snapBeats(2.76, 'half')).toBe(3);
  });

  it('rounds to nearest quarter-beat when mode=quarter', () => {
    expect(snapBeats(2.3, 'quarter')).toBe(2.25);
    expect(snapBeats(2.4, 'quarter')).toBe(2.5);
  });

  it('returns input unchanged when mode=off', () => {
    expect(snapBeats(2.37, 'off')).toBe(2.37);
    expect(snapBeats(-1.5, 'off')).toBe(-1.5);
  });

  it('handles negative beats (clip dragged before timeline origin)', () => {
    expect(snapBeats(-0.3, 'beat')).toBe(-0);
    expect(snapBeats(-0.7, 'beat')).toBe(-1);
  });

  it('returns exact value when input is already on grid', () => {
    expect(snapBeats(4, 'beat')).toBe(4);
    expect(snapBeats(4.5, 'half')).toBe(4.5);
    expect(snapBeats(4.25, 'quarter')).toBe(4.25);
  });
});

describe('hasOverlap', () => {
  it('returns false on empty timeline', () => {
    const s = makeState();
    expect(hasOverlap(s, 't1', 0, 4)).toBe(false);
  });

  it('returns true when proposed interval intersects an existing clip on same track', () => {
    const s = makeState({
      clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 8 })]
    });
    expect(hasOverlap(s, 't1', 4, 4)).toBe(true);
  });

  it('returns false when proposed interval is on a different track', () => {
    const s = makeState({
      clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 8 })]
    });
    expect(hasOverlap(s, 't2', 0, 8)).toBe(false);
  });

  it('treats end-to-start touch as non-overlap (half-open intervals)', () => {
    const s = makeState({
      clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 })]
    });
    expect(hasOverlap(s, 't1', 4, 4)).toBe(false);
    expect(hasOverlap(s, 't1', -4, 4)).toBe(false);
  });

  it('excludes a given clipId from the overlap check (used by moveClip/resizeClip)', () => {
    const s = makeState({
      clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 8 })]
    });
    expect(hasOverlap(s, 't1', 2, 4, 'a')).toBe(false);
  });

  it('detects overlap when proposed clip is fully contained inside existing one', () => {
    const s = makeState({
      clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 16 })]
    });
    expect(hasOverlap(s, 't1', 4, 4)).toBe(true);
  });

  it('detects overlap when proposed clip fully contains existing one', () => {
    const s = makeState({
      clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 4, lengthBeats: 4 })]
    });
    expect(hasOverlap(s, 't1', 0, 16)).toBe(true);
  });
});

describe('activeClipsAt', () => {
  it('returns empty array on empty timeline', () => {
    expect(activeClipsAt(makeState(), 0)).toEqual([]);
  });

  it('includes clips whose half-open interval contains the playhead', () => {
    const s = makeState({
      clips: [
        makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 }),
        makeClip({ id: 'b', trackId: 't2', kind: 'sweep', startBeat: 4, lengthBeats: 4 })
      ]
    });
    expect(activeClipsAt(s, 2).map((c) => c.id)).toEqual(['a']);
    expect(activeClipsAt(s, 4).map((c) => c.id)).toEqual(['b']);
    expect(activeClipsAt(s, 7.99).map((c) => c.id)).toEqual(['b']);
    expect(activeClipsAt(s, 8).map((c) => c.id)).toEqual([]);
  });

  it('does not filter by track mute (caller is responsible)', () => {
    const s = makeState({
      tracks: [{ id: 't1', kind: 'fx', name: 'c', muted: true, order: 0 }],
      clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 })]
    });
    expect(activeClipsAt(s, 2)).toHaveLength(1);
  });
});

describe('activeImageClip', () => {
  it('returns null when no image clip is active', () => {
    expect(activeImageClip(makeState(), 0)).toBeNull();
  });

  it('returns the single active image clip when one exists', () => {
    const s = makeState({
      clips: [
        makeClip({ id: 'img', trackId: 't0', kind: 'image', startBeat: 0, lengthBeats: 100 }),
        makeClip({ id: 'fx', trackId: 't1', kind: 'pulse', startBeat: 0, lengthBeats: 4 })
      ]
    });
    expect(activeImageClip(s, 10)?.id).toBe('img');
  });

  it('returns the FIRST active image clip if multiple overlap (invariant guarded by addClip)', () => {
    const s = makeState({
      clips: [
        makeClip({ id: 'img1', trackId: 't0', kind: 'image', startBeat: 0, lengthBeats: 100 }),
        makeClip({ id: 'img2', trackId: 't1', kind: 'image', startBeat: 50, lengthBeats: 100 })
      ]
    });
    expect(activeImageClip(s, 75)?.id).toBe('img1');
  });
});

describe('activeFxClipsByKind', () => {
  it('groups active non-image clips by kind', () => {
    const s = makeState({
      clips: [
        makeClip({ id: 'img', trackId: 't0', kind: 'image', startBeat: 0, lengthBeats: 100 }),
        makeClip({ id: 'c1', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 8 }),
        makeClip({ id: 'c2', trackId: 't1', kind: 'contour', startBeat: 8, lengthBeats: 8 }),
        makeClip({ id: 'p1', trackId: 't2', kind: 'pulse', startBeat: 0, lengthBeats: 16 })
      ]
    });
    const r = activeFxClipsByKind(s, 4);
    expect(r.contour.map((c) => c.id)).toEqual(['c1']);
    expect(r.pulse.map((c) => c.id)).toEqual(['p1']);
    expect(r.sweep).toEqual([]);
    expect(r.particles).toEqual([]);
  });

  it('excludes image clips from the grouping', () => {
    const s = makeState({
      clips: [makeClip({ id: 'img', trackId: 't0', kind: 'image', startBeat: 0, lengthBeats: 4 })]
    });
    const r = activeFxClipsByKind(s, 2);
    expect(r.contour).toEqual([]);
    expect(r.sweep).toEqual([]);
    expect(r.pulse).toEqual([]);
    expect(r.particles).toEqual([]);
  });
});

describe('totalBeats', () => {
  it('returns 0 on empty timeline', () => {
    expect(totalBeats(makeState())).toBe(0);
  });

  it('returns max(startBeat + lengthBeats) across all clips', () => {
    const s = makeState({
      clips: [
        makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 16 }),
        makeClip({ id: 'b', trackId: 't1', kind: 'contour', startBeat: 20, lengthBeats: 4 }),
        makeClip({ id: 'c', trackId: 't2', kind: 'pulse', startBeat: 8, lengthBeats: 8 })
      ]
    });
    expect(totalBeats(s)).toBe(24);
  });
});

describe('beatsToTimecode', () => {
  it('formats whole minutes at 120 BPM', () => {
    expect(beatsToTimecode(480, 120)).toBe('4:00');
  });

  it('formats sub-minute durations', () => {
    expect(beatsToTimecode(0, 120)).toBe('0:00');
    expect(beatsToTimecode(60, 120)).toBe('0:30');
    expect(beatsToTimecode(119, 120)).toBe('0:59');
  });

  it('formats h:mm:ss for durations >= 1 hour', () => {
    expect(beatsToTimecode(7200, 120)).toBe('1:00:00');
    expect(beatsToTimecode(7320, 120)).toBe('1:01:00');
  });

  it('clamps negative input to 0:00', () => {
    expect(beatsToTimecode(-5, 120)).toBe('0:00');
  });

  it('handles non-default BPMs', () => {
    expect(beatsToTimecode(60, 60)).toBe('1:00');
  });
});

describe('activeClipOnTrack (Plan 5.9a)', () => {
  const clips: Clip[] = [
    { id: 'a', trackId: 't-image-1', kind: 'image', startBeat: 0, lengthBeats: 8, label: 'A' },
    { id: 'b', trackId: 't-image-2', kind: 'image', startBeat: 4, lengthBeats: 4, label: 'B' },
    { id: 'c', trackId: 't-pulse', kind: 'pulse', fxId: 'pulse', startBeat: 2, lengthBeats: 2, label: 'C' }
  ];

  it('returns the active clip on the given track', () => {
    expect(activeClipOnTrack('t-image-1', clips, 5)?.id).toBe('a');
    expect(activeClipOnTrack('t-image-2', clips, 5)?.id).toBe('b');
  });

  it('returns undefined when no clip is active on the track at the beat', () => {
    expect(activeClipOnTrack('t-image-1', clips, 10)).toBeUndefined();
    expect(activeClipOnTrack('t-image-2', clips, 0)).toBeUndefined();
  });

  it('ignores clips that belong to other tracks even if the beat matches', () => {
    expect(activeClipOnTrack('t-pulse', clips, 5)).toBeUndefined();
    expect(activeClipOnTrack('t-pulse', clips, 3)?.id).toBe('c');
  });

  it('uses half-open interval [startBeat, startBeat+lengthBeats)', () => {
    // A spans [0, 8) → beat 8 is NOT active anymore.
    expect(activeClipOnTrack('t-image-1', clips, 7.999)?.id).toBe('a');
    expect(activeClipOnTrack('t-image-1', clips, 8)).toBeUndefined();
  });

  it('returns undefined for an unknown trackId (no throw)', () => {
    expect(activeClipOnTrack('nope', clips, 5)).toBeUndefined();
  });
});
