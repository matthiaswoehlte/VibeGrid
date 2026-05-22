import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRenderer } from '@/lib/renderer/loop';
import { _resetBuiltInPluginsForTests, registerBuiltInPlugins } from '@/lib/fx';
import type { TimelineState } from '@/lib/timeline/types';
import { makeMockCtx, grid120 } from './_helpers';

/**
 * Plan 5.9d Task 4 — per-frame `rampClipVolume` for active audio clips.
 *
 * The renderer's tick walks every audio clip in the timeline whose
 * beat-window contains the current playhead beat, resolves
 * `params.volume` (static or automation curve), and pushes the value
 * to the engine via the `rampClipVolume` dep. The engine schedules a
 * linear ramp from the previous gain to the new value over the next
 * frame (~16.7 ms at 60 fps).
 */

const AUDIO_TRACK_ID = 'track-audio';

function timelineWithAudioClip(clipOver: Partial<{
  volume: unknown;
  startBeat: number;
  lengthBeats: number;
}> = {}): TimelineState {
  return {
    tracks: [
      { id: AUDIO_TRACK_ID, kind: 'audio', name: 'Audio', muted: false }
    ],
    clips: [
      {
        id: 'c-a',
        trackId: AUDIO_TRACK_ID,
        kind: 'audio',
        mediaId: 'm-1',
        startBeat: clipOver.startBeat ?? 0,
        lengthBeats: clipOver.lengthBeats ?? 16,
        label: 'a',
        params: clipOver.volume !== undefined ? { volume: clipOver.volume } : undefined
      }
    ],
    playhead: { beats: 0, playing: false },
    zoom: 1,
    snap: 'beat'
  };
}

function makeRendererDeps(over: Partial<Parameters<typeof createRenderer>[0]> = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = makeMockCtx();
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);
  return {
    canvas,
    getCurrentTime: () => 0,
    getBeatGrid: () => grid120,
    getTimelineState: () => timelineWithAudioClip(),
    getImageBitmap: () => undefined,
    ...over
  } as Parameters<typeof createRenderer>[0];
}

beforeEach(() => {
  _resetBuiltInPluginsForTests();
  registerBuiltInPlugins();
});

describe('Renderer — audio clip volume ramp (Plan 5.9d)', () => {
  it('rampClipVolume called per tick with resolved static volume', () => {
    const rampSpy = vi.fn();
    const deps = makeRendererDeps({
      getTimelineState: () => timelineWithAudioClip({ volume: 0.42 }),
      rampClipVolume: rampSpy,
      getAudioContextTime: () => 0
    });
    const renderer = createRenderer(deps);
    renderer.tick();
    expect(rampSpy).toHaveBeenCalledWith('c-a', 0.42, expect.any(Number));
  });

  it('volume defaults to 1.0 when `clip.params.volume` is absent', () => {
    const rampSpy = vi.fn();
    const deps = makeRendererDeps({
      getTimelineState: () => timelineWithAudioClip(), // no volume param
      rampClipVolume: rampSpy,
      getAudioContextTime: () => 0
    });
    const renderer = createRenderer(deps);
    renderer.tick();
    expect(rampSpy).toHaveBeenCalledWith('c-a', 1.0, expect.any(Number));
  });

  it('clip outside the beat window is NOT ramped', () => {
    const rampSpy = vi.fn();
    const deps = makeRendererDeps({
      // Clip 0..4, current beat 100 → past end.
      getCurrentTime: () => 50, // 50 sec @ 120 BPM = 100 beats
      getTimelineState: () => timelineWithAudioClip({ startBeat: 0, lengthBeats: 4 }),
      rampClipVolume: rampSpy,
      getAudioContextTime: () => 0
    });
    const renderer = createRenderer(deps);
    renderer.tick();
    expect(rampSpy).not.toHaveBeenCalled();
  });

  it('no rampClipVolume dep → no-op (back-compat with renderer-only callers)', () => {
    // Build deps WITHOUT rampClipVolume / getAudioContextTime — the
    // existing offline render path doesn't wire audio. Renderer tick
    // must not throw.
    const deps = makeRendererDeps({
      getTimelineState: () => timelineWithAudioClip({ volume: 0.5 })
    });
    const renderer = createRenderer(deps);
    expect(() => renderer.tick()).not.toThrow();
  });
});

describe('Renderer — video-audio toggle (Plan 5.9d)', () => {
  function videoTimeline(audioEnabled: boolean | undefined): TimelineState {
    return {
      tracks: [
        { id: 'track-video', kind: 'video', name: 'Video', muted: false }
      ],
      clips: [
        {
          id: 'v1',
          trackId: 'track-video',
          kind: 'video',
          mediaId: 'm-v1',
          startBeat: 0,
          lengthBeats: 16,
          label: 'video',
          ...(audioEnabled !== undefined ? { params: { audioEnabled } } : {})
        }
      ],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    };
  }

  function fakeVideoEl(): HTMLVideoElement {
    return {
      videoWidth: 1920,
      videoHeight: 1080,
      muted: false // start un-muted to detect the renderer's set
    } as unknown as HTMLVideoElement;
  }

  it('audioEnabled=true → videoEl.muted = false', () => {
    const el = fakeVideoEl();
    const deps = makeRendererDeps({
      getTimelineState: () => videoTimeline(true),
      getVideoElement: () => el
    });
    const renderer = createRenderer(deps);
    renderer.tick();
    expect(el.muted).toBe(false);
  });

  it('audioEnabled absent (default) → videoEl.muted = true', () => {
    const el = fakeVideoEl();
    const deps = makeRendererDeps({
      getTimelineState: () => videoTimeline(undefined),
      getVideoElement: () => el
    });
    const renderer = createRenderer(deps);
    renderer.tick();
    expect(el.muted).toBe(true);
  });
});
