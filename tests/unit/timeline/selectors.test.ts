import { describe, it, expect } from 'vitest';
import { snapBeats, hasOverlap } from '@/lib/timeline/selectors';
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
