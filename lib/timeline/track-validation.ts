import type { TrackKind, MediaTrackKind } from './types';

/**
 * Plan 5.9a — pure validation: which media kinds may be dropped on a
 * given track kind. Media-bearing kinds must match exactly:
 *
 *   image media  → only image tracks
 *   audio media  → only audio tracks
 *   video media  → only video tracks
 *
 * FX-clip drops (the ⚡ Auto-Preset path / drag-from-plugin-palette) are
 * NOT covered here — they target their own per-kind tracks via the
 * existing fxId-routing in `Tracks.tsx`. This helper is specifically
 * for the Mediathek → Timeline drop path.
 */
export function canDropOnTrack(
  mediaKind: MediaTrackKind,
  trackKind: TrackKind
): boolean {
  return mediaKind === trackKind;
}
