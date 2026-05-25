import { describe, it, expect } from 'vitest';
import { sortedTracks } from '@/lib/timeline/selectors';
import type { Track } from '@/lib/timeline/types';

function t(id: string, kind: Track['kind']): Track {
  return { id, kind, name: id, muted: false };
}

describe('sortedTracks — Plan 8d top-pinning', () => {
  it('sync-audio first, then main-video, then everything else in original order', () => {
    const input: Track[] = [
      t('fx-1', 'fx'),
      t('video-1', 'video'),
      t('main', 'main-video'),
      t('audio-1', 'audio'),
      t('sync', 'sync-audio'),
      t('image-1', 'image')
    ];
    const out = sortedTracks(input);
    expect(out.map((x) => x.id)).toEqual([
      'sync',
      'main',
      'fx-1',
      'video-1',
      'audio-1',
      'image-1'
    ]);
  });

  it('rest tracks preserve their original array order', () => {
    const input: Track[] = [
      t('a', 'image'),
      t('b', 'video'),
      t('c', 'audio'),
      t('d', 'fx'),
      t('e', 'image')
    ];
    expect(sortedTracks(input).map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e'
    ]);
  });

  it('returns array unchanged when no sync-audio/main-video present', () => {
    const input: Track[] = [t('a', 'image'), t('b', 'fx')];
    expect(sortedTracks(input)).toEqual(input);
  });

  it('handles only main-video present (no sync-audio)', () => {
    const input: Track[] = [t('fx', 'fx'), t('m', 'main-video'), t('i', 'image')];
    expect(sortedTracks(input).map((x) => x.id)).toEqual(['m', 'fx', 'i']);
  });
});
