import type { AppState } from './types';

/**
 * Plan 7 — shape of the persisted snapshot, shared by zustand's
 * `persist` middleware (lib/store/index.ts) and the DB save/load path
 * (lib/project/serialize.ts / deserialize.ts).
 *
 * Keeping this in one place means a future migration that touches the
 * snapshot shape automatically applies to both call sites.
 */
export interface PersistedShape {
  ui: { zoom: number };
  timeline: AppState['timeline'];
  audio: AppState['audio'];
  media: { mediaRefs: AppState['media']['mediaRefs'] };
}

/** Current zustand store version. Bump in lockstep with the `migrate`
 *  chain in `lib/store/index.ts`. */
export const STORE_VERSION = 7 as const;

/**
 * Strip transient fields and force `playhead.playing` to false. The
 * audio element is gone after a reload, so a "playing" flag would be
 * a lie. Transient ui/media fields (selectedClipId, exportState,
 * videoLoadProgress, …) are intentionally excluded.
 */
export function toPersistedShape(state: AppState): PersistedShape {
  return {
    ui: { zoom: state.ui.zoom },
    timeline: {
      ...state.timeline,
      playhead: { ...state.timeline.playhead, playing: false }
    },
    audio: state.audio,
    media: { mediaRefs: state.media.mediaRefs }
  };
}
