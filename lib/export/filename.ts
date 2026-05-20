/**
 * Produces "vibegrid_export_<ISO without colons/dots>.<ext>". The ISO is
 * truncated to seconds (no millis). Accepts an injected Date so tests
 * can pin the timestamp. Extension defaults to webm for backward
 * compatibility — Plan 6 MP4 path passes 'mp4'.
 */
export function makeFilename(
  now: Date = new Date(),
  ext: 'mp4' | 'webm' = 'webm'
): string {
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `vibegrid_export_${ts}.${ext}`;
}
