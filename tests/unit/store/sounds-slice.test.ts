import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { initialSoundsState } from '@/lib/store/sounds-slice';
import type { SoundManifest } from '@/lib/sounds/types';

const SAMPLE: SoundManifest = {
  version: 1,
  updatedAt: '2026-05-28T00:00:00Z',
  categories: []
};

describe('sounds slice', () => {
  beforeEach(() => {
    useAppStore.setState({ sounds: initialSoundsState });
    useAppStore.getState().clearHistory();
  });

  it('has an empty initial state (manifest null, isLoading false, error null)', () => {
    expect(useAppStore.getState().sounds).toEqual(initialSoundsState);
  });

  it('setManifest stores the manifest and clears loading/error', () => {
    useAppStore.getState().soundsActions.setLoading(true);
    useAppStore.getState().soundsActions.setError('previous');
    useAppStore.getState().soundsActions.setManifest(SAMPLE);
    const s = useAppStore.getState().sounds;
    expect(s.manifest).toEqual(SAMPLE);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });

  it('setLoading toggles isLoading without touching manifest/error', () => {
    useAppStore.getState().soundsActions.setManifest(SAMPLE);
    useAppStore.getState().soundsActions.setError('boom');
    useAppStore.getState().soundsActions.setLoading(true);
    const s = useAppStore.getState().sounds;
    expect(s.isLoading).toBe(true);
    expect(s.manifest).toEqual(SAMPLE);
    expect(s.error).toBe('boom');
  });

  it('setError stores the message and clears loading', () => {
    useAppStore.getState().soundsActions.setLoading(true);
    useAppStore.getState().soundsActions.setError('manifest 502');
    const s = useAppStore.getState().sounds;
    expect(s.error).toBe('manifest 502');
    expect(s.isLoading).toBe(false);
  });

  it('all 3 actions are { skip: true } — no history entries recorded', () => {
    const before = useAppStore.getState().history.past.length;
    useAppStore.getState().soundsActions.setLoading(true);
    useAppStore.getState().soundsActions.setManifest(SAMPLE);
    useAppStore.getState().soundsActions.setError('x');
    const after = useAppStore.getState().history.past.length;
    expect(after).toBe(before);
  });
});
