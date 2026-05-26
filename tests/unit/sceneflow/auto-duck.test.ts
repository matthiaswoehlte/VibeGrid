import { describe, it, expect } from 'vitest';
import {
  buildAutoDuckCurve,
  DEFAULT_DUCK_LEVEL,
  type DuckWindow
} from '@/lib/sceneflow/auto-duck';

describe('buildAutoDuckCurve', () => {
  it('returns null for an empty window list', () => {
    expect(buildAutoDuckCurve([])).toBeNull();
  });

  it('returns null when every window is degenerate (end <= start)', () => {
    const windows: DuckWindow[] = [
      { startBeat: 4, endBeat: 4 },
      { startBeat: 8, endBeat: 6 }
    ];
    expect(buildAutoDuckCurve(windows)).toBeNull();
  });

  it('produces an anchor at beat 0 plus duck/restore points per window', () => {
    const curve = buildAutoDuckCurve([{ startBeat: 4, endBeat: 6 }]);
    expect(curve).not.toBeNull();
    expect(curve!.mode).toBe('automation');
    expect(curve!.interpolation).toBe('step');
    expect(curve!.points).toEqual([
      { beat: 0, value: 1.0 },
      { beat: 4, value: DEFAULT_DUCK_LEVEL },
      { beat: 6, value: 1.0 }
    ]);
  });

  it('honors an explicit duck level and clamps to [0, 1]', () => {
    const c1 = buildAutoDuckCurve([{ startBeat: 0, endBeat: 4 }], 0.3);
    expect(c1!.points[1].value).toBe(0.3);
    const cHigh = buildAutoDuckCurve([{ startBeat: 0, endBeat: 4 }], 5);
    expect(cHigh!.points[1].value).toBe(1);
    const cLow = buildAutoDuckCurve([{ startBeat: 0, endBeat: 4 }], -0.5);
    expect(cLow!.points[1].value).toBe(0);
  });

  it('merges overlapping windows', () => {
    const curve = buildAutoDuckCurve([
      { startBeat: 4, endBeat: 8 },
      { startBeat: 6, endBeat: 10 }
    ]);
    expect(curve!.points).toEqual([
      { beat: 0, value: 1.0 },
      { beat: 4, value: DEFAULT_DUCK_LEVEL },
      { beat: 10, value: 1.0 }
    ]);
  });

  it('merges adjacent (touching) windows', () => {
    const curve = buildAutoDuckCurve([
      { startBeat: 4, endBeat: 8 },
      { startBeat: 8, endBeat: 12 }
    ]);
    expect(curve!.points).toEqual([
      { beat: 0, value: 1.0 },
      { beat: 4, value: DEFAULT_DUCK_LEVEL },
      { beat: 12, value: 1.0 }
    ]);
  });

  it('sorts unsorted input windows', () => {
    const curve = buildAutoDuckCurve([
      { startBeat: 20, endBeat: 24 },
      { startBeat: 4, endBeat: 8 }
    ]);
    expect(curve!.points).toEqual([
      { beat: 0, value: 1.0 },
      { beat: 4, value: DEFAULT_DUCK_LEVEL },
      { beat: 8, value: 1.0 },
      { beat: 20, value: DEFAULT_DUCK_LEVEL },
      { beat: 24, value: 1.0 }
    ]);
  });

  it('drops degenerate windows but keeps surrounding valid ones', () => {
    const curve = buildAutoDuckCurve([
      { startBeat: 4, endBeat: 8 },
      { startBeat: 12, endBeat: 12 }, // degenerate
      { startBeat: 16, endBeat: 20 }
    ]);
    expect(curve!.points).toEqual([
      { beat: 0, value: 1.0 },
      { beat: 4, value: DEFAULT_DUCK_LEVEL },
      { beat: 8, value: 1.0 },
      { beat: 16, value: DEFAULT_DUCK_LEVEL },
      { beat: 20, value: 1.0 }
    ]);
  });
});
