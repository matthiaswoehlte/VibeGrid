import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';

beforeEach(() => {
  useAppStore.setState({ appMode: 'vibegrid' });
});

describe('appMode slice', () => {
  it('default mode is "vibegrid"', () => {
    expect(useAppStore.getState().appMode).toBe('vibegrid');
  });

  it('setAppMode flips the value reactively', () => {
    useAppStore.getState().setAppMode('sceneflow');
    expect(useAppStore.getState().appMode).toBe('sceneflow');
    useAppStore.getState().setAppMode('vibegrid');
    expect(useAppStore.getState().appMode).toBe('vibegrid');
  });
});
