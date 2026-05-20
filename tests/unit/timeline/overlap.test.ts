import { describe, it, expect } from 'vitest';
import { findIncomingOverlap, overlapRange, isReservedParamKey } from '@/lib/timeline/overlap';
import type { Clip, TimelineState } from '@/lib/timeline/types';

const baseState: TimelineState = {
  tracks: [{ id: 't-pulse', kind: 'pulse', name: 'P', muted: false, order: 0 }],
  clips: [],
  playhead: { beats: 0, playing: false },
  zoom: 1,
  snap: 'beat'
};

const clip = (id: string, trackId: string, startBeat: number, lengthBeats: number): Clip => ({
  id,
  trackId,
  kind: 'pulse',
  fxId: 'pulse',
  startBeat,
  lengthBeats,
  label: id
});

describe('findIncomingOverlap', () => {
  it('returns null when the clip has no preceding neighbor on the same track', () => {
    const state = { ...baseState, clips: [clip('a', 't-pulse', 0, 4)] };
    expect(findIncomingOverlap(state, 'a')).toBeNull();
  });

  it('returns the preceding clip when ranges intersect', () => {
    const state = {
      ...baseState,
      clips: [clip('a', 't-pulse', 0, 8), clip('b', 't-pulse', 6, 8)]
    };
    expect(findIncomingOverlap(state, 'b')?.id).toBe('a');
  });

  it('returns null when ranges are exactly adjacent (half-open)', () => {
    const state = {
      ...baseState,
      clips: [clip('a', 't-pulse', 0, 4), clip('b', 't-pulse', 4, 4)]
    };
    expect(findIncomingOverlap(state, 'b')).toBeNull();
  });

  it('ignores clips on different tracks', () => {
    const state: TimelineState = {
      ...baseState,
      tracks: [
        ...baseState.tracks,
        { id: 't-sweep', kind: 'sweep', name: 'S', muted: false, order: 1 }
      ],
      clips: [clip('a', 't-sweep', 0, 8), clip('b', 't-pulse', 4, 4)]
    };
    expect(findIncomingOverlap(state, 'b')).toBeNull();
  });

  it('picks the closest preceding clip when multiple precede', () => {
    const state = {
      ...baseState,
      clips: [
        clip('a', 't-pulse', 0, 10),
        clip('b', 't-pulse', 2, 6),
        clip('c', 't-pulse', 7, 4)
      ]
    };
    expect(findIncomingOverlap(state, 'c')?.id).toBe('b');
  });

  it('returns null for unknown clipId', () => {
    expect(findIncomingOverlap(baseState, 'nope')).toBeNull();
  });
});

describe('overlapRange', () => {
  it('computes the intersection of two intersecting ranges', () => {
    const a = clip('a', 't-pulse', 0, 8);
    const b = clip('b', 't-pulse', 6, 8);
    expect(overlapRange(a, b)).toEqual([6, 8]);
  });

  it('returns null when ranges do not intersect', () => {
    const a = clip('a', 't-pulse', 0, 4);
    const b = clip('b', 't-pulse', 10, 4);
    expect(overlapRange(a, b)).toBeNull();
  });

  it('returns null for exactly adjacent ranges (half-open)', () => {
    const a = clip('a', 't-pulse', 0, 4);
    const b = clip('b', 't-pulse', 4, 4);
    expect(overlapRange(a, b)).toBeNull();
  });
});

describe('isReservedParamKey', () => {
  it('detects __ prefix', () => {
    expect(isReservedParamKey('__blend')).toBe(true);
    expect(isReservedParamKey('intensity')).toBe(false);
    expect(isReservedParamKey('_private')).toBe(false);
  });
});
