import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { isAutomationCurve } from '@/lib/automation/resolve';
import { BLEND_KEY } from '@/lib/timeline/blend';
import type { AutomationCurve } from '@/lib/automation/types';
import type { Clip } from '@/lib/timeline/types';

const mkClip = (id: string, start: number, length: number): Clip => ({
  id,
  trackId: 'track-pulse',
  kind: 'pulse',
  fxId: 'pulse',
  startBeat: start,
  lengthBeats: length,
  label: id
});

beforeEach(() => {
  useAppStore.setState((s) => ({
    timeline: { ...s.timeline, clips: [] }
  }));
});

describe('blend lifecycle — addClip', () => {
  it('adds a default __blend when the new clip overlaps an existing one', () => {
    useAppStore.getState().timelineActions.addClip(mkClip('a', 0, 8));
    useAppStore.getState().timelineActions.addClip(mkClip('b', 6, 8));
    const b = useAppStore.getState().timeline.clips.find((c) => c.id === 'b')!;
    const blend = b.params?.[BLEND_KEY];
    expect(isAutomationCurve(blend)).toBe(true);
    const curve = blend as AutomationCurve<number>;
    expect(curve.interpolation).toBe('linear');
    expect(curve.points).toEqual([
      { beat: 6, value: 0 },
      { beat: 8, value: 1 }
    ]);
  });

  it('does NOT add __blend when there is no overlap', () => {
    useAppStore.getState().timelineActions.addClip(mkClip('a', 0, 4));
    useAppStore.getState().timelineActions.addClip(mkClip('b', 8, 4));
    const b = useAppStore.getState().timeline.clips.find((c) => c.id === 'b')!;
    expect(b.params?.[BLEND_KEY]).toBeUndefined();
  });
});

describe('blend lifecycle — moveClip', () => {
  beforeEach(() => {
    useAppStore.getState().timelineActions.addClip(mkClip('a', 0, 8));
    useAppStore.getState().timelineActions.addClip(mkClip('b', 10, 4));
  });

  it('creates __blend when moving the clip into an overlap', () => {
    useAppStore.getState().timelineActions.moveClip('b', 6);
    const b = useAppStore.getState().timeline.clips.find((c) => c.id === 'b')!;
    expect(isAutomationCurve(b.params?.[BLEND_KEY])).toBe(true);
  });

  it('clears __blend when moving the clip out of overlap', () => {
    useAppStore.getState().timelineActions.moveClip('b', 6);
    useAppStore.getState().timelineActions.moveClip('b', 20);
    const b = useAppStore.getState().timeline.clips.find((c) => c.id === 'b')!;
    expect(b.params?.[BLEND_KEY]).toBeUndefined();
  });
});

describe('blend lifecycle — setBlendInterpolation + regenerate preservation', () => {
  beforeEach(() => {
    useAppStore.getState().timelineActions.addClip(mkClip('a', 0, 8));
    useAppStore.getState().timelineActions.addClip(mkClip('b', 6, 8));
    useAppStore.getState().timelineActions.setBlendInterpolation('b', 'easeOut');
  });

  it('preserves previously-set interpolation across a range change', () => {
    useAppStore.getState().timelineActions.moveClip('b', 5);
    const b = useAppStore.getState().timeline.clips.find((c) => c.id === 'b')!;
    const curve = b.params?.[BLEND_KEY] as AutomationCurve<number>;
    expect(curve.interpolation).toBe('easeOut');
    expect(curve.points[0].beat).toBe(5);
    expect(curve.points[1].beat).toBe(8);
  });
});

describe('blend lifecycle — removeClip', () => {
  it("clears the successor's __blend when the predecessor is removed", () => {
    useAppStore.getState().timelineActions.addClip(mkClip('a', 0, 8));
    useAppStore.getState().timelineActions.addClip(mkClip('b', 6, 4));
    useAppStore.getState().timelineActions.removeClip('a');
    const b = useAppStore.getState().timeline.clips.find((c) => c.id === 'b')!;
    expect(b.params?.[BLEND_KEY]).toBeUndefined();
  });
});

describe('blend lifecycle — cross-kind overlap on fx tracks (Plan 5.9c)', () => {
  it('existing __blend is removed when the overlap is cross-kind', () => {
    // Seed: pulse + contour on the same fx track, overlapping.
    // The pulse clip carries a stale __blend from when it overlapped
    // another pulse clip that's since been removed.
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: [
          {
            id: 'cross-pulse',
            trackId: 'track-fx-1',
            kind: 'pulse',
            fxId: 'pulse',
            startBeat: 0,
            lengthBeats: 8,
            label: 'pulse',
            params: {
              [BLEND_KEY]: {
                type: 'curve',
                interpolation: 'linear',
                points: [
                  { beat: 4, value: 0 },
                  { beat: 8, value: 1 }
                ]
              }
            }
          },
          {
            id: 'cross-contour',
            trackId: 'track-fx-1',
            kind: 'contour',
            fxId: 'contour',
            startBeat: 4,
            lengthBeats: 8,
            label: 'contour'
          }
        ] as Clip[]
      }
    }));
    // Touch the track via any operation that triggers regeneration —
    // moveClip on the contour clip suffices.
    useAppStore.getState().timelineActions.moveClip('cross-contour', 5);
    const contour = useAppStore.getState().timeline.clips.find((c) => c.id === 'cross-contour')!;
    expect(contour.params?.[BLEND_KEY]).toBeUndefined();
    // The pulse clip's stale __blend has also been cleared because the
    // walk re-evaluates EVERY clip on the affected track.
    const pulse = useAppStore.getState().timeline.clips.find((c) => c.id === 'cross-pulse')!;
    expect(pulse.params?.[BLEND_KEY]).toBeUndefined();
  });
});
