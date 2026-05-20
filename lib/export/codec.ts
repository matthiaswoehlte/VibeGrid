const PREFERENCES = [
  // MP4 first — natively playable in iOS Safari + macOS Quick Look + every
  // social-platform upload pipeline. Chrome 122+, Safari 14.1+, Edge support
  // it in MediaRecorder.
  { mimeType: 'video/mp4;codecs=h264,aac', label: 'H.264 + AAC (MP4)', ext: 'mp4' },
  // Older Chromium variant of the same MP4 codec.
  { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', label: 'H.264 + AAC (MP4)', ext: 'mp4' },
  // WebM fallback — Firefox + older Chromium that lack MP4 in MediaRecorder.
  { mimeType: 'video/webm;codecs=vp9,opus', label: 'VP9 + Opus (WebM)', ext: 'webm' },
  { mimeType: 'video/webm;codecs=vp8,opus', label: 'VP8 + Opus (WebM Fallback)', ext: 'webm' },
  { mimeType: 'video/webm', label: 'WebM (browser default)', ext: 'webm' }
] as const;

export interface PickedCodec {
  mimeType: string;
  label: string;
  ext: 'mp4' | 'webm';
}

/**
 * Walk the preference list against `isSupported` (defaults to
 * MediaRecorder.isTypeSupported when available) and return the first match.
 *
 * MP4 is preferred over WebM where supported because: iOS Safari plays MP4
 * natively, every social-platform upload pipeline accepts it without
 * re-encoding, and Chrome 122+ / Safari 14.1+ / Edge all support it via
 * MediaRecorder. Firefox falls through to WebM.
 *
 * Pure when `isSupported` is provided — tests script outcomes via a fake.
 */
export function pickCodec(
  isSupported: (type: string) => boolean = (t) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)
): PickedCodec {
  for (const opt of PREFERENCES) {
    if (isSupported(opt.mimeType)) {
      return { mimeType: opt.mimeType, label: opt.label, ext: opt.ext };
    }
  }
  // Nothing at all supported — return the last preference and let the
  // recorder fail loudly when start() is called. The UI surfaces this via
  // status='error' / errorCode='codec-unsupported'.
  const last = PREFERENCES[PREFERENCES.length - 1];
  return { mimeType: last.mimeType, label: 'WebM (unsupported?)', ext: 'webm' };
}
