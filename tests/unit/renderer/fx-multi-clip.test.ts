import { describe, it, expect } from 'vitest';
import { getActiveFxClips } from '@/lib/timeline/selectors';
import type { Clip, Track } from '@/lib/timeline/types';

function clip(over: Partial<Clip>): Clip {
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

function fx(over: Partial<Track>): Track {
  return { id: 'fx-1', kind: 'fx', name: 'FX', muted: false, ...over };
}

describe('getActiveFxClips — Plan 5.9c selector', () => {
  it('returns all active FX clips across multiple FX tracks', () => {
    const tracks = [fx({ id: 'fx-1' }), fx({ id: 'fx-2', name: 'FX 2' })];
    const clips = [
      clip({ id: 'a', trackId: 'fx-1', kind: 'contour' }),
      clip({ id: 'b', trackId: 'fx-2', kind: 'sweep' })
    ];
    const out = getActiveFxClips(tracks, clips, 4);
    expect(out.map((x) => x.clip.id).sort()).toEqual(['a', 'b']);
  });

  it('sorts by RENDER_ORDER_TRACK_KIND (dissolve before text)', () => {
    const tracks = [fx({ id: 'fx-1' })];
    const clips = [
      clip({ id: 'late', trackId: 'fx-1', kind: 'text' }),
      clip({ id: 'early', trackId: 'fx-1', kind: 'dissolve' })
    ];
    const out = getActiveFxClips(tracks, clips, 4);
    expect(out.map((x) => x.clip.id)).toEqual(['early', 'late']);
  });

  it('skips muted FX tracks', () => {
    const tracks = [fx({ id: 'fx-1', muted: true })];
    const clips = [clip({ id: 'a', trackId: 'fx-1', kind: 'contour' })];
    expect(getActiveFxClips(tracks, clips, 4)).toHaveLength(0);
  });

  it('respects the beat window — clip outside range excluded', () => {
    const tracks = [fx({ id: 'fx-1' })];
    const clips = [clip({ id: 'a', trackId: 'fx-1', startBeat: 0, lengthBeats: 4 })];
    expect(getActiveFxClips(tracks, clips, 5)).toHaveLength(0);
  });

  it('two same-kind clips on the same fx track: both returned in array order', () => {
    const tracks = [fx({ id: 'fx-1' })];
    const clips = [
      clip({ id: 'a', trackId: 'fx-1', kind: 'particles', startBeat: 0, lengthBeats: 8 }),
      clip({ id: 'b', trackId: 'fx-1', kind: 'particles', startBeat: 4, lengthBeats: 8 })
    ];
    const out = getActiveFxClips(tracks, clips, 5);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.clip.id)).toEqual(['a', 'b']);
  });

  it('non-fx tracks are ignored entirely (image/video/audio clips never returned)', () => {
    const tracks: Track[] = [
      { id: 't-image', kind: 'image', name: 'Image', muted: false },
      fx({ id: 'fx-1' })
    ];
    const clips = [
      { id: 'i', trackId: 't-image', kind: 'image', startBeat: 0, lengthBeats: 8, label: 'i' },
      clip({ id: 'c', trackId: 'fx-1', kind: 'contour', startBeat: 0, lengthBeats: 8 })
    ] as Clip[];
    const out = getActiveFxClips(tracks, clips, 4);
    expect(out.map((x) => x.clip.id)).toEqual(['c']);
  });
});
