import type { ExportState } from './types';

export const EXPORT_INITIAL_STATE: ExportState = {
  status: 'idle',
  mode: 'realtime',
  progress: 0,
  elapsedSeconds: 0,
  totalSeconds: 0
};

/**
 * Patch-merge with one structural rule: returning to `idle` clears all
 * derived fields (elapsedSeconds, progress, warning, errorCode, plus
 * the offline-only currentFrame / totalFrames / etaSeconds). Every
 * other status change preserves the rest of the state.
 *
 * `mode` is deliberately NOT cleared on idle — once a browser is known
 * to support WebCodecs we keep it on 'offline' across consecutive
 * exports so the indicator doesn't briefly flash 'realtime' between
 * runs. The next setExportState that starts a fresh export re-asserts
 * the mode anyway.
 */
export function reduceExportState(
  state: ExportState,
  patch: Partial<ExportState>
): ExportState {
  const next = { ...state, ...patch };
  if (patch.status === 'idle' && state.status !== 'idle') {
    next.elapsedSeconds = 0;
    next.progress = 0;
    next.currentFrame = undefined;
    next.totalFrames = undefined;
    next.etaSeconds = undefined;
    next.warning = undefined;
    next.errorCode = undefined;
  }
  return next;
}
