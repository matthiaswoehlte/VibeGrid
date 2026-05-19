import type { BeatDetectionResult } from './types';

export interface DetectBeatsInput {
  data: Float32Array;
  sampleRate: number;
}

const FRAME_MS = 10;
const ENERGY_THRESHOLD = 1.3;
const LOCAL_WINDOW_S = 1;

/**
 * Energy-based beat detector. Pure function — no WebAudio, no DOM.
 *
 * Workflow:
 * 1. Slice samples into 10ms frames; compute energy per frame.
 * 2. Compute local-average energy over a 1s window per frame.
 * 3. Mark an onset where frame.energy > 1.3 * localAvg.
 * 4. Median inter-onset interval → BPM candidate.
 * 5. Octave-select into [60, 200]; clamp; confidence from onset density.
 */
export function detectBeats(
  input: DetectBeatsInput,
  onProgress?: (progress: number) => void
): BeatDetectionResult {
  const { data, sampleRate } = input;
  const frameSize = Math.round((sampleRate * FRAME_MS) / 1000);
  const localWindowFrames = Math.round((LOCAL_WINDOW_S * 1000) / FRAME_MS);
  const numFrames = Math.floor(data.length / frameSize);

  const energies = new Float32Array(numFrames);
  const progressStep = Math.max(1, Math.floor(numFrames / 10));
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    const start = f * frameSize;
    for (let i = 0; i < frameSize; i++) {
      const s = data[start + i];
      sum += s * s;
    }
    energies[f] = sum;
    if (onProgress && f % progressStep === 0) onProgress(f / numFrames);
  }

  const onsetFrames: number[] = [];
  for (let f = 0; f < numFrames; f++) {
    const winStart = Math.max(0, f - Math.floor(localWindowFrames / 2));
    const winEnd = Math.min(numFrames, winStart + localWindowFrames);
    let localSum = 0;
    for (let i = winStart; i < winEnd; i++) localSum += energies[i];
    const localAvg = localSum / (winEnd - winStart);
    if (localAvg > 0 && energies[f] > ENERGY_THRESHOLD * localAvg) {
      onsetFrames.push(f);
    }
  }

  if (onProgress) onProgress(1);

  if (onsetFrames.length < 2) {
    return { bpm: 120, detectedBeats: [], confidence: 0 };
  }

  const intervalsMs: number[] = [];
  for (let i = 1; i < onsetFrames.length; i++) {
    intervalsMs.push((onsetFrames[i] - onsetFrames[i - 1]) * FRAME_MS);
  }
  intervalsMs.sort((a, b) => a - b);
  const medianMs = intervalsMs[Math.floor(intervalsMs.length / 2)];
  let bpm = 60_000 / medianMs;

  while (bpm < 60) bpm *= 2;
  while (bpm > 200) bpm /= 2;
  bpm = Math.round(bpm);
  if (bpm < 60 || bpm > 200) {
    return { bpm, detectedBeats: [], confidence: 0 };
  }

  const expectedOnsets = (data.length / sampleRate) * (bpm / 60);
  const confidence = Math.min(1, onsetFrames.length / expectedOnsets);

  const detectedBeats = onsetFrames.map((f) => (f * frameSize) / sampleRate);

  return { bpm, detectedBeats, confidence };
}
