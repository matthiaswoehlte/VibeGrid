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

/** BPM clamp range. Single source of truth — imported by engine and store slice. */
export const BPM_MIN = 60;
export const BPM_MAX = 200;

/** Plan 5.9d — per-clip audio routing state held by the AudioEngine.
 *  Each loaded audio clip has its own decoded buffer + GainNode (for
 *  volume automation) + the currently-playing source node (one-shot,
 *  replaced on every Seek / play call). `isPlaying` mirrors whether
 *  `source` is currently scheduled. */
export interface AudioClipState {
  clipId: string;
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  gainNode: GainNode;
  isPlaying: boolean;
}
