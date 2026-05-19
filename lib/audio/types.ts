export type BeatSource = 'manual' | 'detected';

export interface BeatGrid {
  bpm: number;
  source: BeatSource;
  beatsPerBar: number;
  offsetMs: number;
  detectedBeats?: number[];
}

export type AudioStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'error';

export interface AudioEngineState {
  status: AudioStatus;
  duration: number;
  currentTime: number;
  beatGrid: BeatGrid;
}

export interface BeatDetectionResult {
  bpm: number;
  detectedBeats: number[];
  confidence: number;
}

export interface BeatPhaseResult {
  beatIndex: number;
  phase: number;
  isOnBeat: boolean;
}

/** Sane defaults for a new project. */
export const DEFAULT_BEAT_GRID: BeatGrid = {
  bpm: 120,
  source: 'manual',
  beatsPerBar: 4,
  offsetMs: 0
};
