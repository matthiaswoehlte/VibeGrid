import type { ExportState } from './types';

export const EXPORT_INITIAL_STATE: ExportState = {
  status: 'idle',
  progress: 0,
  elapsedSeconds: 0,
  totalSeconds: 0
};

/**
 * Patch-merge with one structural rule: returning to `idle` clears all
 * derived fields (elapsedSeconds, progress, warning, errorCode). Every
 * other status change preserves the rest of the state.
 */
export function reduceExportState(
  state: ExportState,
  patch: Partial<ExportState>
): ExportState {
  const next = { ...state, ...patch };
  if (patch.status === 'idle' && state.status !== 'idle') {
    next.elapsedSeconds = 0;
    next.progress = 0;
    next.warning = undefined;
    next.errorCode = undefined;
  }
  return next;
}
