const PREFERENCES = [
  { mimeType: 'video/webm;codecs=vp9,opus', label: 'VP9 + Opus' },
  { mimeType: 'video/webm;codecs=vp8,opus', label: 'VP8 + Opus (Fallback)' },
  { mimeType: 'video/webm', label: 'WebM (browser default)' }
] as const;

export interface PickedCodec {
  mimeType: string;
  label: string;
}

/**
 * Walk the preference list against `isSupported` (defaults to
 * MediaRecorder.isTypeSupported when available) and return the first match.
 * Pure when `isSupported` is provided — used by tests to script outcomes.
 */
export function pickCodec(
  isSupported: (type: string) => boolean = (t) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)
): PickedCodec {
  for (const opt of PREFERENCES) {
    if (isSupported(opt.mimeType)) return { mimeType: opt.mimeType, label: opt.label };
  }
  // No webm support at all — return the last preference and let the recorder
  // fail loudly when start() is called. The UI surfaces this via
  // status='error' / errorCode='codec-unsupported'.
  return {
    mimeType: PREFERENCES[PREFERENCES.length - 1].mimeType,
    label: 'WebM (unsupported?)'
  };
}
