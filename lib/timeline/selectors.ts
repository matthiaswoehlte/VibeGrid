import { SNAP_TO_BEATS, type SnapMode, type TimelineState } from './types';

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
