import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import type { AutomationCurve } from '@/lib/automation/types';

const CLIP_ID = 'clip-batch';

beforeEach(() => {
  useAppStore.setState((s) => ({
    timeline: {
      ...s.timeline,
      clips: [
        {
          id: CLIP_ID,
          trackId: 'track-pulse',
          kind: 'pulse',
          fxId: 'pulse',
          startBeat: 0,
          lengthBeats: 16,
          label: 'Batch',
          params: {
            intensity: {
              mode: 'automation',
              interpolation: 'linear',
              points: [
                { beat: 0, value: 0 },
                { beat: 4, value: 0.5 },
                { beat: 8, value: 0.5 },
                { beat: 12, value: 1 }
              ]
            } satisfies AutomationCurve<number>
          }
        }
      ]
    }
  }));
});

describe('timelineActions.updateParamPoints', () => {
  it('applies a multi-point patch in one call', () => {
    useAppStore
      .getState()
      .timelineActions.updateParamPoints(CLIP_ID, 'intensity', [
        { index: 1, beat: 5 },
        { index: 2, beat: 9 },
        { index: 3, beat: 13 }
      ]);
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points.map((p) => p.beat)).toEqual([0, 5, 9, 13]);
  });

  it('re-sorts when a moved point crosses a neighbor', () => {
    useAppStore
      .getState()
      .timelineActions.updateParamPoints(CLIP_ID, 'intensity', [
        { index: 1, beat: 10 }
      ]);
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points.map((p) => p.beat)).toEqual([0, 8, 10, 12]);
  });

  it('accepts partial patches (beat only OR value only)', () => {
    useAppStore
      .getState()
      .timelineActions.updateParamPoints(CLIP_ID, 'intensity', [
        { index: 1, value: 0.8 },
        { index: 2, beat: 10 }
      ]);
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points[1].value).toBe(0.8);
    expect(c.points.map((p) => p.beat)).toEqual([0, 4, 10, 12]);
  });

  it('empty updates array is a no-op (same reference)', () => {
    const before = useAppStore.getState().timeline.clips[0].params!.intensity;
    useAppStore.getState().timelineActions.updateParamPoints(CLIP_ID, 'intensity', []);
    const after = useAppStore.getState().timeline.clips[0].params!.intensity;
    expect(after).toBe(before);
  });
});
