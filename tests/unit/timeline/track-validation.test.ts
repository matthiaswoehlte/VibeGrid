import { describe, it, expect } from 'vitest';
import { canDropOnTrack } from '@/lib/timeline/track-validation';

describe('canDropOnTrack (Plan 5.9c)', () => {
  it('contour clip → fx track: true', () => {
    expect(canDropOnTrack('contour', 'fx')).toBe(true);
  });

  it('zoom-pulse clip (hyphenated lowercase) → fx track: true', () => {
    expect(canDropOnTrack('zoom-pulse', 'fx')).toBe(true);
  });

  it('image clip → fx track: false', () => {
    expect(canDropOnTrack('image', 'fx')).toBe(false);
  });

  it('contour clip → image track: false', () => {
    expect(canDropOnTrack('contour', 'image')).toBe(false);
  });

  it('video clip → video track: true', () => {
    expect(canDropOnTrack('video', 'video')).toBe(true);
  });

  it('audio clip → audio track: true', () => {
    expect(canDropOnTrack('audio', 'audio')).toBe(true);
  });

  it('all 8 FX kinds are valid on an fx track', () => {
    const fxKinds = [
      'contour', 'sweep', 'pulse', 'particles', 'zoom-pulse',
      'text', 'dissolve', 'sunray'
    ];
    for (const k of fxKinds) {
      expect(canDropOnTrack(k, 'fx')).toBe(true);
    }
  });

  it('unknown clip kind on an fx track: false', () => {
    expect(canDropOnTrack('bogus-effect', 'fx')).toBe(false);
  });

  it('media kinds across mismatched media tracks all reject', () => {
    const media = ['image', 'video', 'audio'] as const;
    for (const m of media) {
      for (const t of media) {
        expect(canDropOnTrack(m, t)).toBe(m === t);
      }
    }
  });

  // Plan 8d — singleton TrackKinds accept their corresponding media-kind.
  describe('Plan 8d singleton TrackKinds', () => {
    it('audio clip → sync-audio track: true', () => {
      expect(canDropOnTrack('audio', 'sync-audio')).toBe(true);
    });

    it('video clip → main-video track: true', () => {
      expect(canDropOnTrack('video', 'main-video')).toBe(true);
    });

    it('audio clip → main-video track: false (kind mismatch)', () => {
      expect(canDropOnTrack('audio', 'main-video')).toBe(false);
    });

    it('video clip → sync-audio track: false (kind mismatch)', () => {
      expect(canDropOnTrack('video', 'sync-audio')).toBe(false);
    });

    it('FX clip → singleton tracks: false', () => {
      expect(canDropOnTrack('contour', 'sync-audio')).toBe(false);
      expect(canDropOnTrack('contour', 'main-video')).toBe(false);
    });
  });
});
