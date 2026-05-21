import type { TrackKind, MediaTrackKind } from './types';
import type { TrackFxKind } from './plugin-mapping';

/**
 * Plan 5.9a — pure validation: which media kinds may be dropped on a
 * given track kind.
 *
 * Plan 5.9c — Task 5 rewrites this function to also handle FX-clip
 * drops on `'fx'`-kind tracks (lowercase clip-kinds match the
 * `TRACK_FX_KINDS` set). The signature widens transitionally so the
 * existing track-validation.test.ts cases still typecheck during the
 * v5 → v6 transition window.
 */
export function canDropOnTrack(
  mediaKind: MediaTrackKind | TrackFxKind,
  trackKind: TrackKind | TrackFxKind
): boolean {
  return mediaKind === trackKind;
}
