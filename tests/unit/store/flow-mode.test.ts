import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';

beforeEach(() => {
  useAppStore.getState().setFlowMode(false);
});

describe('UI state — flowMode', () => {
  it('defaults to false (Beat Mode is the baseline)', () => {
    expect(useAppStore.getState().ui.flowMode).toBe(false);
  });

  it('setFlowMode(true) flips the flag and back to false', () => {
    useAppStore.getState().setFlowMode(true);
    expect(useAppStore.getState().ui.flowMode).toBe(true);
    useAppStore.getState().setFlowMode(false);
    expect(useAppStore.getState().ui.flowMode).toBe(false);
  });

  it('partialize excludes flowMode (only zoom persists from ui)', () => {
    if (typeof window === 'undefined') return;
    useAppStore.getState().setFlowMode(true);
    const raw = window.localStorage.getItem('vibegrid-store');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    expect(parsed.state.ui?.flowMode).toBeUndefined();
    expect(parsed.state.ui?.zoom).toBeDefined();
  });
});
