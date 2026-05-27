import { describe, it, expect, beforeEach } from 'vitest';
import {
  toClipKind,
  formatBpmReference,
  getTimelineEndBeat,
  getProjectBpm,
  getBeatsPerBar
} from '@/lib/presets/store-bridge';
import { useAppStore } from '@/lib/store';

describe('store-bridge', () => {
  beforeEach(() => {
    useAppStore.setState((s) => ({
      timeline: { ...s.timeline, clips: [] }
    }));
  });

  it('toClipKind converts PascalCase fxKind to kebab-case clip.kind', () => {
    expect(toClipKind('ZoomPunch')).toBe('zoom-punch');
    expect(toClipKind('RGBSplit')).toBe('rgb-split');
    expect(toClipKind('GlitchSlice')).toBe('glitch-slice');
    expect(toClipKind('BeatFlash')).toBe('beat-flash');
    expect(toClipKind('Pulse')).toBe('pulse');
  });

  it('formatBpmReference handles "any" and numeric values', () => {
    expect(formatBpmReference('any')).toBe('Any BPM');
    expect(formatBpmReference(128)).toBe('128 BPM');
    expect(formatBpmReference(0)).toBe('0 BPM');
  });

  it('getTimelineEndBeat returns 64 fallback when no media clips', () => {
    expect(getTimelineEndBeat()).toBe(64);
  });

  it('getTimelineEndBeat returns last beat of longest media clip', () => {
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: [
          {
            id: 'audio-1',
            trackId: 'track-audio',
            kind: 'audio',
            startBeat: 0,
            lengthBeats: 32,
            label: 'Audio',
            params: {}
          },
          {
            id: 'video-1',
            trackId: 'track-video',
            kind: 'video',
            startBeat: 8,
            lengthBeats: 24,
            label: 'Video',
            params: {}
          }
        ]
      }
    }));
    // audio-1 ends at 32, video-1 ends at 8+24=32 → max 32.
    expect(getTimelineEndBeat()).toBe(32);
  });

  it('getTimelineEndBeat ignores FX-only clips', () => {
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: [
          {
            id: 'fx-1',
            trackId: 'track-fx-1',
            kind: 'zoom-punch',
            startBeat: 0,
            lengthBeats: 100,
            label: 'ZoomPunch',
            params: {}
          }
        ]
      }
    }));
    expect(getTimelineEndBeat()).toBe(64);
  });

  it('getProjectBpm returns the audio.grid.bpm', () => {
    const bpm = getProjectBpm();
    expect(typeof bpm).toBe('number');
    expect(bpm).toBeGreaterThan(0);
  });

  it('getBeatsPerBar returns audio.grid.beatsPerBar with default 4', () => {
    expect(getBeatsPerBar()).toBe(4);
  });
});
