import type { BeatGrid, BeatPhaseResult } from './types';

export const BEAT_WINDOW_MS = 40;

export function timeToBeats(seconds: number, grid: BeatGrid): number {
  return ((seconds - grid.offsetMs / 1000) * grid.bpm) / 60;
}

export function beatPhase(seconds: number, grid: BeatGrid): BeatPhaseResult {
  const beats = timeToBeats(seconds, grid);
  const beatIndex = Math.floor(beats);
  const phase = beats - beatIndex;

  const msPerBeat = 60_000 / grid.bpm;
  const distToCurrent = phase * msPerBeat;
  const distToNext = (1 - phase) * msPerBeat;
  const distMs = Math.min(distToCurrent, distToNext);

  return {
    beatIndex,
    phase,
    isOnBeat: distMs <= BEAT_WINDOW_MS
  };
}
