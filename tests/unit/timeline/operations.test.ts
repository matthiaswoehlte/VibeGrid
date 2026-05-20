import { describe, it, expect } from 'vitest';
import {
  OperationError,
  addClip,
  moveClip,
  resizeClip,
  removeClip,
  setClipParams,
  setPlayhead,
  setMuted
} from '@/lib/timeline/operations';
import { freezeState, makeClip, makeState } from './_helpers';

describe('OperationError', () => {
  it('is throwable, identifiable via instanceof, and carries a code', () => {
    const err = new OperationError('CLIP_NOT_FOUND', 'Clip not found');
    expect(err).toBeInstanceOf(OperationError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('CLIP_NOT_FOUND');
    expect(err.message).toBe('Clip not found');
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

  it('allows adding a clip that overlaps an existing clip on the same track', () => {
    const s0 = freezeState(
      makeState({
        clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 8 })]
      })
    );
    const s1 = addClip(
      s0,
      makeClip({ id: 'b', trackId: 't1', kind: 'contour', startBeat: 4, lengthBeats: 4 })
    );
    expect(s1.clips).toHaveLength(2);
    expect(s1.clips.map((c) => c.startBeat)).toEqual([0, 4]);
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

describe('moveClip', () => {
  it('updates startBeat and returns a new state', () => {
    const s0 = freezeState(
      makeState({
        clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 })]
      })
    );
    const s1 = moveClip(s0, 'a', 10);
    expect(s1.clips[0].startBeat).toBe(10);
    expect(s0.clips[0].startBeat).toBe(0);
  });

  it('throws CLIP_NOT_FOUND when clipId is unknown', () => {
    const s0 = freezeState(makeState());
    expect(() => moveClip(s0, 'missing', 0)).toThrow(OperationError);
    try {
      moveClip(s0, 'missing', 0);
    } catch (e) {
      expect((e as OperationError).code).toBe('CLIP_NOT_FOUND');
    }
  });

  it('allows moving a clip within its own footprint (excludes self from overlap)', () => {
    const s0 = freezeState(
      makeState({
        clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 8 })]
      })
    );
    const s1 = moveClip(s0, 'a', 2);
    expect(s1.clips[0].startBeat).toBe(2);
  });

  it('allows moving a clip into an overlap with another clip on the same track', () => {
    const s0 = freezeState(
      makeState({
        clips: [
          makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 }),
          makeClip({ id: 'b', trackId: 't1', kind: 'contour', startBeat: 10, lengthBeats: 4 })
        ]
      })
    );
    const s1 = moveClip(s0, 'a', 8);
    expect(s1.clips.find((c) => c.id === 'a')!.startBeat).toBe(8);
    expect(s1.clips.find((c) => c.id === 'b')!.startBeat).toBe(10);
  });

  it('preserves non-moved clips unchanged', () => {
    const s0 = freezeState(
      makeState({
        clips: [
          makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 }),
          makeClip({ id: 'b', trackId: 't2', kind: 'pulse', startBeat: 0, lengthBeats: 4 })
        ]
      })
    );
    const s1 = moveClip(s0, 'a', 10);
    expect(s1.clips.find((c) => c.id === 'b')).toBe(s0.clips.find((c) => c.id === 'b'));
  });
});

describe('resizeClip', () => {
  it('updates lengthBeats and returns a new state', () => {
    const s0 = freezeState(
      makeState({
        clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 })]
      })
    );
    const s1 = resizeClip(s0, 'a', 8);
    expect(s1.clips[0].lengthBeats).toBe(8);
    expect(s0.clips[0].lengthBeats).toBe(4);
  });

  it('throws INVALID_LENGTH when newLengthBeats <= 0', () => {
    const s0 = freezeState(
      makeState({
        clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 })]
      })
    );
    expect(() => resizeClip(s0, 'a', 0)).toThrow(OperationError);
    expect(() => resizeClip(s0, 'a', -1)).toThrow(OperationError);
  });

  it('throws CLIP_NOT_FOUND when clipId is unknown', () => {
    expect(() => resizeClip(makeState(), 'missing', 4)).toThrow(OperationError);
  });

  it('allows resizing a clip to extend into another clip on the same track', () => {
    const s0 = freezeState(
      makeState({
        clips: [
          makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 }),
          makeClip({ id: 'b', trackId: 't1', kind: 'contour', startBeat: 8, lengthBeats: 4 })
        ]
      })
    );
    const s1 = resizeClip(s0, 'a', 10);
    expect(s1.clips.find((c) => c.id === 'a')!.lengthBeats).toBe(10);
  });
});

describe('removeClip', () => {
  it('returns a new state without the named clip', () => {
    const s0 = freezeState(
      makeState({
        clips: [
          makeClip({ id: 'a', trackId: 't1', kind: 'contour' }),
          makeClip({ id: 'b', trackId: 't2', kind: 'pulse' })
        ]
      })
    );
    const s1 = removeClip(s0, 'a');
    expect(s1.clips.map((c) => c.id)).toEqual(['b']);
    expect(s0.clips).toHaveLength(2);
  });

  it('throws CLIP_NOT_FOUND when clipId is unknown', () => {
    expect(() => removeClip(makeState(), 'x')).toThrow(OperationError);
  });
});

describe('setClipParams', () => {
  it('shallow-merges params and returns a new state', () => {
    const s0 = freezeState(
      makeState({
        clips: [
          makeClip({
            id: 'a',
            trackId: 't1',
            kind: 'contour',
            params: { threshold: 0.5, color: '#fff' }
          })
        ]
      })
    );
    const s1 = setClipParams(s0, 'a', { threshold: 0.8 });
    expect(s1.clips[0].params).toEqual({ threshold: 0.8, color: '#fff' });
    expect(s0.clips[0].params).toEqual({ threshold: 0.5, color: '#fff' });
  });

  it('initializes params if previously undefined', () => {
    const s0 = freezeState(
      makeState({
        clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour' })]
      })
    );
    const s1 = setClipParams(s0, 'a', { x: 1 });
    expect(s1.clips[0].params).toEqual({ x: 1 });
  });

  it('throws CLIP_NOT_FOUND when clipId is unknown', () => {
    expect(() => setClipParams(makeState(), 'x', {})).toThrow(OperationError);
  });
});

describe('setPlayhead', () => {
  it('updates beats while preserving the playing flag', () => {
    const s0 = freezeState(makeState({ playhead: { beats: 0, playing: true } }));
    const s1 = setPlayhead(s0, 12);
    expect(s1.playhead).toEqual({ beats: 12, playing: true });
    expect(s0.playhead.beats).toBe(0);
  });

  it('clamps negative beats to 0', () => {
    const s0 = freezeState(makeState());
    const s1 = setPlayhead(s0, -5);
    expect(s1.playhead.beats).toBe(0);
  });
});

describe('setMuted', () => {
  it('toggles the muted flag on the named track', () => {
    const s0 = freezeState(
      makeState({
        tracks: [{ id: 't1', kind: 'contour', name: 'c', muted: false, order: 0 }]
      })
    );
    const s1 = setMuted(s0, 't1', true);
    expect(s1.tracks[0].muted).toBe(true);
    expect(s0.tracks[0].muted).toBe(false);
  });

  it('throws TRACK_NOT_FOUND when trackId is unknown', () => {
    expect(() => setMuted(makeState(), 'x', true)).toThrow(OperationError);
  });
});
