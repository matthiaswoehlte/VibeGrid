import {
  SNAP_TO_BEATS,
  type Clip,
  type FxKind,
  type SnapMode,
  type TimelineState
} from './types';

export function snapBeats(beats: number, mode: SnapMode): number {
  if (mode === 'off') return beats;
  const step = SNAP_TO_BEATS[mode];
  return Math.round(beats / step) * step;
}

export function hasOverlap(
  state: TimelineState,
  trackId: string,
  startBeat: number,
  lengthBeats: number,
  excludeClipId?: string
): boolean {
  const end = startBeat + lengthBeats;
  for (const c of state.clips) {
    if (c.trackId !== trackId) continue;
    if (c.id === excludeClipId) continue;
    const cEnd = c.startBeat + c.lengthBeats;
    if (startBeat < cEnd && end > c.startBeat) return true;
  }
  return false;
}

export function activeClipsAt(state: TimelineState, beats: number): Clip[] {
  return state.clips.filter((c) => beats >= c.startBeat && beats < c.startBeat + c.lengthBeats);
}

export function activeImageClip(state: TimelineState, beats: number): Clip | null {
  for (const c of state.clips) {
    if (c.kind !== 'image') continue;
    if (beats >= c.startBeat && beats < c.startBeat + c.lengthBeats) return c;
  }
  return null;
}

export function activeFxClipsByKind(
  state: TimelineState,
  beats: number
): Record<FxKind, Clip[]> {
  const result: Record<FxKind, Clip[]> = {
    contour: [],
    sweep: [],
    pulse: [],
    particles: []
  };
  for (const c of state.clips) {
    if (c.kind === 'image') continue;
    if (beats < c.startBeat || beats >= c.startBeat + c.lengthBeats) continue;
    result[c.kind].push(c);
  }
  return result;
}
