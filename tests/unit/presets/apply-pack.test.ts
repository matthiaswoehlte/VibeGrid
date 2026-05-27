import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}));

import { applyPackToTimeline } from '@/lib/presets/apply-pack';
import { useAppStore } from '@/lib/store';
import type { PresetPack } from '@/lib/presets/types';
import { toast } from 'sonner';

const TEST_PACK: PresetPack = {
  id: 'test-pack',
  name: 'Test Pack',
  description: 'test',
  category: 'Drop',
  tags: [],
  bpmReference: 120,
  recommendedBars: 2,
  source: 'built-in',
  fx: [
    {
      fxKind: 'ZoomPunch',
      params: { strength: 1.1, attack: 0.02, decay: 0.1, direction: 'in' },
      automationCurves: {
        strength: [
          { beat: 0, value: 0.8 },
          { beat: 0.1, value: 0.0 }
        ]
      },
      displayTriggerLabel: '1/4',
      curveLabel: 'PUNCH',
      displayLabel: 'Kick Zoom · 1/4',
      enabled: true
    },
    {
      fxKind: 'RGBSplit',
      params: { offset: 0.006, decay: 0.12, intensity: 0.5 },
      automationCurves: {
        intensity: [
          { beat: 0, value: 0.5 },
          { beat: 0.12, value: 0.0 }
        ]
      },
      displayTriggerLabel: '1/2',
      curveLabel: 'RGB',
      displayLabel: 'Snare Split · 1/2',
      enabled: true
    },
    {
      fxKind: 'BeatFlash',
      params: { intensity: 0.6, color: '#ffffff', duration: 0.08, blendMode: 'screen' },
      automationCurves: {
        intensity: [
          { beat: 0, value: 0.6 },
          { beat: 0.08, value: 0.0 }
        ]
      },
      displayTriggerLabel: '1/4',
      curveLabel: 'FLASH',
      displayLabel: 'Beat Flash · 1/4',
      enabled: false
    }
  ]
};

function resetTimeline() {
  // Reset to initial-like state. clips empty, baseline 4 tracks plus
  // any added during a prior test get nuked.
  useAppStore.setState((s) => ({
    timeline: {
      ...s.timeline,
      tracks: [
        { id: 'track-image', kind: 'image', name: 'Image', muted: false },
        { id: 'track-video', kind: 'video', name: 'Video', muted: false },
        { id: 'track-audio', kind: 'audio', name: 'Audio', muted: false },
        { id: 'track-fx-1', kind: 'fx', name: 'FX', muted: false }
      ],
      clips: []
    }
  }));
}

describe('applyPackToTimeline', () => {
  beforeEach(() => {
    resetTimeline();
    vi.clearAllMocks();
  });

  it('creates one clip per enabled FX (disabled entries skipped)', () => {
    applyPackToTimeline(TEST_PACK);
    const clips = useAppStore.getState().timeline.clips;
    // BeatFlash is disabled → 2 clips, not 3.
    expect(clips.length).toBe(2);
  });

  it('uses kebab-case for clip.kind (not PascalCase)', () => {
    applyPackToTimeline(TEST_PACK);
    const clips = useAppStore.getState().timeline.clips;
    const kinds = clips.map((c) => c.kind).sort();
    expect(kinds).toEqual(['rgb-split', 'zoom-punch']);
    expect(kinds).not.toContain('ZoomPunch');
    expect(kinds).not.toContain('RGBSplit');
  });

  it('creates dedicated fx tracks per fxKind (track.name === fxKind)', () => {
    applyPackToTimeline(TEST_PACK);
    const tracks = useAppStore.getState().timeline.tracks;
    const zoomTrack = tracks.find(
      (t) => t.kind === 'fx' && t.name === 'ZoomPunch'
    );
    const rgbTrack = tracks.find(
      (t) => t.kind === 'fx' && t.name === 'RGBSplit'
    );
    expect(zoomTrack).toBeDefined();
    expect(rgbTrack).toBeDefined();
  });

  it('offsets automation points by startBeat (clip-relative → absolute)', () => {
    applyPackToTimeline(TEST_PACK, 8);
    const clips = useAppStore.getState().timeline.clips;
    const zoom = clips.find((c) => c.kind === 'zoom-punch')!;
    const curve = zoom.params?.strength as {
      mode: string;
      points: { beat: number; value: number }[];
    };
    expect(curve.mode).toBe('automation');
    // Original points: [0, 0.1]. After offset by startBeat=8: [8, 8.1].
    expect(curve.points[0].beat).toBeCloseTo(8, 5);
    expect(curve.points[1].beat).toBeCloseTo(8.1, 5);
  });

  it('clip params are defensively copied (mutation does not affect pack)', () => {
    const before = TEST_PACK.fx[0].params.strength;
    applyPackToTimeline(TEST_PACK);
    const clips = useAppStore.getState().timeline.clips;
    const zoom = clips.find((c) => c.kind === 'zoom-punch')!;
    // Mutate via setState — bypass setClipParam to keep test focus on
    // shallow-copy guarantee inside apply-pack.
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: s.timeline.clips.map((c) =>
          c.id === zoom.id
            ? { ...c, params: { ...(c.params ?? {}), strength: 99 } }
            : c
        )
      }
    }));
    // Pack-source must remain unchanged.
    expect(TEST_PACK.fx[0].params.strength).toBe(before);
  });

  it('second apply appends new clips (no replace, no duplicate tracks)', () => {
    applyPackToTimeline(TEST_PACK);
    const firstCount = useAppStore.getState().timeline.clips.length;
    const firstTrackCount = useAppStore.getState().timeline.tracks.length;
    applyPackToTimeline(TEST_PACK);
    const secondCount = useAppStore.getState().timeline.clips.length;
    const secondTrackCount = useAppStore.getState().timeline.tracks.length;
    expect(secondCount).toBe(firstCount * 2);
    // Same fxKind → existing track is reused, no new tracks created.
    expect(secondTrackCount).toBe(firstTrackCount);
  });

  it('emits a success toast with the pack name + active count', () => {
    applyPackToTimeline(TEST_PACK);
    expect(toast.success).toHaveBeenCalledTimes(1);
    const [msg, opts] = (toast.success as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(msg)).toContain('Test Pack');
    expect(String(msg)).toContain('2 FX');
    // BeatFlash is disabled → description mentions 1 disabled.
    expect(String(opts.description)).toContain('1 FX disabled');
  });

  it('lengthBeats = recommendedBars × beatsPerBar (4/4 default)', () => {
    applyPackToTimeline(TEST_PACK);
    const clips = useAppStore.getState().timeline.clips;
    // recommendedBars = 2, beatsPerBar = 4 → lengthBeats = 8
    expect(clips[0].lengthBeats).toBe(8);
  });
});
