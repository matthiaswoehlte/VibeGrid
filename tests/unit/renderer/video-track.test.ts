import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRenderer } from '@/lib/renderer/loop';
import { _resetBuiltInPluginsForTests, registerBuiltInPlugins } from '@/lib/fx';
import type { TimelineState } from '@/lib/timeline/types';
import { makeMockCtx, grid120 } from './_helpers';

interface CtxCalls {
  __calls: Array<{ method: string; args: unknown[] }>;
}

const VIDEO_TRACK_ID = 'track-video';

function makeTimeline(opts: { muted?: boolean; missingMedia?: boolean } = {}): TimelineState {
  return {
    tracks: [
      { id: VIDEO_TRACK_ID, kind: 'video', name: 'Video', muted: opts.muted ?? false }
    ],
    clips: opts.missingMedia
      ? []
      : [
          {
            id: 'v-clip-1',
            trackId: VIDEO_TRACK_ID,
            kind: 'video',
            mediaId: 'm-v1',
            startBeat: 0,
            lengthBeats: 16,
            label: 'video'
          }
        ],
    playhead: { beats: 0, playing: false },
    zoom: 1,
    snap: 'beat'
  };
}

function makeVideoEl(): HTMLVideoElement {
  // Minimal duck-typed HTMLVideoElement.
  return {
    videoWidth: 1920,
    videoHeight: 1080
  } as unknown as HTMLVideoElement;
}

function makeDeps(overrides: Parameters<typeof createRenderer>[0]) {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = makeMockCtx();
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);
  return { canvas, ctx, deps: { ...overrides, canvas } };
}

beforeEach(() => {
  _resetBuiltInPluginsForTests();
  registerBuiltInPlugins();
});

describe('Renderer — video track rendering (Plan 5.9b)', () => {
  it('draws the video element for an active clip on a video track', () => {
    const timeline = makeTimeline();
    const { canvas, ctx } = makeDeps({
      canvas: document.createElement('canvas'),
      getCurrentTime: () => 0,
      getBeatGrid: () => grid120,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      getVideoElement: () => makeVideoEl()
    });
    const renderer = createRenderer({
      canvas,
      getCurrentTime: () => 0,
      getBeatGrid: () => grid120,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      getVideoElement: () => makeVideoEl()
    });
    renderer.tick();
    const calls = (ctx as unknown as CtxCalls).__calls;
    const drawImage = calls.find((c) => c.method === 'drawImage');
    expect(drawImage).toBeDefined();
  });

  it('skips the video draw when getVideoElement returns null', () => {
    const timeline = makeTimeline();
    const { canvas, ctx } = makeDeps({
      canvas: document.createElement('canvas'),
      getCurrentTime: () => 0,
      getBeatGrid: () => grid120,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      getVideoElement: () => null
    });
    const renderer = createRenderer({
      canvas,
      getCurrentTime: () => 0,
      getBeatGrid: () => grid120,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      getVideoElement: () => null
    });
    renderer.tick();
    const calls = (ctx as unknown as CtxCalls).__calls;
    expect(calls.find((c) => c.method === 'drawImage')).toBeUndefined();
  });

  it('skips muted video tracks entirely', () => {
    const timeline = makeTimeline({ muted: true });
    const { canvas, ctx } = makeDeps({
      canvas: document.createElement('canvas'),
      getCurrentTime: () => 0,
      getBeatGrid: () => grid120,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      getVideoElement: () => makeVideoEl()
    });
    const renderer = createRenderer({
      canvas,
      getCurrentTime: () => 0,
      getBeatGrid: () => grid120,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      getVideoElement: () => makeVideoEl()
    });
    renderer.tick();
    const calls = (ctx as unknown as CtxCalls).__calls;
    expect(calls.find((c) => c.method === 'drawImage')).toBeUndefined();
  });

  it('renderer dep `getVideoElement` is optional — projects without video unchanged', () => {
    // Empty timeline (no video tracks) — renderer ticks without ever
    // touching getVideoElement.
    const timeline: TimelineState = {
      tracks: [],
      clips: [],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    };
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = makeMockCtx();
    vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);
    // Note: NO getVideoElement passed.
    const renderer = createRenderer({
      canvas,
      getCurrentTime: () => 0,
      getBeatGrid: () => grid120,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined
    });
    expect(() => renderer.tick()).not.toThrow();
  });
});
