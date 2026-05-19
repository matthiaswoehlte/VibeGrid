import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { initialMediaState } from '@/lib/store/media-slice';
import type { MediaRef } from '@/lib/storage/types';

const sampleRef = (id: string): MediaRef => ({
  id,
  kind: 'image',
  url: `https://media.example.com/${id}.jpg`,
  filename: `${id}.jpg`,
  uploadedAt: '2026-05-19T12:00:00.000Z'
});

describe('media store slice', () => {
  beforeEach(() => {
    useAppStore.setState({ media: { ...initialMediaState } });
  });

  it('starts with an empty mediaRefs array', () => {
    expect(useAppStore.getState().media.mediaRefs).toEqual([]);
  });

  it('addMediaRef appends a new ref', () => {
    useAppStore.getState().mediaActions.addMediaRef(sampleRef('a'));
    expect(useAppStore.getState().media.mediaRefs).toHaveLength(1);
  });

  it('addMediaRef is idempotent (same id is dedupe)', () => {
    useAppStore.getState().mediaActions.addMediaRef(sampleRef('a'));
    useAppStore.getState().mediaActions.addMediaRef(sampleRef('a'));
    expect(useAppStore.getState().media.mediaRefs).toHaveLength(1);
  });

  it('removeMediaRef drops the matching ref', () => {
    const { mediaActions } = useAppStore.getState();
    mediaActions.addMediaRef(sampleRef('a'));
    mediaActions.addMediaRef(sampleRef('b'));
    mediaActions.removeMediaRef('a');
    expect(useAppStore.getState().media.mediaRefs.map((m) => m.id)).toEqual(['b']);
  });

  it('getMediaRef returns the matching ref or undefined', () => {
    const { mediaActions } = useAppStore.getState();
    mediaActions.addMediaRef(sampleRef('a'));
    expect(mediaActions.getMediaRef('a')?.id).toBe('a');
    expect(mediaActions.getMediaRef('missing')).toBeUndefined();
  });
});
