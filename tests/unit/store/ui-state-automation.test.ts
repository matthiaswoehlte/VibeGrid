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

describe('expandedAutomationClipId cleanup', () => {
  beforeEach(() => {
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: [
          {
            id: 'clip-x',
            trackId: 'track-pulse',
            kind: 'pulse',
            fxId: 'pulse',
            startBeat: 0,
            lengthBeats: 4,
            label: 'X'
          }
        ]
      },
      ui: { zoom: s.ui.zoom, selectedClipId: 'clip-x', expandedAutomationClipId: 'clip-x' }
    }));
  });

  it('removing the expanded clip clears expandedAutomationClipId', () => {
    useAppStore.getState().timelineActions.removeClip('clip-x');
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBeNull();
  });

  it('selecting a different clip clears expandedAutomationClipId', () => {
    useAppStore.getState().setSelectedClipId('clip-y');
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBeNull();
  });

  it('selecting the same clip keeps the lane open', () => {
    useAppStore.getState().setSelectedClipId('clip-x');
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBe('clip-x');
  });
});
