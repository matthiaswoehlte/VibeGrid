import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRenderer } from '@/lib/renderer/loop';
import { _resetBuiltInPluginsForTests, registerBuiltInPlugins } from '@/lib/fx';
import type { TimelineState } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';
import { makeMockCtx, grid120 } from './_helpers';

function makeDeps(overrides: Partial<Parameters<typeof createRenderer>[0]> = {}) {
  const canvas = document.createElement('canvas');
  const ctx = makeMockCtx();
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);
  const timeline: TimelineState = {
    tracks: [],
    clips: [],
    playhead: { beats: 0, playing: false },
    zoom: 1,
    snap: 'beat'
  };
  return {
    canvas,
    ctx,
    deps: {
      canvas,
      getCurrentTime: () => 0,
      getBeatGrid: (): BeatGrid => grid120,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      ...overrides
    }
  };
}

describe('renderer loop tick', () => {
  beforeEach(() => {
    _resetBuiltInPluginsForTests();
    registerBuiltInPlugins();
  });

  it('paints background and returns early when beats are negative (pre-roll)', () => {
    const { ctx, deps } = makeDeps({
      getCurrentTime: () => 0,
      getBeatGrid: () => ({ ...grid120, offsetMs: 5000 })
    });
    const renderer = createRenderer(deps);
    renderer.tick();
    const calls = (ctx as unknown as { __calls: Array<{ method: string; args: unknown[] }> })
      .__calls;
    // Plan 6: opaque background paint replaces clearRect so MediaRecorder
    // captures a fully-opaque RGB buffer (FX with globalAlpha<1 would
    // otherwise composite against transparent and disappear in the export).
    const fillRects = calls.filter((c) => c.method === 'fillRect');
    expect(fillRects).toHaveLength(1); // background only — no FX painted
    // No image draws either (no clips active during pre-roll).
    expect(calls.find((c) => c.method === 'drawImage')).toBeUndefined();
  });

  it('runs Pulse plugin even with no active image clip', () => {
    const { ctx, deps } = makeDeps({
      getCurrentTime: () => 0,
      getTimelineState: () => ({
        tracks: [{ id: 'tp', kind: 'fx', name: 'p', muted: false, order: 0 }],
        clips: [
          {
            id: 'p1',
            trackId: 'tp',
            kind: 'pulse',
            fxId: 'pulse',
            startBeat: 0,
            lengthBeats: 8,
            label: 'p1'
          }
        ],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      })
    });
    const renderer = createRenderer(deps);
    renderer.tick();
    const calls = (ctx as unknown as { __calls: Array<{ method: string }> }).__calls;
    expect(calls.some((c) => c.method === 'fillRect')).toBe(true);
  });

  it('skips Contour (image-dependent) when no image bitmap is available, but Sweep/Pulse/Particle still render', () => {
    const { ctx, deps } = makeDeps({
      getCurrentTime: () => 0,
      getTimelineState: () => ({
        tracks: [
          { id: 'ti', kind: 'image', name: 'i', muted: false, order: 0 },
          { id: 'tc', kind: 'fx', name: 'c', muted: false, order: 1 },
          { id: 'ts', kind: 'fx', name: 's', muted: false, order: 2 }
        ],
        clips: [
          {
            id: 'img',
            trackId: 'ti',
            kind: 'image',
            mediaId: 'm1',
            startBeat: 0,
            lengthBeats: 8,
            label: 'img'
          },
          {
            id: 'c1',
            trackId: 'tc',
            kind: 'contour',
            fxId: 'contour',
            startBeat: 0,
            lengthBeats: 8,
            label: 'c1'
          },
          {
            id: 's1',
            trackId: 'ts',
            kind: 'sweep',
            fxId: 'sweep',
            startBeat: 0,
            lengthBeats: 8,
            label: 's1'
          }
        ],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      })
    });
    const renderer = createRenderer(deps);
    renderer.tick();
    // Sweep paints a radial gradient → it ran (used to be skipped pre-fix).
    const gradSpy = ctx.createRadialGradient as unknown as { mock: { calls: unknown[] } };
    expect(gradSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it('skips muted FX tracks', () => {
    const { ctx, deps } = makeDeps({
      getTimelineState: () => ({
        tracks: [{ id: 'tp', kind: 'fx', name: 'p', muted: true, order: 0 }],
        clips: [
          {
            id: 'p1',
            trackId: 'tp',
            kind: 'pulse',
            fxId: 'pulse',
            startBeat: 0,
            lengthBeats: 8,
            label: 'p1'
          }
        ],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      })
    });
    const renderer = createRenderer(deps);
    renderer.tick();
    const calls = (ctx as unknown as { __calls: Array<{ method: string; args: unknown[] }> })
      .__calls;
    // Plan 6: there's always ONE background fillRect per tick. Pulse would
    // add a SECOND one for the flash overlay — assert exactly the background
    // call survives when the track is muted.
    const fillRects = calls.filter((c) => c.method === 'fillRect');
    expect(fillRects).toHaveLength(1);
  });

  it('dispatches to Particles plugin (Particle ≠ particles guard)', () => {
    // Regression guard: kind.toLowerCase() would map 'Particle' → 'particle',
    // but the timeline slice key is 'particles'. Without KIND_TO_TRACK_KIND,
    // particles clips would silently never render.
    // Particles plugin requires an image bitmap (only Pulse is exempt per spec §4),
    // so we supply one via getImageBitmap.
    const bitmap = { width: 100, height: 100, close: vi.fn() } as unknown as ImageBitmap;
    const { ctx, deps } = makeDeps({
      getCurrentTime: () => 0,
      getImageBitmap: () => bitmap,
      getTimelineState: () => ({
        tracks: [
          { id: 'ti', kind: 'image', name: 'i', muted: false, order: 0 },
          { id: 'tpa', kind: 'fx', name: 'pa', muted: false, order: 1 }
        ],
        clips: [
          {
            id: 'img',
            trackId: 'ti',
            kind: 'image',
            mediaId: 'm1',
            startBeat: 0,
            lengthBeats: 8,
            label: 'img'
          },
          {
            id: 'pa1',
            trackId: 'tpa',
            kind: 'particles',
            fxId: 'particles',
            startBeat: 0,
            lengthBeats: 8,
            label: 'pa1'
          }
        ],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      })
    });
    const renderer = createRenderer(deps);
    renderer.tick();
    const calls = (ctx as unknown as { __calls: Array<{ method: string }> }).__calls;
    expect(calls.some((c) => c.method === 'arc')).toBe(true);
  });

  // Plan 8d regression — Transfer-to-Timeline puts video clips on a
  // `main-video` TRACK (with `clip.kind: 'video'`). An earlier version
  // of the loop only treated `track.kind === 'video'` as a video lane,
  // so transferred SceneFlow clips were loaded by useVideoEngine but
  // never drawn. This regression test guards against re-introducing
  // that gap.
  it('renders video clips on a main-video track (Plan 8d singleton)', () => {
    const videoEl = {
      readyState: 4,
      videoWidth: 1920,
      videoHeight: 1080
    } as unknown as HTMLVideoElement;
    const { ctx, deps } = makeDeps({
      getCurrentTime: () => 0,
      getVideoElement: () => videoEl,
      getTimelineState: () => ({
        tracks: [
          { id: 'tmv', kind: 'main-video', name: 'Main Video', muted: false, order: 0 }
        ],
        clips: [
          {
            id: 'mv1',
            trackId: 'tmv',
            kind: 'video',
            mediaId: 'scene-1',
            startBeat: 0,
            lengthBeats: 8,
            label: 'Szene 1'
          }
        ],
        playhead: { beats: 0, playing: true },
        zoom: 1,
        snap: 'beat'
      })
    });
    const renderer = createRenderer(deps);
    renderer.tick();
    const calls = (ctx as unknown as {
      __calls: Array<{ method: string; args: unknown[] }>;
    }).__calls;
    const drawCalls = calls.filter((c) => c.method === 'drawImage');
    expect(drawCalls.length).toBeGreaterThan(0);
    // First drawImage must be the video element — not the background paint.
    expect(drawCalls[0].args[0]).toBe(videoEl);
  });

  it('skips main-video track when its single clip is outside the playhead', () => {
    const videoEl = { readyState: 4 } as unknown as HTMLVideoElement;
    const { ctx, deps } = makeDeps({
      getCurrentTime: () => 0,
      getVideoElement: () => videoEl,
      getTimelineState: () => ({
        tracks: [
          { id: 'tmv', kind: 'main-video', name: 'Main Video', muted: false, order: 0 }
        ],
        clips: [
          {
            // Clip starts at beat 100 — playhead at beat 0 → inactive.
            id: 'mv1',
            trackId: 'tmv',
            kind: 'video',
            mediaId: 'scene-1',
            startBeat: 100,
            lengthBeats: 8,
            label: 'Szene 1'
          }
        ],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      })
    });
    const renderer = createRenderer(deps);
    renderer.tick();
    const calls = (ctx as unknown as {
      __calls: Array<{ method: string; args: unknown[] }>;
    }).__calls;
    // Background paint, no drawImage.
    expect(calls.find((c) => c.method === 'drawImage')).toBeUndefined();
  });
});
