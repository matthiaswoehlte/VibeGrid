import { describe, it, expect } from 'vitest';
import { computeClipAlpha } from '@/lib/renderer/blend';
import { makeDefaultBlend, BLEND_KEY } from '@/lib/timeline/blend';
import type { Clip, TimelineState } from '@/lib/timeline/types';

const mkClip = (
  id: string,
  start: number,
  length: number,
  params?: Record<string, unknown>
): Clip => ({
  id,
  trackId: 't-pulse',
  kind: 'pulse',
  fxId: 'pulse',
  startBeat: start,
  lengthBeats: length,
  label: id,
  params
});

const baseState = (clips: Clip[]): TimelineState => ({
  tracks: [{ id: 't-pulse', kind: 'pulse', name: 'P', muted: false, order: 0 }],
  clips,
  playhead: { beats: 0, playing: false },
  zoom: 1,
  snap: 'beat'
});

describe('computeClipAlpha', () => {
  it('returns 1 when no overlap touches the clip at this beat', () => {
    const a = mkClip('a', 0, 4);
    const b = mkClip('b', 10, 4);
    const state = baseState([a, b]);
    expect(computeClipAlpha(state, b, 11)).toBe(1);
  });

  it('returns the __blend value during the incoming overlap', () => {
    const a = mkClip('a', 0, 8);
    const b = mkClip('b', 6, 8, { [BLEND_KEY]: makeDefaultBlend(6, 8, 'linear') });
    const state = baseState([a, b]);
    expect(computeClipAlpha(state, b, 7)).toBeCloseTo(0.5, 5);
  });

  it('returns 1 - next.__blend during the outgoing overlap (predecessor side)', () => {
    const a = mkClip('a', 0, 8);
    const b = mkClip('b', 6, 8, { [BLEND_KEY]: makeDefaultBlend(6, 8, 'linear') });
    const state = baseState([a, b]);
    expect(computeClipAlpha(state, a, 7)).toBeCloseTo(0.5, 5);
  });

  it('multiplies incoming and outgoing alphas for a 3-clip chain middle', () => {
    const a = mkClip('a', 0, 8);
    const b = mkClip('b', 6, 6, { [BLEND_KEY]: makeDefaultBlend(6, 8, 'linear') });
    const c = mkClip('c', 10, 6, { [BLEND_KEY]: makeDefaultBlend(10, 12, 'linear') });
    const state = baseState([a, b, c]);
    // At beat 7: b in incoming overlap with a (b.blend = 0.5). c not active yet.
    expect(computeClipAlpha(state, b, 7)).toBeCloseTo(0.5, 5);
    // At beat 11: b in outgoing overlap with c (c.blend at 11 = 0.5). b alpha = 0.5.
    expect(computeClipAlpha(state, b, 11)).toBeCloseTo(0.5, 5);
  });
});
