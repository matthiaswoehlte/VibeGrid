import type { BeatGrid } from './types';

export const BEAT_WINDOW_MS = 40;

export function timeToBeats(seconds: number, grid: BeatGrid): number {
  return ((seconds - grid.offsetMs / 1000) * grid.bpm) / 60;
}
