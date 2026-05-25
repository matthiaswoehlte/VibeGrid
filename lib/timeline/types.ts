/** Plan 5.9c — TrackKind collapsed to the four lane-types. FX-specific
 *  kinds (contour / sweep / …) live on `clip.kind` only; the track
 *  carrying them is `kind: 'fx'`.
 *
 *  Plan 8d adds two singleton track kinds for SceneFlow-transfer output:
 *    'main-video' — dedicated video track, top-pinned, replaced on every
 *                   SceneFlow transfer. At most one per project.
 *    'sync-audio' — dedicated audio track, top-pinned, primary BPM source.
 *                   At most one per project. New file dropped → BPM re-detect
 *                   + auto-resnap of all main-video clips. */
export type TrackKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'fx'
  | 'main-video'
  | 'sync-audio';

/** Media-bearing kinds (carry their own media reference; not FX plugins). */
export type MediaTrackKind =
  | 'image'
  | 'audio'
  | 'video'
  | 'main-video'
  | 'sync-audio';

// Plan 5.9c — `FxKind` is gone. Callers import `TrackFxKind` from
// `@/lib/timeline/plugin-mapping` (re-exported below for transitional
// imports that already pointed at this module).
export type { TrackFxKind } from './plugin-mapping';

/** Trigger cadence for FX. Defined here (not in renderer) because clips own a trigger. */
export type TriggerMode = 'half-bar' | 'beat' | 'bar' | 'two-bar';

export type SnapMode = 'beat' | 'half' | 'quarter' | 'off';

export interface Track {
  id: string;
  /** Plan 5.9c — narrow to the 4-entry `TrackKind`. The v5→v6 migrate
   *  in `lib/store/index.ts` ensures runtime values are always
   *  `'image'|'video'|'audio'|'fx'`. Legacy v5 snapshot data flows
   *  through migrate's `unknown` input, not through this type. */
  kind: TrackKind;
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
