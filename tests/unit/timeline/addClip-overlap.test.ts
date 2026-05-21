import { describe, it, expect } from 'vitest';
import { addClip, moveClip } from '@/lib/timeline/operations';
import type { Clip, TimelineState } from '@/lib/timeline/types';

/**
 * Plan 5.9c — lock-in tests for overlap behaviour after the FX-track
 * consolidation. Plan 5.6 removed the `hasOverlap` rejection from
 * `addClip`/`moveClip`/`resizeClip`; clips can overlap on any track
 * regardless of kind, and the renderer's `__blend` lifecycle handles
 * same-kind crossfades. This file verifies the behaviour holds for
 * the new `'fx'` track kind too — multiple FX clips of mixed kinds
 * can coexist on one lane.
 */

function emptyFxState(): TimelineState {
  return {
    tracks: [{ id: 'fx-1', kind: 'fx', name: 'FX', muted: false }],
    clips: [],
    playhead: { beats: 0, playing: false },
    zoom: 1,
    snap: 'beat'
  };
}

function fxClip(over: Partial<Clip>): Clip {
  return {
    id: 'x',
    trackId: 'fx-1',
    kind: 'contour',
    startBeat: 0,
    lengthBeats: 8,
    label: 'x',
    ...over
  };
}

describe('addClip overlap behaviour on fx tracks (Plan 5.9c)', () => {
  it('two overlapping same-kind FX clips both stay (crossfade via __blend)', () => {
    let state = emptyFxState();
    state = addClip(state, fxClip({ id: 'a', kind: 'contour', startBeat: 0, lengthBeats: 8 }));
    state = addClip(state, fxClip({ id: 'b', kind: 'contour', startBeat: 4, lengthBeats: 8 }));
    expect(state.clips.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('two overlapping DIFFERENT-kind FX clips both stay (no crossfade)', () => {
    let state = emptyFxState();
    state = addClip(state, fxClip({ id: 'a', kind: 'contour', startBeat: 0, lengthBeats: 8 }));
    state = addClip(state, fxClip({ id: 'b', kind: 'sweep', startBeat: 4, lengthBeats: 8 }));
    expect(state.clips.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('moveClip onto a position where it would overlap another clip succeeds', () => {
    let state = emptyFxState();
    state = addClip(state, fxClip({ id: 'a', kind: 'contour', startBeat: 0, lengthBeats: 8 }));
    state = addClip(state, fxClip({ id: 'b', kind: 'particles', startBeat: 16, lengthBeats: 8 }));
    state = moveClip(state, 'b', 4);
    expect(state.clips.find((c) => c.id === 'b')!.startBeat).toBe(4);
  });

  it('three FX clips of three different kinds, all overlapping at beat 5', () => {
    let state = emptyFxState();
    state = addClip(state, fxClip({ id: 'a', kind: 'contour', startBeat: 0, lengthBeats: 8 }));
    state = addClip(state, fxClip({ id: 'b', kind: 'sweep', startBeat: 2, lengthBeats: 8 }));
    state = addClip(state, fxClip({ id: 'c', kind: 'particles', startBeat: 4, lengthBeats: 8 }));
    expect(state.clips).toHaveLength(3);
  });
});
