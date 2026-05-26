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

/**
 * Plan 8d regression — synthetic "hard rock" pattern: kick on beats
 * 1 + 3, snare on 2 + 4, hi-hat on every 8th note. Mixes three
 * onset cadences, which is the case that exposes median-of-intervals
 * harmonic confusion (e.g. 122 BPM reported as 188).
 */
export function createRockBeatTrack(
  bpm: number,
  bars: number,
  sampleRate = 44100,
  decaySamples = 200
): AudioInput {
  const beatSamples = (60 / bpm) * sampleRate;
  const totalBeats = bars * 4;
  const totalSamples = Math.ceil(beatSamples * (totalBeats + 1));
  const out = new Float32Array(totalSamples);
  const stamp = (samplePos: number, amp: number) => {
    const start = Math.round(samplePos);
    for (let d = 0; d < decaySamples && start + d < out.length; d++) {
      out[start + d] += amp * Math.exp(-d / (decaySamples / 4));
    }
  };
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * 4 * beatSamples;
    // Kick on beats 1, 3
    stamp(barStart + 0 * beatSamples, 1.0);
    stamp(barStart + 2 * beatSamples, 1.0);
    // Snare on beats 2, 4
    stamp(barStart + 1 * beatSamples, 0.85);
    stamp(barStart + 3 * beatSamples, 0.85);
    // Hi-hat on every 8th: beats 1.5, 2.5, 3.5, 4.5 (= bar+1)
    for (let h = 0; h < 8; h++) {
      stamp(barStart + h * 0.5 * beatSamples, 0.4);
    }
  }
  return { data: out, sampleRate };
}
