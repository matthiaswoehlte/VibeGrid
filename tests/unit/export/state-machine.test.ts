import { describe, it, expect } from 'vitest';
import { EXPORT_INITIAL_STATE, reduceExportState } from '@/lib/export/state-machine';

describe('ExportState', () => {
  it('initial state is idle with zeroed timecodes', () => {
    expect(EXPORT_INITIAL_STATE.status).toBe('idle');
    expect(EXPORT_INITIAL_STATE.progress).toBe(0);
    expect(EXPORT_INITIAL_STATE.elapsedSeconds).toBe(0);
    expect(EXPORT_INITIAL_STATE.totalSeconds).toBe(0);
    expect(EXPORT_INITIAL_STATE.warning).toBeUndefined();
  });

  it('patch-merges and preserves untouched keys', () => {
    const s1 = reduceExportState(EXPORT_INITIAL_STATE, {
      status: 'recording',
      totalSeconds: 90
    });
    const s2 = reduceExportState(s1, { elapsedSeconds: 30 });
    expect(s2.status).toBe('recording');
    expect(s2.totalSeconds).toBe(90);
    expect(s2.elapsedSeconds).toBe(30);
  });

  it('reset back to idle clears elapsed/progress/warning', () => {
    const s1 = reduceExportState(EXPORT_INITIAL_STATE, {
      status: 'recording',
      elapsedSeconds: 30,
      warning: 'tab-hidden'
    });
    const s2 = reduceExportState(s1, { status: 'idle' });
    expect(s2.status).toBe('idle');
    expect(s2.elapsedSeconds).toBe(0);
    expect(s2.progress).toBe(0);
    expect(s2.warning).toBeUndefined();
  });

  it('warning fields can be set without changing status', () => {
    const s = reduceExportState(
      { ...EXPORT_INITIAL_STATE, status: 'recording' },
      { warning: 'performance-degraded' }
    );
    expect(s.status).toBe('recording');
    expect(s.warning).toBe('performance-degraded');
  });
});
