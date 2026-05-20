import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { isAutomationCurve } from '@/lib/automation/resolve';
import type { AutomationCurve } from '@/lib/automation/types';

const CLIP_ID = 'clip-auto-1';

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
          lengthBeats: 8,
          label: 'Pulse',
          params: { intensity: 0.5, color: '#ff00ff' }
        }
      ]
    }
  }));
});

describe('timelineActions — convertParamToAutomation', () => {
  it('wraps a static value as a single-point linear curve at beat 0', () => {
    useAppStore.getState().timelineActions.convertParamToAutomation(CLIP_ID, 'intensity', 0);
    const v = useAppStore.getState().timeline.clips[0].params!.intensity;
    expect(isAutomationCurve(v)).toBe(true);
    const c = v as AutomationCurve<number>;
    expect(c.interpolation).toBe('linear');
    expect(c.points).toEqual([{ beat: 0, value: 0.5 }]);
  });

  it('is a no-op if param is already automation', () => {
    useAppStore.getState().timelineActions.convertParamToAutomation(CLIP_ID, 'intensity', 0);
    const before = useAppStore.getState().timeline.clips[0].params!.intensity;
    useAppStore.getState().timelineActions.convertParamToAutomation(CLIP_ID, 'intensity', 0);
    const after = useAppStore.getState().timeline.clips[0].params!.intensity;
    expect(after).toBe(before);
  });

  it('is a no-op on unknown clip', () => {
    const before = useAppStore.getState().timeline.clips[0];
    useAppStore
      .getState()
      .timelineActions.convertParamToAutomation('does-not-exist', 'intensity', 0);
    expect(useAppStore.getState().timeline.clips[0]).toBe(before);
  });
});

describe('timelineActions — convertParamToStatic', () => {
  it('extracts points[0].value back to a plain value', () => {
    useAppStore.getState().timelineActions.convertParamToAutomation(CLIP_ID, 'intensity', 0);
    useAppStore.getState().timelineActions.convertParamToStatic(CLIP_ID, 'intensity');
    expect(useAppStore.getState().timeline.clips[0].params!.intensity).toBe(0.5);
  });

  it('is a no-op if param is already static', () => {
    const before = useAppStore.getState().timeline.clips[0];
    useAppStore.getState().timelineActions.convertParamToStatic(CLIP_ID, 'intensity');
    expect(useAppStore.getState().timeline.clips[0]).toBe(before);
  });
});

describe('timelineActions — point operations', () => {
  beforeEach(() => {
    useAppStore.getState().timelineActions.convertParamToAutomation(CLIP_ID, 'intensity', 0);
  });

  it('addParamPoint inserts a sorted point', () => {
    useAppStore
      .getState()
      .timelineActions.addParamPoint(CLIP_ID, 'intensity', { beat: 4, value: 1 });
    const c = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(c.points.map((p) => p.beat)).toEqual([0, 4]);
  });

  it('removeParamPoint drops by index', () => {
    useAppStore
      .getState()
      .timelineActions.addParamPoint(CLIP_ID, 'intensity', { beat: 4, value: 1 });
    useAppStore.getState().timelineActions.removeParamPoint(CLIP_ID, 'intensity', 0);
    const c = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(c.points.map((p) => p.beat)).toEqual([4]);
  });

  it('updateParamPoint moves a point and re-sorts', () => {
    useAppStore
      .getState()
      .timelineActions.addParamPoint(CLIP_ID, 'intensity', { beat: 4, value: 1 });
    useAppStore
      .getState()
      .timelineActions.updateParamPoint(CLIP_ID, 'intensity', 0, { beat: 6 });
    const c = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(c.points.map((p) => p.beat)).toEqual([4, 6]);
  });

  it('setParamInterpolation switches mode', () => {
    useAppStore
      .getState()
      .timelineActions.setParamInterpolation(CLIP_ID, 'intensity', 'easeOut');
    const c = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(c.interpolation).toBe('easeOut');
  });

  it('all point ops are no-ops on missing clip or non-automation param', () => {
    const before = useAppStore.getState().timeline.clips[0];
    useAppStore
      .getState()
      .timelineActions.addParamPoint(CLIP_ID, 'color', { beat: 0, value: '#fff' });
    useAppStore.getState().timelineActions.removeParamPoint('nope', 'intensity', 0);
    useAppStore.getState().timelineActions.updateParamPoint('nope', 'intensity', 0, { beat: 1 });
    useAppStore.getState().timelineActions.setParamInterpolation('nope', 'intensity', 'step');
    expect(useAppStore.getState().timeline.clips[0].params!.intensity).toEqual(
      before.params!.intensity
    );
  });
});
