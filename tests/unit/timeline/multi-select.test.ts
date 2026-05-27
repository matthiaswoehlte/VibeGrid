import { describe, it, expect } from 'vitest';
import {
  clipsInRubberband,
  computeCtrlDOffset,
  filterMovableSelection,
  normalizeRect,
  type Rect,
  type TrackBand
} from '@/lib/timeline/multi-select';
import type { Clip, Track } from '@/lib/timeline/types';

function clip(
  id: string,
  trackId: string,
  startBeat: number,
  lengthBeats: number
): Clip {
  return {
    id,
    trackId,
    kind: 'pulse',
    fxId: 'pulse',
    startBeat,
    lengthBeats,
    label: id
  };
}

const TRACKS: Track[] = [
  { id: 't1', kind: 'fx', name: 'A', muted: false },
  { id: 't2', kind: 'fx', name: 'B', muted: false }
];

const BANDS: TrackBand[] = [
  { trackId: 't1', top: 0, height: 40 },
  { trackId: 't2', top: 40, height: 40 }
];

// pixelsPerBeat = 40, scrollLeft = 0 → 1 beat = 40 px.

describe('normalizeRect', () => {
  it('returns ordered coords regardless of drag direction', () => {
    const r: Rect = { x1: 100, y1: 50, x2: 20, y2: 10 };
    expect(normalizeRect(r)).toEqual({ x1: 20, y1: 10, x2: 100, y2: 50 });
  });
});

describe('clipsInRubberband', () => {
  it('includes clip fully inside the rect', () => {
    const clips = [clip('c1', 't1', 2, 2)]; // pixels 80..160, track t1 (y 0..40)
    const rect: Rect = { x1: 50, y1: 0, x2: 200, y2: 40 };
    expect(clipsInRubberband(rect, clips, BANDS, 40, 0)).toEqual(['c1']);
  });

  it('includes clip with partial overlap (clip extends past rect on the right)', () => {
    const clips = [clip('c1', 't1', 2, 4)]; // pixels 80..240
    const rect: Rect = { x1: 50, y1: 0, x2: 100, y2: 40 };
    expect(clipsInRubberband(rect, clips, BANDS, 40, 0)).toEqual(['c1']);
  });

  it('excludes clip fully outside the rect', () => {
    const clips = [clip('c1', 't1', 5, 1)]; // pixels 200..240
    const rect: Rect = { x1: 0, y1: 0, x2: 100, y2: 40 };
    expect(clipsInRubberband(rect, clips, BANDS, 40, 0)).toEqual([]);
  });

  it('selects clips across multiple tracks when rect spans them', () => {
    const clips = [clip('a', 't1', 1, 2), clip('b', 't2', 1, 2)];
    const rect: Rect = { x1: 30, y1: 10, x2: 130, y2: 60 };
    const ids = clipsInRubberband(rect, clips, BANDS, 40, 0);
    expect(ids).toEqual(['a', 'b']);
  });

  it('does not hit clips on a track outside the rect Y-range', () => {
    const clips = [clip('a', 't1', 1, 2), clip('b', 't2', 1, 2)];
    const rect: Rect = { x1: 0, y1: 50, x2: 200, y2: 80 }; // t2 only
    expect(clipsInRubberband(rect, clips, BANDS, 40, 0)).toEqual(['b']);
  });

  it('respects scrollLeft offset', () => {
    const clips = [clip('c1', 't1', 5, 1)]; // pixels 200..240 before scroll
    // With scrollLeft=100, clip moves to 100..140 in container coords.
    const rect: Rect = { x1: 90, y1: 0, x2: 130, y2: 40 };
    expect(clipsInRubberband(rect, clips, BANDS, 40, 100)).toEqual(['c1']);
  });

  it('handles inverted drag direction via normalizeRect', () => {
    const clips = [clip('c1', 't1', 2, 2)];
    const rect: Rect = { x1: 200, y1: 40, x2: 50, y2: 0 };
    expect(clipsInRubberband(rect, clips, BANDS, 40, 0)).toEqual(['c1']);
  });

  it('returns empty array for empty clip list', () => {
    const rect: Rect = { x1: 0, y1: 0, x2: 100, y2: 40 };
    expect(clipsInRubberband(rect, [], BANDS, 40, 0)).toEqual([]);
  });
});

describe('computeCtrlDOffset', () => {
  it('returns 0 for empty selection', () => {
    expect(computeCtrlDOffset([], [])).toBe(0);
  });

  it('returns "rightmost - leftmost" of selected clips (architect D2)', () => {
    // A(0-4), B(5-8), C(6-10). Offset = 10 - 0 = 10.
    const clips = [
      clip('a', 't1', 0, 4),
      clip('b', 't1', 5, 3),
      clip('c', 't2', 6, 4)
    ];
    expect(computeCtrlDOffset(['a', 'b', 'c'], clips)).toBe(10);
  });

  it('ignores non-selected clips', () => {
    const clips = [
      clip('a', 't1', 0, 4),
      clip('b', 't1', 100, 4) // not selected
    ];
    expect(computeCtrlDOffset(['a'], clips)).toBe(4);
  });

  it('returns 0 when selected ids do not match any clip', () => {
    const clips = [clip('a', 't1', 0, 4)];
    expect(computeCtrlDOffset(['nonexistent'], clips)).toBe(0);
  });
});

describe('filterMovableSelection', () => {
  it('separates clips that would go below startBeat 0', () => {
    const clips = [
      clip('a', 't1', 0, 4), // would go to -2 → blocked
      clip('b', 't1', 5, 4)  // would go to 3 → movable
    ];
    const { movable, blocked } = filterMovableSelection(['a', 'b'], clips, -2);
    expect(movable).toEqual(['b']);
    expect(blocked).toEqual(['a']);
  });

  it('all clips movable when delta is positive', () => {
    const clips = [clip('a', 't1', 0, 4), clip('b', 't1', 5, 4)];
    const { movable, blocked } = filterMovableSelection(['a', 'b'], clips, 4);
    expect(movable).toEqual(['a', 'b']);
    expect(blocked).toEqual([]);
  });

  it('clips not in the selection are ignored', () => {
    const clips = [clip('a', 't1', 0, 4), clip('b', 't1', 5, 4)];
    const { movable, blocked } = filterMovableSelection(['a'], clips, 4);
    expect(movable).toEqual(['a']);
    expect(blocked).toEqual([]);
  });
});
