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

  it('clears the canvas and returns early when beats are negative (pre-roll)', () => {
    const { ctx, deps } = makeDeps({
      getCurrentTime: () => 0,
      getBeatGrid: () => ({ ...grid120, offsetMs: 5000 })
    });
    const renderer = createRenderer(deps);
    renderer.tick();
    const calls = (ctx as unknown as { __calls: Array<{ method: string }> }).__calls;
    expect(calls.some((c) => c.method === 'clearRect')).toBe(true);
    expect(calls.find((c) => c.method === 'fillRect')).toBeUndefined();
  });

  it('runs Pulse plugin even with no active image clip', () => {
    const { ctx, deps } = makeDeps({
      getCurrentTime: () => 0,
      getTimelineState: () => ({
        tracks: [{ id: 'tp', kind: 'pulse', name: 'p', muted: false, order: 0 }],
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

  it('skips non-Pulse plugins when no image bitmap is available', () => {
    const { ctx, deps } = makeDeps({
      getCurrentTime: () => 0,
      getTimelineState: () => ({
        tracks: [
          { id: 'ti', kind: 'image', name: 'i', muted: false, order: 0 },
          { id: 'ts', kind: 'sweep', name: 's', muted: false, order: 1 }
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
    const gradSpy = ctx.createRadialGradient as unknown as { mock: { calls: unknown[] } };
    expect(gradSpy.mock.calls.length).toBe(0);
  });

  it('skips muted FX tracks', () => {
    const { ctx, deps } = makeDeps({
      getTimelineState: () => ({
        tracks: [{ id: 'tp', kind: 'pulse', name: 'p', muted: true, order: 0 }],
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
    expect(calls.find((c) => c.method === 'fillRect')).toBeUndefined();
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
          { id: 'tpa', kind: 'particles', name: 'pa', muted: false, order: 1 }
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
});
