/**
 * Plan 8d — find the effective end of an audio buffer by skipping
 * trailing silence. MP3 exports often pad the end with several
 * seconds (sometimes minutes) of zeroed samples; the file's reported
 * duration covers that padding, which made the sync-audio timeline
 * clip 4-5× longer than the audible music.
 *
 * Strategy: walk samples from the end backwards, in coarse chunks
 * (~10 ms), find the chunk whose peak absolute value exceeds the
 * threshold. Sample-precision isn't needed — the user-facing unit is
 * timeline beats, and a 10 ms chunk is far below a 16th-note at any
 * realistic tempo.
 *
 * The trim only fires when the detected silent tail exceeds
 * `minTailSec` (default 2 s) — short fades and natural decay tails
 * stay intact. A small 0.3 s safety pad is added so the music's
 * final reverb / decay isn't clipped off.
 *
 * Pure function — no WebAudio, no DOM. Works on any Float32Array.
 */

const DEFAULT_SILENCE_THRESHOLD = 0.005; // ~-46 dBFS
const DEFAULT_MIN_TAIL_SEC = 2;
const TRIM_SAFETY_PAD_SEC = 0.3;
const CHUNK_MS = 10;

export interface TrailingSilenceResult {
  /** Effective playable duration in seconds (≤ fullDurationSec). */
  effectiveDurationSec: number;
  /** Full buffer duration in seconds. */
  fullDurationSec: number;
  /** True when a non-trivial silent tail was detected and trimmed. */
  trimmed: boolean;
}

export function findEffectiveAudioEndSec(
  samples: Float32Array,
  sampleRate: number,
  threshold: number = DEFAULT_SILENCE_THRESHOLD,
  minTailSec: number = DEFAULT_MIN_TAIL_SEC
): TrailingSilenceResult {
  const fullDurationSec = samples.length / sampleRate;
  if (samples.length === 0 || sampleRate <= 0) {
    return { effectiveDurationSec: 0, fullDurationSec, trimmed: false };
  }
  const chunkSize = Math.max(1, Math.round((sampleRate * CHUNK_MS) / 1000));
  // Walk backwards over chunks. The first chunk whose peak abs(sample)
  // crosses the threshold is the last "audible" chunk; the music ends
  // at its right boundary.
  let audibleEnd = -1;
  for (
    let start = samples.length - chunkSize;
    start >= 0;
    start -= chunkSize
  ) {
    let peak = 0;
    const end = Math.min(samples.length, start + chunkSize);
    for (let i = start; i < end; i++) {
      const v = samples[i];
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    if (peak >= threshold) {
      audibleEnd = end;
      break;
    }
  }
  if (audibleEnd < 0) {
    // Entire buffer is below threshold — keep full duration as fallback.
    return { effectiveDurationSec: fullDurationSec, fullDurationSec, trimmed: false };
  }
  const effectiveEndSec = audibleEnd / sampleRate;
  const silentTailSec = fullDurationSec - effectiveEndSec;
  if (silentTailSec < minTailSec) {
    return { effectiveDurationSec: fullDurationSec, fullDurationSec, trimmed: false };
  }
  const trimmed = Math.min(
    fullDurationSec,
    effectiveEndSec + TRIM_SAFETY_PAD_SEC
  );
  return {
    effectiveDurationSec: trimmed,
    fullDurationSec,
    trimmed: true
  };
}
