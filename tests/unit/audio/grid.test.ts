import { describe, it, expect } from 'vitest';
import { timeToBeats } from '@/lib/audio/grid';
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
