import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';

describe('setClipParam', () => {
  beforeEach(() => {
    useAppStore.setState({
      timeline: {
        tracks: [{ id: 't1', kind: 'pulse', name: 'P', muted: false, order: 0 }],
        clips: [
          {
            id: 'c1',
            trackId: 't1',
            kind: 'pulse',
            fxId: 'pulse',
            startBeat: 0,
            lengthBeats: 4,
            label: 'P',
            params: { intensity: 0.5, color: '#fff' }
          }
        ],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      }
    });
  });

  it('writes a single static key, leaves others alone', () => {
    useAppStore.getState().timelineActions.setClipParam('c1', 'intensity', 0.9);
    const clip = useAppStore.getState().timeline.clips[0];
    expect(clip.params?.intensity).toBe(0.9);
    expect(clip.params?.color).toBe('#fff');
  });

  it('accepts an AutomationCurve as the value', () => {
    const curve = {
      mode: 'automation' as const,
      points: [{ beat: 0, value: 0 }],
      interpolation: 'linear' as const
    };
    useAppStore.getState().timelineActions.setClipParam('c1', 'intensity', curve);
    const clip = useAppStore.getState().timeline.clips[0];
    expect(clip.params?.intensity).toEqual(curve);
  });

  it('no-op on unknown clipId', () => {
    useAppStore.getState().timelineActions.setClipParam('nope', 'intensity', 0);
    const clip = useAppStore.getState().timeline.clips[0];
    expect(clip.params?.intensity).toBe(0.5);
  });
});
