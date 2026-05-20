import { describe, it, expect } from 'vitest';
import { buildCurvePath } from '@/components/Workspace/Timeline/AutomationCurvePath';
import type { AutomationPoint } from '@/lib/automation/types';

const opts = { widthPx: 100, heightPx: 50, valueMin: 0, valueMax: 1, lengthBeats: 4 };

describe('buildCurvePath', () => {
  it('linear path connects points with straight lines (M…L…)', () => {
    const pts: AutomationPoint<number>[] = [
      { beat: 0, value: 0 },
      { beat: 4, value: 1 }
    ];
    const d = buildCurvePath(pts, 'linear', opts);
    expect(d).toBe('M 0,50 L 100,0');
  });

  it('step path uses horizontal-then-vertical segments', () => {
    const pts: AutomationPoint<number>[] = [
      { beat: 0, value: 0 },
      { beat: 4, value: 1 }
    ];
    const d = buildCurvePath(pts, 'step', opts);
    expect(d).toBe('M 0,50 L 100,50 L 100,0');
  });

  it('easeIn path uses a cubic Bezier with control points at a.y (slow start, dives to b)', () => {
    const pts: AutomationPoint<number>[] = [
      { beat: 0, value: 0 },
      { beat: 4, value: 1 }
    ];
    const d = buildCurvePath(pts, 'easeIn', opts);
    // Slow start: both control points held at a.y=50, then the path dives to b=(100,0).
    expect(d).toMatch(/^M 0,50 C [\d.]+,50 [\d.]+,50 100,0$/);
  });

  it('easeOut path uses a cubic Bezier with control points at b.y (fast start, eases into b)', () => {
    const pts: AutomationPoint<number>[] = [
      { beat: 0, value: 0 },
      { beat: 4, value: 1 }
    ];
    const d = buildCurvePath(pts, 'easeOut', opts);
    // Fast start: both control points pulled to b.y=0, so the path leaves a fast and settles into b.
    expect(d).toMatch(/^M 0,50 C [\d.]+,0 [\d.]+,0 100,0$/);
  });
});
