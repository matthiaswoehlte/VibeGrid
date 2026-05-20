import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';

beforeEach(() => {
  useAppStore.setState((s) => ({
    ui: { ...s.ui, exportState: EXPORT_INITIAL_STATE }
  }));
});

describe('exportState store', () => {
  it('default is the initial state (status idle, zeroed)', () => {
    expect(useAppStore.getState().ui.exportState.status).toBe('idle');
    expect(useAppStore.getState().ui.exportState.elapsedSeconds).toBe(0);
  });

  it('setExportState patch-merges single fields', () => {
    useAppStore.getState().setExportState({ status: 'recording', totalSeconds: 90 });
    useAppStore.getState().setExportState({ elapsedSeconds: 30 });
    const s = useAppStore.getState().ui.exportState;
    expect(s.status).toBe('recording');
    expect(s.totalSeconds).toBe(90);
    expect(s.elapsedSeconds).toBe(30);
  });

  it('returning to idle clears derived fields (elapsed/progress/warning)', () => {
    useAppStore.getState().setExportState({
      status: 'recording',
      elapsedSeconds: 30,
      warning: 'tab-hidden'
    });
    useAppStore.getState().setExportState({ status: 'idle' });
    const s = useAppStore.getState().ui.exportState;
    expect(s.elapsedSeconds).toBe(0);
    expect(s.warning).toBeUndefined();
  });

  it('partialize excludes exportState (only zoom persists)', () => {
    if (typeof window === 'undefined') return;
    useAppStore.getState().setExportState({ status: 'recording' });
    const raw = window.localStorage.getItem('vibegrid-store');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    expect(parsed.state.ui?.exportState).toBeUndefined();
    expect(parsed.state.ui?.zoom).toBeDefined();
  });
});
