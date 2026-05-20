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
  // Returns the FIRST matching image clip in array order.
  // v0.1: only one image track is expected, so order is deterministic.
  // v0.2: if multiple image tracks are allowed, sort by track.order first.
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
    particles: [],
    'zoom-pulse': []
  };
  for (const c of state.clips) {
    if (c.kind === 'image') continue;
    if (beats < c.startBeat || beats >= c.startBeat + c.lengthBeats) continue;
    result[c.kind].push(c);
  }
  return result;
}

export function totalBeats(state: TimelineState): number {
  let max = 0;
  for (const c of state.clips) {
    const end = c.startBeat + c.lengthBeats;
    if (end > max) max = end;
  }
  return max;
}

/**
 * Format beats as a timecode string.
 *
 * Format rules (v0.1):
 * - Under 1 hour: `m:ss` — minutes are NOT zero-padded. e.g. `0:30`, `4:00`, `12:05`.
 * - 1 hour or more: `h:mm:ss` — minutes ARE zero-padded inside the hours form. e.g. `1:01:00`.
 * - Seconds are always zero-padded to 2 digits.
 * - Negative beats clamp to `0:00`.
 *
 * Fractional seconds are truncated (Math.floor), matching the Ruler's per-beat resolution
 * for v0.1. If sub-second precision is needed later, switch to `m:ss.cc`.
 */
export function beatsToTimecode(beats: number, bpm: number): string {
  const safe = Math.max(0, beats);
  const totalSeconds = Math.floor((safe * 60) / bpm);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = seconds.toString().padStart(2, '0');
  if (hours === 0) return `${minutes}:${ss}`;
  const mm = minutes.toString().padStart(2, '0');
  return `${hours}:${mm}:${ss}`;
}
