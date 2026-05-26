import { describe, it, expect } from 'vitest';
import { detectBeats } from '@/lib/audio/beat-detector';
import { createDecayingClickTrack, createRockBeatTrack } from './_helpers';

const TOL = 2;

function bpmCloseTo(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOL);
}

describe('detectBeats — synthetic click tracks', () => {
  it('detects 90 BPM within ±2 BPM', () => {
    const input = createDecayingClickTrack(90, 16);
    const r = detectBeats(input);
    bpmCloseTo(r.bpm, 90);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('detects 120 BPM within ±2 BPM', () => {
    const input = createDecayingClickTrack(120, 16);
    const r = detectBeats(input);
    bpmCloseTo(r.bpm, 120);
  });

  it('detects 128 BPM within ±2 BPM', () => {
    const input = createDecayingClickTrack(128, 16);
    const r = detectBeats(input);
    bpmCloseTo(r.bpm, 128);
  });

  it('emits progress 0..1 monotonically', () => {
    const input = createDecayingClickTrack(120, 16);
    const progress: number[] = [];
    detectBeats(input, (p) => progress.push(p));
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0]).toBeGreaterThanOrEqual(0);
    expect(progress[progress.length - 1]).toBeCloseTo(1, 1);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
  });

  it('returns confidence 0 on silence', () => {
    const data = new Float32Array(44100 * 5);
    const r = detectBeats({ data, sampleRate: 44100 });
    expect(r.confidence).toBe(0);
  });

  it('rejects out-of-range slow detections via octave-doubling (45 → 90)', () => {
    const input = createDecayingClickTrack(45, 16);
    const r = detectBeats(input);
    bpmCloseTo(r.bpm, 90);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('halves a very fast detection (220 → 110)', () => {
    const input = createDecayingClickTrack(220, 16);
    const r = detectBeats(input);
    bpmCloseTo(r.bpm, 110);
    expect(r.confidence).toBeGreaterThan(0);
  });

  // Plan 8d regression — user reported a 122 BPM hard-rock track
  // detected as 188 BPM. The cause was median-of-intervals locking
  // onto a 3:2 harmonic when kick + snare + hi-hat onsets mix.
  // The synthetic "rock beat" helper reproduces the same kind of
  // mixed-cadence onsets without needing a real audio file.
  //
  // KNOWN LIMITATION: the same helper at low BPMs (≤110) gets
  // detected as 2× the true tempo because the steady 8th-note
  // hi-hat pattern looks indistinguishable from quarter notes at
  // the doubled tempo. The user can nudge BPM in the Topbar.
  it('handles a mixed kick/snare/hi-hat pattern at 122 BPM (regression: was 188)', () => {
    const input = createRockBeatTrack(122, 16);
    const r = detectBeats(input);
    bpmCloseTo(r.bpm, 122);
    expect(r.confidence).toBeGreaterThan(0.3);
  });

  it('handles a mixed rock pattern at 130 BPM', () => {
    const input = createRockBeatTrack(130, 16);
    const r = detectBeats(input);
    bpmCloseTo(r.bpm, 130);
  });

  it('handles a mixed rock pattern at 150 BPM', () => {
    const input = createRockBeatTrack(150, 16);
    const r = detectBeats(input);
    bpmCloseTo(r.bpm, 150);
  });
});
