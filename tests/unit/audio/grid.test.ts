import { describe, it, expect } from 'vitest';
import { timeToBeats, beatPhase, BEAT_WINDOW_MS } from '@/lib/audio/grid';
import type { BeatGrid } from '@/lib/audio/types';

const grid120: BeatGrid = { bpm: 120, source: 'manual', beatsPerBar: 4, offsetMs: 0 };

describe('timeToBeats', () => {
  it('returns 0 beats at 0 seconds', () => {
    expect(timeToBeats(0, grid120)).toBe(0);
  });

  it('returns 2 beats at 1 second at 120 BPM', () => {
    expect(timeToBeats(1, grid120)).toBe(2);
  });

  it('honors offsetMs (shift origin)', () => {
    const g: BeatGrid = { ...grid120, offsetMs: 500 };
    expect(timeToBeats(0.5, g)).toBe(0);
    expect(timeToBeats(1.5, g)).toBe(2);
  });

  it('scales with BPM', () => {
    const g60: BeatGrid = { ...grid120, bpm: 60 };
    expect(timeToBeats(2, g60)).toBe(2);
    const g180: BeatGrid = { ...grid120, bpm: 180 };
    expect(timeToBeats(1, g180)).toBe(3);
  });

  it('returns negative beats when seconds < offset (pre-roll)', () => {
    const g: BeatGrid = { ...grid120, offsetMs: 1000 };
    expect(timeToBeats(0.5, g)).toBe(-1);
  });
});

describe('beatPhase', () => {
  it('returns beatIndex=0, phase=0, isOnBeat=true at exact origin', () => {
    expect(beatPhase(0, grid120)).toEqual({ beatIndex: 0, phase: 0, isOnBeat: true });
  });

  it('returns beatIndex=1, phase=0, isOnBeat=true at exact beat boundary', () => {
    expect(beatPhase(0.5, grid120)).toEqual({ beatIndex: 1, phase: 0, isOnBeat: true });
  });

  it('returns phase ~0.5 mid-beat', () => {
    const r = beatPhase(0.75, grid120);
    expect(r.beatIndex).toBe(1);
    expect(r.phase).toBeCloseTo(0.5, 5);
    expect(r.isOnBeat).toBe(false);
  });

  it('isOnBeat=true within +40 ms of the nearest beat', () => {
    expect(beatPhase(0.5, grid120).isOnBeat).toBe(true);
    expect(beatPhase(0.52, grid120).isOnBeat).toBe(true);
    expect(beatPhase(0.539, grid120).isOnBeat).toBe(true);
    expect(beatPhase(0.541, grid120).isOnBeat).toBe(false);
  });

  it('isOnBeat=true within -40 ms of the nearest beat', () => {
    expect(beatPhase(0.48, grid120).isOnBeat).toBe(true);
    expect(beatPhase(0.461, grid120).isOnBeat).toBe(true);
    expect(beatPhase(0.459, grid120).isOnBeat).toBe(false);
  });

  it('rounds toward nearest beat for isOnBeat (not floor)', () => {
    const r = beatPhase(0.49, grid120);
    expect(r.beatIndex).toBe(0);
    expect(r.isOnBeat).toBe(true);
  });

  it('honors offsetMs', () => {
    const g: BeatGrid = { ...grid120, offsetMs: 100 };
    expect(beatPhase(0.1, g).beatIndex).toBe(0);
    expect(beatPhase(0.1, g).isOnBeat).toBe(true);
  });

  it('exports BEAT_WINDOW_MS = 40', () => {
    expect(BEAT_WINDOW_MS).toBe(40);
  });
});
