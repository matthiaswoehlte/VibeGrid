import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';

beforeEach(() => {
  useAppStore.setState((s) => ({
    ui: { ...s.ui, automationEditorClipId: null }
  }));
});

describe('UI state — automationEditorClipId', () => {
  it('defaults to null after a reset', () => {
    expect(useAppStore.getState().ui.automationEditorClipId).toBeNull();
  });

  it('setAutomationEditorClipId writes the field', () => {
    useAppStore.getState().setAutomationEditorClipId('clip-x');
    expect(useAppStore.getState().ui.automationEditorClipId).toBe('clip-x');
    useAppStore.getState().setAutomationEditorClipId(null);
    expect(useAppStore.getState().ui.automationEditorClipId).toBeNull();
  });

  it('partialize excludes automationEditorClipId (only zoom persists)', () => {
    if (typeof window === 'undefined') return;
    useAppStore.getState().setAutomationEditorClipId('should-not-persist');
    const raw = window.localStorage.getItem('vibegrid-store');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    expect(parsed.state.ui?.automationEditorClipId).toBeUndefined();
    expect(parsed.state.ui?.zoom).toBeDefined();
  });
});

describe('automationEditorClipId cleanup', () => {
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
      ui: {
        zoom: s.ui.zoom,
        selectedClipId: 'clip-x',
        automationEditorClipId: 'clip-x',
        automationSnap: 'off',
        exportState: EXPORT_INITIAL_STATE
      }
    }));
  });

  it('removing the expanded clip clears automationEditorClipId', () => {
    useAppStore.getState().timelineActions.removeClip('clip-x');
    expect(useAppStore.getState().ui.automationEditorClipId).toBeNull();
  });

  it('selecting a different clip clears automationEditorClipId', () => {
    useAppStore.getState().setSelectedClipId('clip-y');
    expect(useAppStore.getState().ui.automationEditorClipId).toBeNull();
  });

  it('selecting the same clip keeps the lane open', () => {
    useAppStore.getState().setSelectedClipId('clip-x');
    expect(useAppStore.getState().ui.automationEditorClipId).toBe('clip-x');
  });
});
