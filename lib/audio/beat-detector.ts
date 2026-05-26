import type { BeatDetectionResult } from './types';

export interface DetectBeatsInput {
  data: Float32Array;
  sampleRate: number;
}

const FRAME_MS = 10;
const ENERGY_THRESHOLD = 1.5;
const LOCAL_WINDOW_S = 1;
const TARGET_MIN = 60;
const TARGET_MAX = 200;
const INTERVAL_BIN_MS = 5;
const INTERVAL_MAX_MS = 2000;
// Peak-picking window: an onset must be a local maximum within ±this
// many frames. 4 frames = ±40 ms covers the decay-tail of a percussive
// transient without spanning an actual neighboring beat (16th-note at
// 200 BPM = 75 ms, comfortably above the ±40 ms peak window).
const PEAK_HALF_WIDTH_FRAMES = 4;
// Refractory after a confirmed onset. 5 frames = 50 ms — far below
// the 16th-note period at 200 BPM (75 ms), so genuine fast beats
// still pass; the gap suppresses any residual ringing.
const ONSET_REFRACTORY_FRAMES = 5;

/** Fold an arbitrary BPM into the conventional musical range [60, 200]. */
function foldToRange(bpm: number): number {
  while (bpm < TARGET_MIN) bpm *= 2;
  while (bpm > TARGET_MAX) bpm /= 2;
  return bpm;
}

/**
 * Energy-flux-based beat detector. Pure function — no WebAudio, no DOM.
 *
 * Workflow:
 * 1. Compute per-frame energy (10 ms frames, frameEnergy = Σ samples²).
 * 2. Compute half-wave-rectified energy flux (max(0, Δenergy)). This
 *    highlights percussive transients and ignores sustained energy.
 * 3. Peak-pick the flux: local maxima within ±40 ms that exceed
 *    1.5× the local-average flux fire an onset. A 50 ms refractory
 *    suppresses post-transient ringing.
 * 4. Tempogram via inter-onset-interval pair histogram: for every
 *    pair of onsets within 1.5 s, bin the gap. Score each candidate
 *    tempo in [60, 200] BPM by the weight at its fundamental + 2× +
 *    3× + 4× multiples (diminishing 1/m). The peak wins.
 * 5. Parabolic interpolation around the winning bin recovers sub-bin
 *    precision.
 * 6. Confidence from onset density vs expected.
 *
 * Why pair-histogram + harmonic summation (and not adjacent-interval
 * mode): real music with mixed kick/snare/hi-hat creates a noisy
 * cluster of close-spaced onsets that the simple median or mode of
 * adjacent intervals locks onto. The all-pairs histogram inside a
 * multi-beat window stacks periodic structure across onset gaps
 * regardless of intervening syncopation. Harmonic summation breaks
 * the half-tempo / double-tempo ambiguity by preferring the tempo
 * whose multiples best explain the histogram (122 BPM beats 61 BPM
 * because 122's multiples cover 492/984/1476 ms while 61's only
 * cover 984 ms).
 *
 * Known limitation: low-BPM rock (≤110 BPM) with steady 8th-note
 * hi-hats can still be reported at 2× because the 8th-note grid
 * accrues more harmonic mass than the quarter-note grid in the
 * 60-200 BPM window. The user can nudge BPM in the Topbar.
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

  // Onset detection via half-wave-rectified energy flux: an onset
  // marks the moment energy RISES, not just where it's high. Pure
  // energy-above-threshold fails on real music because the energy
  // is high almost everywhere (bass, sustained guitar, vocals);
  // the threshold then catches every decay-tail and slow ramp.
  // Energy flux (positive first-difference) zeros sustained energy
  // and highlights percussive transients only.
  const flux = new Float32Array(numFrames);
  for (let f = 1; f < numFrames; f++) {
    const d = energies[f] - energies[f - 1];
    flux[f] = d > 0 ? d : 0;
  }

  // Peak-pick the flux: local maximum within ±PEAK_HALF_WIDTH_FRAMES
  // AND above ENERGY_THRESHOLD × local average flux. Both conditions
  // matter — peak-pick alone fires on every tiny ripple, threshold
  // alone fires on broad sustained rises.
  const onsetFrames: number[] = [];
  const onsetEnergies: number[] = [];
  let lastOnsetFrame = -ONSET_REFRACTORY_FRAMES;
  for (let f = PEAK_HALF_WIDTH_FRAMES; f < numFrames - PEAK_HALF_WIDTH_FRAMES; f++) {
    if (f - lastOnsetFrame < ONSET_REFRACTORY_FRAMES) continue;
    let isPeak = true;
    for (let i = f - PEAK_HALF_WIDTH_FRAMES; i <= f + PEAK_HALF_WIDTH_FRAMES; i++) {
      if (i !== f && flux[i] > flux[f]) {
        isPeak = false;
        break;
      }
    }
    if (!isPeak) continue;
    const winStart = Math.max(0, f - Math.floor(localWindowFrames / 2));
    const winEnd = Math.min(numFrames, winStart + localWindowFrames);
    let localSum = 0;
    for (let i = winStart; i < winEnd; i++) localSum += flux[i];
    const localAvg = localSum / (winEnd - winStart);
    if (localAvg > 0 && flux[f] > ENERGY_THRESHOLD * localAvg) {
      onsetFrames.push(f);
      onsetEnergies.push(flux[f]);
      lastOnsetFrame = f;
    }
  }

  if (onProgress) onProgress(1);

  if (onsetFrames.length < 2) {
    return { bpm: 120, detectedBeats: [], confidence: 0 };
  }

  // Histogram of inter-onset-interval gaps over ALL pairs within a
  // ~1.5 s window — this is the classical "tempogram via IOI
  // histogram" approach. Adjacent-only intervals are fragile against
  // dense, syncopated material (a hard-rock track at 122 BPM can
  // generate 200+ adjacent gaps clustering at 70-130 ms, none near
  // the actual quarter-note period). Using ALL pairs within a
  // multi-beat window amplifies the underlying periodicity: pairs
  // that span 1 beat, 2 beats, and 3 beats all stack onto the same
  // grid of multiples, while noise spreads thin.
  //
  // We restrict the search range to gaps in [300, 1000] ms which
  // correspond to BPM in [60, 200] — no octave-folding needed because
  // the peak is searched directly in the canonical range.
  const PAIR_MAX_MS = 1500;
  const SEARCH_LO_MS = 60_000 / TARGET_MAX; // 300 ms (200 BPM)
  const SEARCH_HI_MS = 60_000 / TARGET_MIN; // 1000 ms (60 BPM)
  const numBins = Math.ceil(PAIR_MAX_MS / INTERVAL_BIN_MS);
  const pairHist = new Int32Array(numBins);
  for (let i = 0; i < onsetFrames.length; i++) {
    for (let j = i + 1; j < onsetFrames.length; j++) {
      const gapMs = (onsetFrames[j] - onsetFrames[i]) * FRAME_MS;
      if (gapMs >= PAIR_MAX_MS) break;
      pairHist[Math.floor(gapMs / INTERVAL_BIN_MS)]++;
    }
  }
  // Score each candidate gap in the search range by the sum of
  // histogram weight at its FUNDAMENTAL + 2× + 3× + 4× multiples
  // (triangular-smoothed for jitter robustness). This is the standard
  // "comb-filter" tempogram score — the true beat period has weight
  // stacked at all its multiples (every onset pair that spans k beats
  // contributes to bin k×gap), while half-period or double-period
  // candidates only catch a subset.
  //
  // Without harmonic summation a clean 122 BPM song peaks at 984 ms
  // (the 2-beat gap, since longer gaps see less per-onset noise) and
  // returns 61 BPM. With it, 122 BPM beats 61 because 122's multiples
  // catch 492 + 984 + 1476 ms versus 61's only 984.
  const loBin = Math.floor(SEARCH_LO_MS / INTERVAL_BIN_MS);
  const hiBin = Math.floor(SEARCH_HI_MS / INTERVAL_BIN_MS);
  const sample = (binIdx: number): number => {
    if (binIdx < 1 || binIdx >= pairHist.length - 1) return 0;
    return pairHist[binIdx - 1] + pairHist[binIdx] * 2 + pairHist[binIdx + 1];
  };
  let bestBin = -1;
  let bestScore = 0;
  for (let i = loBin; i <= hiBin && i < pairHist.length - 1; i++) {
    let score = 0;
    for (let m = 1; m <= 4; m++) {
      const harmonicBin = i * m;
      if (harmonicBin >= pairHist.length - 1) break;
      score += sample(harmonicBin) / m; // diminishing weight per harmonic
    }
    if (score > bestScore) {
      bestScore = score;
      bestBin = i;
    }
  }
  if (bestBin < 0) {
    return { bpm: 120, detectedBeats: [], confidence: 0 };
  }
  // Refine: parabolic interpolation around the winning bin recovers
  // sub-bin precision (5 ms bins otherwise pin BPM to ~1-BPM steps,
  // not great near 200 BPM where 1 ms = 0.4 BPM).
  const y0 = pairHist[bestBin - 1] ?? 0;
  const y1 = pairHist[bestBin];
  const y2 = pairHist[bestBin + 1] ?? 0;
  const denom = y0 - 2 * y1 + y2;
  const shift = denom === 0 ? 0 : (0.5 * (y0 - y2)) / denom;
  const peakMs = (bestBin + 0.5 + shift) * INTERVAL_BIN_MS;
  const primaryBpm = foldToRange(60_000 / peakMs);

  // The pair-histogram tempogram already incorporates harmonic
  // summation in the bin scoring (each candidate is scored by the
  // weight at its fundamental + 2× + 3× + 4×), so a separate phase-
  // alignment pass over harmonic candidates would only re-litigate
  // a decision that's already statistically sound. Keep the primary.
  const onsetTimesS = onsetFrames.map((f) => (f * frameSize) / sampleRate);
  const winner = primaryBpm;
  const bpm = Math.round(winner);
  if (bpm < TARGET_MIN || bpm > TARGET_MAX) {
    return { bpm, detectedBeats: [], confidence: 0 };
  }

  const expectedOnsets = (data.length / sampleRate) * (bpm / 60);
  const confidence = Math.min(1, onsetFrames.length / expectedOnsets);

  return { bpm, detectedBeats: onsetTimesS, confidence };
}
