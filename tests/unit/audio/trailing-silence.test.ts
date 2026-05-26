import { describe, it, expect } from 'vitest';
import { findEffectiveAudioEndSec } from '@/lib/audio/trailing-silence';

const SAMPLE_RATE = 44100;

function makeSamples(
  audibleSec: number,
  silentSec: number,
  audibleAmp = 0.5
): Float32Array {
  const total = Math.round((audibleSec + silentSec) * SAMPLE_RATE);
  const audibleEnd = Math.round(audibleSec * SAMPLE_RATE);
  const out = new Float32Array(total);
  for (let i = 0; i < audibleEnd; i++) {
    // Simple 100 Hz sine — guarantees peak ≥ amp.
    out[i] = audibleAmp * Math.sin((2 * Math.PI * 100 * i) / SAMPLE_RATE);
  }
  // The rest stays at 0.
  return out;
}

describe('findEffectiveAudioEndSec', () => {
  it('detects a long silent tail and trims to the audible end', () => {
    // User's real case: 33 s of music + 106 s of silence.
    const samples = makeSamples(33, 106);
    const r = findEffectiveAudioEndSec(samples, SAMPLE_RATE);
    expect(r.trimmed).toBe(true);
    expect(r.fullDurationSec).toBeCloseTo(139, 0);
    // Effective end should be near 33 s plus the 0.3 s safety pad.
    expect(r.effectiveDurationSec).toBeGreaterThan(33);
    expect(r.effectiveDurationSec).toBeLessThan(34);
  });

  it('does NOT trim when the silent tail is below minTailSec', () => {
    // 30 s music + 1 s silence — below the 2 s default threshold.
    const samples = makeSamples(30, 1);
    const r = findEffectiveAudioEndSec(samples, SAMPLE_RATE);
    expect(r.trimmed).toBe(false);
    expect(r.effectiveDurationSec).toBeCloseTo(31, 0);
  });

  it('returns full duration unchanged when the buffer ends with audio', () => {
    // 30 s music, no silence.
    const samples = makeSamples(30, 0);
    const r = findEffectiveAudioEndSec(samples, SAMPLE_RATE);
    expect(r.trimmed).toBe(false);
    expect(r.effectiveDurationSec).toBeCloseTo(30, 0);
  });

  it('handles an entirely silent buffer gracefully', () => {
    const samples = new Float32Array(SAMPLE_RATE * 5); // 5 s of zeros
    const r = findEffectiveAudioEndSec(samples, SAMPLE_RATE);
    // Detection fell through — return full duration as a safe fallback
    // (better to over-report a silent clip than mis-trim a real one).
    expect(r.trimmed).toBe(false);
    expect(r.effectiveDurationSec).toBeCloseTo(5, 0);
  });

  it('honors a custom threshold', () => {
    // Audible amp = 0.001 (below default threshold 0.005 → treated as silence).
    const samples = makeSamples(30, 5, 0.001);
    const rDefault = findEffectiveAudioEndSec(samples, SAMPLE_RATE);
    // With the default threshold the audio is "silent" everywhere.
    expect(rDefault.trimmed).toBe(false);
    // Lower the threshold, the audio is detected.
    const rLoose = findEffectiveAudioEndSec(samples, SAMPLE_RATE, 0.0005);
    expect(rLoose.trimmed).toBe(true);
    expect(rLoose.effectiveDurationSec).toBeLessThan(rDefault.fullDurationSec);
  });

  it('handles an empty buffer', () => {
    const r = findEffectiveAudioEndSec(new Float32Array(0), SAMPLE_RATE);
    expect(r.effectiveDurationSec).toBe(0);
    expect(r.fullDurationSec).toBe(0);
    expect(r.trimmed).toBe(false);
  });
});
