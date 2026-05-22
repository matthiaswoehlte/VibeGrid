import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';

beforeEach(() => {
  // Reset to default so test order doesn't leak.
  useAppStore.getState().mobileUIActions.setMobileTab('timeline');
});

describe('mobile-ui slice (Plan 5.10)', () => {
  it('defaults mobileTab to "timeline"', () => {
    expect(useAppStore.getState().mobileUI.mobileTab).toBe('timeline');
  });

  it('setMobileTab updates the active tab', () => {
    useAppStore.getState().mobileUIActions.setMobileTab('fx');
    expect(useAppStore.getState().mobileUI.mobileTab).toBe('fx');
    useAppStore.getState().mobileUIActions.setMobileTab('media');
    expect(useAppStore.getState().mobileUI.mobileTab).toBe('media');
  });

  it('partialize excludes mobileUI (transient — never persisted)', () => {
    if (typeof window === 'undefined') return;
    useAppStore.getState().mobileUIActions.setMobileTab('fx');
    const raw = window.localStorage.getItem('vibegrid-store');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    expect(parsed.state.mobileUI).toBeUndefined();
  });
});
