import { describe, it, expect } from 'vitest';
import { canDropOnTrack } from '@/lib/timeline/track-validation';
import type { TrackKind } from '@/lib/timeline/types';
import type { TrackFxKind } from '@/lib/timeline/plugin-mapping';

describe('canDropOnTrack (Plan 5.9a)', () => {
  it('image media → only image track', () => {
    expect(canDropOnTrack('image', 'image')).toBe(true);
    expect(canDropOnTrack('image', 'video')).toBe(false);
    expect(canDropOnTrack('image', 'audio')).toBe(false);
    expect(canDropOnTrack('image', 'pulse')).toBe(false);
  });

  it('video media → only video track', () => {
    expect(canDropOnTrack('video', 'video')).toBe(true);
    expect(canDropOnTrack('video', 'image')).toBe(false);
    expect(canDropOnTrack('video', 'audio')).toBe(false);
    expect(canDropOnTrack('video', 'contour')).toBe(false);
  });

  it('audio media → only audio track', () => {
    expect(canDropOnTrack('audio', 'audio')).toBe(true);
    expect(canDropOnTrack('audio', 'image')).toBe(false);
    expect(canDropOnTrack('audio', 'video')).toBe(false);
    expect(canDropOnTrack('audio', 'sweep')).toBe(false);
  });

  it('FX track kinds always reject media drops', () => {
    // Plan 5.9c transitional: legacy v5 FX-kinds typed via TrackFxKind.
    // Task 5 rewrites this whole test against the new 4-entry TrackKind.
    const fxKinds: TrackFxKind[] = [
      'contour', 'sweep', 'pulse', 'particles', 'zoom-pulse',
      'text', 'dissolve', 'sunray'
    ];
    for (const fx of fxKinds) {
      expect(canDropOnTrack('image', fx)).toBe(false);
      expect(canDropOnTrack('video', fx)).toBe(false);
      expect(canDropOnTrack('audio', fx)).toBe(false);
    }
  });

  it('all 9 combinations of (mediaKind × {image,audio,video}) — matrix sanity', () => {
    const mediaKinds = ['image', 'audio', 'video'] as const;
    for (const m of mediaKinds) {
      for (const t of mediaKinds) {
        expect(canDropOnTrack(m, t)).toBe(m === t);
      }
    }
  });
});
