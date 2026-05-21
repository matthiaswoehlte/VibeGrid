/** Plan 5.9c — TrackKind collapsed to the four lane-types. FX-specific
 *  kinds (contour / sweep / …) live on `clip.kind` only; the track
 *  carrying them is `kind: 'fx'`. */
export type TrackKind = 'image' | 'video' | 'audio' | 'fx';

/** Media-bearing kinds (carry their own media reference; not FX plugins). */
export type MediaTrackKind = 'image' | 'audio' | 'video';

// Plan 5.9c — `FxKind` is gone. Callers import `TrackFxKind` from
// `@/lib/timeline/plugin-mapping` (re-exported below for transitional
// imports that already pointed at this module).
export type { TrackFxKind } from './plugin-mapping';

/** Trigger cadence for FX. Defined here (not in renderer) because clips own a trigger. */
export type TriggerMode = 'half-bar' | 'beat' | 'bar' | 'two-bar';

export type SnapMode = 'beat' | 'half' | 'quarter' | 'off';

export interface Track {
  id: string;
  /**
   * Plan 5.9c — **transitional widening** during the v5 → v6 migration
   * window. After the v5→v6 migrate runs, runtime values are always in
   * the 4-entry `TrackKind` (`image`|`video`|`audio`|`fx`). Test
   * fixtures and the migrate-input path still construct Track objects
   * with the legacy v5 FX-kinds (`'contour'`, `'pulse'`, …), so this
   * union has to admit them until those callers migrate. The final
   * cleanup task of Plan 5.9c narrows this back to `TrackKind`.
   */
  kind: TrackKind | import('./plugin-mapping').TrackFxKind;
  name: string;
  muted: boolean;
  /** @deprecated Plan 5.9a: array position in `TimelineState.tracks` is
   *  now authoritative for render order. Existing snapshots still carry
   *  the field; new code MUST NOT rely on it. Tolerated as optional so
   *  the migrate-hook can read & strip it on v4 → v5 upgrade. */
  order?: number;
}

export interface Clip {
  id: string;
  trackId: string;
  /** Plan 5.9c — widened to `TrackKind | TrackFxKind`. FX clips carry a
   *  lowercase FX-kind here (e.g. `'contour'`, `'zoom-pulse'`) while
   *  their parent track is `kind: 'fx'`. Image/video/audio clips carry
   *  the matching media kind. */
  kind: TrackKind | import('./plugin-mapping').TrackFxKind;
  startBeat: number;
  lengthBeats: number;
  mediaId?: string;
  fxId?: string;
  params?: Record<string, unknown>;
  trigger?: TriggerMode;
  label: string;
}

export interface PlayheadState {
  beats: number;
  playing: boolean;
}

export interface TimelineState {
  tracks: Track[];
  clips: Clip[];
  playhead: PlayheadState;
  zoom: number;
  snap: SnapMode;
}

export const SNAP_TO_BEATS: Record<SnapMode, number> = {
  beat: 1,
  half: 0.5,
  quarter: 0.25,
  off: 0
};
