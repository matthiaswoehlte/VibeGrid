import { describe, it, expect } from 'vitest';
import {
  layoutClips,
  ENDCARD_DEFAULT_DURATION_SEC,
  CROSSFADE_BEATS_DEFAULT,
  type LayoutInputClip
} from '@/lib/sceneflow/clip-layout';

function c(
  overrides: Partial<LayoutInputClip> & { sceneOrder: number }
): LayoutInputClip {
  return {
    mediaId: `m-${overrides.sceneOrder}`,
    durationSec: 5,
    transition: 'cut',
    sceneType: 'action',
    ...overrides
  };
}

describe('layoutClips — snap modes', () => {
  it("snapMode='off': float lengthBeats, no trim", () => {
    // 5 s @ 120 BPM = 10 beats exactly; 5.3 s would give 10.6 beats
    const r = layoutClips({
      clips: [c({ sceneOrder: 1, durationSec: 5.3 })],
      bpm: 120,
      snapMode: 'off'
    });
    expect(r.clips[0]!.lengthBeats).toBeCloseTo(10.6, 5);
    expect(r.clips[0]!.trimmed).toBe(false);
    expect(r.clips[0]!.trimmedSec).toBe(0);
  });

  it("snapMode='beat': 10.6 → 10 (trimmed)", () => {
    const r = layoutClips({
      clips: [c({ sceneOrder: 1, durationSec: 5.3 })],
      bpm: 120,
      snapMode: 'beat'
    });
    expect(r.clips[0]!.lengthBeats).toBe(10);
    expect(r.clips[0]!.trimmed).toBe(true);
    // 10.6 raw → 10 beats = 5 s; trimmedSec ≈ 0.3
    expect(r.clips[0]!.trimmedSec).toBeCloseTo(0.3, 2);
  });

  it("snapMode='bar' (4 beats): 10.6 → 8 (trimmed)", () => {
    const r = layoutClips({
      clips: [c({ sceneOrder: 1, durationSec: 5.3 })],
      bpm: 120,
      snapMode: 'bar'
    });
    expect(r.clips[0]!.lengthBeats).toBe(8);
    expect(r.clips[0]!.trimmed).toBe(true);
  });

  it("snapMode='beat': 4.0 exact → no trim", () => {
    // 2 s @ 120 BPM = 4 beats exactly
    const r = layoutClips({
      clips: [c({ sceneOrder: 1, durationSec: 2 })],
      bpm: 120,
      snapMode: 'beat'
    });
    expect(r.clips[0]!.lengthBeats).toBe(4);
    expect(r.clips[0]!.trimmed).toBe(false);
  });
});

describe('layoutClips — sequential placement', () => {
  it('3 cut clips: lückenlos hintereinander', () => {
    const r = layoutClips({
      clips: [
        c({ sceneOrder: 1, durationSec: 2 }), // 4 beats
        c({ sceneOrder: 2, durationSec: 2 }),
        c({ sceneOrder: 3, durationSec: 2 })
      ],
      bpm: 120,
      snapMode: 'beat'
    });
    expect(r.clips.map((x) => [x.startBeat, x.lengthBeats])).toEqual([
      [0, 4],
      [4, 4],
      [8, 4]
    ]);
  });

  it('first clip with crossfade: startBeat=0 (no predecessor)', () => {
    const r = layoutClips({
      clips: [c({ sceneOrder: 1, durationSec: 2, transition: 'crossfade' })],
      bpm: 120,
      snapMode: 'beat'
    });
    expect(r.clips[0]!.startBeat).toBe(0);
  });
});

describe('layoutClips — crossfade overlap', () => {
  it('second clip crossfades by CROSSFADE_BEATS_DEFAULT (2)', () => {
    const r = layoutClips({
      clips: [
        c({ sceneOrder: 1, durationSec: 2 }), // 4 beats
        c({ sceneOrder: 2, durationSec: 2, transition: 'crossfade' })
      ],
      bpm: 120,
      snapMode: 'beat'
    });
    // First: [0, 4]; second starts at 4 - 2 = 2
    expect(r.clips[1]!.startBeat).toBe(2);
    expect(r.clips[1]!.lengthBeats).toBe(4);
  });

  it('crossfade guard: lengthBeats=2 + crossfadeBeats=2 → effectiveCrossfade=1', () => {
    // First clip 4 beats, second clip 1 s = 2 beats with crossfade
    const r = layoutClips({
      clips: [
        c({ sceneOrder: 1, durationSec: 2 }), // 4 beats
        c({ sceneOrder: 2, durationSec: 1, transition: 'crossfade' }) // 2 beats
      ],
      bpm: 120,
      snapMode: 'beat'
    });
    // Second's lengthBeats=2 → effectiveCrossfade=min(2, floor(2/2))=1
    // So startBeat = 4 - 1 = 3
    expect(r.clips[1]!.lengthBeats).toBe(2);
    expect(r.clips[1]!.startBeat).toBe(3);
  });

  it('crossfade guard: lengthBeats=1 + crossfadeBeats=2 → effectiveCrossfade=0', () => {
    // First 4 beats, second 0.5 s = 1 beat with crossfade
    const r = layoutClips({
      clips: [
        c({ sceneOrder: 1, durationSec: 2 }), // 4 beats
        c({ sceneOrder: 2, durationSec: 0.5, transition: 'crossfade' }) // 1 beat
      ],
      bpm: 120,
      snapMode: 'beat'
    });
    // Floor(1/2)=0 → no overlap; clip starts at 4 (after previous)
    expect(r.clips[1]!.lengthBeats).toBe(1);
    expect(r.clips[1]!.startBeat).toBe(4);
  });
});

describe('layoutClips — sub-beat warnings', () => {
  it('very short scene → warning + lengthBeats=1', () => {
    // 0.2 s @ 120 BPM = 0.4 beats raw
    const r = layoutClips({
      clips: [c({ sceneOrder: 1, durationSec: 0.2 })],
      bpm: 120,
      snapMode: 'beat'
    });
    expect(r.clips[0]!.lengthBeats).toBe(1);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.sceneOrder).toBe(1);
    expect(r.warnings[0]!.message).toMatch(/sehr kurz/i);
  });

  it('snap=off + tiny duration: no warning, no clamp', () => {
    const r = layoutClips({
      clips: [c({ sceneOrder: 1, durationSec: 0.1 })],
      bpm: 120,
      snapMode: 'off'
    });
    expect(r.clips[0]!.lengthBeats).toBeCloseTo(0.2, 5);
    expect(r.warnings).toHaveLength(0);
  });
});

describe('layoutClips — endcards', () => {
  it('endcard with durationSec=0 falls back to ENDCARD_DEFAULT_DURATION_SEC', () => {
    const r = layoutClips({
      clips: [c({ sceneOrder: 1, durationSec: 0, sceneType: 'endcard' })],
      bpm: 120,
      snapMode: 'beat'
    });
    // 5 s @ 120 BPM = 10 beats
    expect(r.clips[0]!.lengthBeats).toBe(10);
  });

  it('endcard with explicit durationSec uses that value', () => {
    const r = layoutClips({
      clips: [c({ sceneOrder: 1, durationSec: 3, sceneType: 'endcard' })],
      bpm: 120,
      snapMode: 'beat'
    });
    // 3 s @ 120 BPM = 6 beats
    expect(r.clips[0]!.lengthBeats).toBe(6);
  });
});

describe('layoutClips — invalid input', () => {
  it('bpm <= 0 throws', () => {
    expect(() =>
      layoutClips({
        clips: [c({ sceneOrder: 1 })],
        bpm: 0,
        snapMode: 'beat'
      })
    ).toThrow(/bpm/);
  });
});

describe('layoutClips — beatsPerBar override', () => {
  it("snapMode='bar' with beatsPerBar=3: 9.5 beats → 9 (3*3)", () => {
    // 9.5 beats @ 120 BPM = 4.75 s
    const r = layoutClips({
      clips: [c({ sceneOrder: 1, durationSec: 4.75 })],
      bpm: 120,
      snapMode: 'bar',
      beatsPerBar: 3
    });
    expect(r.clips[0]!.lengthBeats).toBe(9);
  });
});

describe('exports', () => {
  it('ENDCARD_DEFAULT_DURATION_SEC = 5', () => {
    expect(ENDCARD_DEFAULT_DURATION_SEC).toBe(5);
  });

  it('CROSSFADE_BEATS_DEFAULT = 2', () => {
    expect(CROSSFADE_BEATS_DEFAULT).toBe(2);
  });
});
