export interface AudioInput {
  data: Float32Array;
  sampleRate: number;
}

/**
 * Build a synthetic click track at a known BPM.
 * Each beat is a single-sample impulse (value = 1.0). Total length is `bars * 4` beats.
 * Matches the spec §11.3 helper but returns a POJO instead of an AudioBuffer.
 */
export function createSyntheticClickTrack(
  bpm: number,
  bars: number,
  sampleRate = 44100
): AudioInput {
  const beatInterval = (60 / bpm) * sampleRate;
  const totalBeats = bars * 4;
  const totalSamples = Math.ceil(beatInterval * totalBeats);
  const data = new Float32Array(totalSamples);
  for (let beat = 0; beat < totalBeats; beat++) {
    const pos = Math.round(beat * beatInterval);
    if (pos < totalSamples) data[pos] = 1.0;
  }
  return { data, sampleRate };
}

/**
 * Add a short decay envelope around each impulse so the detector's
 * energy windowing has something to integrate. Useful for harder tests.
 */
export function createDecayingClickTrack(
  bpm: number,
  bars: number,
  decaySamples = 200,
  sampleRate = 44100
): AudioInput {
  const base = createSyntheticClickTrack(bpm, bars, sampleRate);
  const out = new Float32Array(base.data.length);
  for (let i = 0; i < base.data.length; i++) {
    if (base.data[i] > 0) {
      for (let d = 0; d < decaySamples && i + d < out.length; d++) {
        out[i + d] += Math.exp(-d / (decaySamples / 4));
      }
    }
  }
  return { data: out, sampleRate };
}
