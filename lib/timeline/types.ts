export type TrackKind =
  | 'image'
  | 'contour'
  | 'sweep'
  | 'pulse'
  | 'particles'
  | 'zoom-pulse'
  // Plan 5.8a — three new FX track kinds. No `fx-` prefix to stay
  // consistent with the existing naming (`contour`, `pulse`, …).
  | 'text'
  | 'dissolve'
  | 'sunray'
  // Plan 5.9a — two more. `'audio'` is a STUB only — TrackKind already
  // accepts it so the type system is forward-compatible, but
  // `addTrack('audio')` rejects at runtime ("Multi-Audio-Tracks: v0.2").
  // `'video'` is wired through Plan 5.9b.
  | 'audio'
  | 'video';

/** Media-bearing kinds (carry their own media reference; not FX plugins). */
export type MediaTrackKind = 'image' | 'audio' | 'video';

/** FX-plugin track kinds — everything that draws via the renderer's plugin
 *  dispatch loop. Excludes the media-bearing kinds. */
export type FxKind = Exclude<TrackKind, MediaTrackKind>;

/** Trigger cadence for FX. Defined here (not in renderer) because clips own a trigger. */
export type TriggerMode = 'half-bar' | 'beat' | 'bar' | 'two-bar';

export type SnapMode = 'beat' | 'half' | 'quarter' | 'off';

export interface Track {
  id: string;
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
  kind: TrackKind;
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
