import type { TrackKind } from './types';
import { TRACK_FX_KINDS } from './plugin-mapping';

const FX_KIND_SET: ReadonlySet<string> = new Set(TRACK_FX_KINDS);

/**
 * Plan 5.9c — pure validation for drop-targeting:
 *
 * - Media-bearing tracks accept only the matching media-kind clip.
 * - Generic `'fx'` tracks accept any lowercase FX-clip kind from
 *   `TRACK_FX_KINDS`.
 *
 * `clipKind` is intentionally a plain `string` because callers can be
 * either the Mediathek drop path (passing `'image'` / `'video'` / `'audio'`)
 * or the FX-palette drop path (passing the lowercase plugin-kind via
 * `PLUGIN_KIND_TO_TRACK_KIND[plugin.kind]`). Both flow through the
 * same gate.
 */
export function canDropOnTrack(clipKind: string, trackKind: TrackKind): boolean {
  switch (trackKind) {
    case 'image': return clipKind === 'image';
    case 'video': return clipKind === 'video';
    case 'audio': return clipKind === 'audio';
    case 'fx':    return FX_KIND_SET.has(clipKind);
    default:      return false;
  }
}
