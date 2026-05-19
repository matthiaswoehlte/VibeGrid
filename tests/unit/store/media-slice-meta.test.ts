import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { initialMediaState } from '@/lib/store/media-slice';

const baseRef = {
  id: 'a',
  kind: 'image' as const,
  url: 'https://x/a.jpg',
  filename: 'a.jpg',
  uploadedAt: '2026-05-19T00:00:00.000Z'
};

describe('addMediaRefMeta', () => {
  beforeEach(() => {
    useAppStore.setState({ media: { ...initialMediaState } });
  });

  it('merges width/height onto an existing ref', () => {
    useAppStore.getState().mediaActions.addMediaRef(baseRef);
    useAppStore.getState().mediaActions.addMediaRefMeta('a', { width: 1920, height: 1080 });
    const ref = useAppStore.getState().mediaActions.getMediaRef('a');
    expect(ref?.width).toBe(1920);
    expect(ref?.height).toBe(1080);
    expect(ref?.url).toBe(baseRef.url);
  });

  it('no-op on unknown id', () => {
    useAppStore.getState().mediaActions.addMediaRefMeta('unknown', { duration: 12 });
    expect(useAppStore.getState().media.mediaRefs).toEqual([]);
  });

  it('preserves untouched fields when only duration is patched', () => {
    useAppStore.getState().mediaActions.addMediaRef({ ...baseRef, id: 'b', kind: 'audio' });
    useAppStore.getState().mediaActions.addMediaRefMeta('b', { duration: 180 });
    const ref = useAppStore.getState().mediaActions.getMediaRef('b');
    expect(ref?.duration).toBe(180);
    expect(ref?.filename).toBe('a.jpg');
  });
});
