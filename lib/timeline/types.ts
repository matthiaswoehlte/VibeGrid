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
  | 'sunray';

export type FxKind = Exclude<TrackKind, 'image'>;

/** Trigger cadence for FX. Defined here (not in renderer) because clips own a trigger. */
export type TriggerMode = 'half-bar' | 'beat' | 'bar' | 'two-bar';

export type SnapMode = 'beat' | 'half' | 'quarter' | 'off';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  order: number;
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
