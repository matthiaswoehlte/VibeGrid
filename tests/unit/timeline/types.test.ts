import { describe, it, expect } from 'vitest';
import { makeState } from './_helpers';

describe('TimelineState default shape', () => {
  it('produces a valid empty timeline with snap=beat and zoom=1', () => {
    const s = makeState();
    expect(s.tracks).toEqual([]);
    expect(s.clips).toEqual([]);
    expect(s.playhead).toEqual({ beats: 0, playing: false });
    expect(s.zoom).toBe(1);
    expect(s.snap).toBe('beat');
  });
});
