import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';

beforeEach(() => {
  useAppStore.setState((s) => ({
    ui: { ...s.ui, expandedAutomationClipId: null }
  }));
});

describe('UI state — expandedAutomationClipId', () => {
  it('defaults to null after a reset', () => {
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBeNull();
  });

  it('setExpandedAutomationClipId writes the field', () => {
    useAppStore.getState().setExpandedAutomationClipId('clip-x');
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBe('clip-x');
    useAppStore.getState().setExpandedAutomationClipId(null);
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBeNull();
  });

  it('partialize excludes expandedAutomationClipId (only zoom persists)', () => {
    if (typeof window === 'undefined') return;
    useAppStore.getState().setExpandedAutomationClipId('should-not-persist');
    const raw = window.localStorage.getItem('vibegrid-store');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    expect(parsed.state.ui?.expandedAutomationClipId).toBeUndefined();
    expect(parsed.state.ui?.zoom).toBeDefined();
  });
});
