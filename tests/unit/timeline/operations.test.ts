import { describe, it, expect } from 'vitest';
import { OperationError, addClip } from '@/lib/timeline/operations';
import { freezeState, makeClip, makeState } from './_helpers';

describe('OperationError', () => {
  it('is throwable, identifiable via instanceof, and carries a code', () => {
    const err = new OperationError('OVERLAP', 'Clip overlaps existing clip');
    expect(err).toBeInstanceOf(OperationError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('OVERLAP');
    expect(err.message).toBe('Clip overlaps existing clip');
    expect(err.name).toBe('OperationError');
  });
});

describe('addClip', () => {
  it('appends the clip to a fresh state and returns a new state object', () => {
    const s0 = freezeState(makeState());
    const clip = makeClip({ id: 'a', trackId: 't1', kind: 'contour' });
    const s1 = addClip(s0, clip);
    expect(s1).not.toBe(s0);
    expect(s1.clips).toHaveLength(1);
    expect(s1.clips[0]).toEqual(clip);
    expect(s0.clips).toHaveLength(0);
  });

  it('preserves other state fields unchanged (referential equality)', () => {
    const s0 = freezeState(
      makeState({ tracks: [{ id: 't1', kind: 'contour', name: 'c', muted: false, order: 0 }] })
    );
    const s1 = addClip(s0, makeClip({ id: 'a', trackId: 't1', kind: 'contour' }));
    expect(s1.tracks).toBe(s0.tracks);
    expect(s1.playhead).toBe(s0.playhead);
  });

  it('throws OperationError(OVERLAP) when proposed clip intersects existing on same track', () => {
    const s0 = freezeState(
      makeState({
        clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 8 })]
      })
    );
    expect(() =>
      addClip(s0, makeClip({ id: 'b', trackId: 't1', kind: 'contour', startBeat: 4, lengthBeats: 4 }))
    ).toThrow(OperationError);
  });

  it('does NOT throw when proposed clip is on a different track', () => {
    const s0 = freezeState(
      makeState({
        clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 8 })]
      })
    );
    expect(() =>
      addClip(s0, makeClip({ id: 'b', trackId: 't2', kind: 'pulse', startBeat: 0, lengthBeats: 8 }))
    ).not.toThrow();
  });
});
