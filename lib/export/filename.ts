/**
 * Produces "vibegrid_export_<ISO without colons/dots>.webm". The ISO is
 * truncated to seconds (no millis). Accepts an injected Date so tests
 * can pin the timestamp.
 */
export function makeFilename(now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `vibegrid_export_${ts}.webm`;
}
