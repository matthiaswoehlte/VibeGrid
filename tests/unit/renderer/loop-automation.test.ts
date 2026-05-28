import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRenderer } from '@/lib/renderer/loop';
import { register, _resetRegistryForTests } from '@/lib/renderer/registry';
import { _resetBuiltInPluginsForTests } from '@/lib/fx';
import type { FxPlugin } from '@/lib/renderer/types';
import type { TimelineState } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 100;
  c.height = 100;
  // jsdom has no canvas backend — spy a minimal 2D context that the renderer
  // calls into (clearRect, drawImage are the only required methods for our
  // probe plugin which just captures params).
  const stubCtx = {
    clearRect: () => {},
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    fillRect: () => {},
    setTransform: () => {},
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } as DOMMatrix),
    globalAlpha: 1,
    fillStyle: '#000'
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(c, 'getContext').mockReturnValue(stubCtx as unknown as RenderingContext);
  return c;
}

const grid: BeatGrid = { bpm: 60, offsetMs: 0, beatsPerBar: 4, source: 'manual' };

describe('renderer — automation curve in clip.params', () => {
  let captured: Record<string, unknown> | null;
  let probe: FxPlugin<Record<string, unknown>>;

  beforeEach(() => {
    _resetBuiltInPluginsForTests();
    _resetRegistryForTests();
    captured = null;
    probe = {
      id: 'probe',
      name: 'Probe',
      kind: 'Pulse',
      defaultTrigger: 'beat',
      preloadState: 'ready',
      paramSchema: {
        intensity: { kind: 'slider', min: 0, max: 1, step: 0.05, default: 0, label: 'I' }
      },
      getDefaultParams: () => ({ intensity: 0 }),
      async preload() {},
      render(_rc, params) {
        captured = params;
      }
    };
    register(probe);
  });

  it('linearly interpolates an automation curve at the current beat', () => {
    const timeline: TimelineState = {
      tracks: [{ id: 't1', kind: 'fx', name: 'P', muted: false, order: 0 }],
      clips: [
        {
          id: 'c1',
          trackId: 't1',
          kind: 'pulse',
          fxId: 'probe',
          startBeat: 0,
          lengthBeats: 16,
          label: 'P',
          params: {
            intensity: {
              mode: 'automation',
              points: [
                { beat: 0, value: 0 },
                { beat: 4, value: 1 }
              ],
              interpolation: 'linear'
            }
          }
        }
      ],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    };
    const currentTime = 2; // at 60 bpm → beat 2
    const renderer = createRenderer({
      canvas: makeCanvas(),
      getCurrentTime: () => currentTime,
      getBeatGrid: () => grid,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      rafCallback: () => 0,
      cancelRafCallback: () => undefined
    });
    renderer.tick();
    expect(captured).not.toBeNull();
    expect((captured as { intensity: number }).intensity).toBeCloseTo(0.5);
  });

  it('passes static params unchanged (passthrough)', () => {
    const timeline: TimelineState = {
      tracks: [{ id: 't1', kind: 'fx', name: 'P', muted: false, order: 0 }],
      clips: [
        {
          id: 'c1',
          trackId: 't1',
          kind: 'pulse',
          fxId: 'probe',
          startBeat: 0,
          lengthBeats: 16,
          label: 'P',
          params: { intensity: 0.42 }
        }
      ],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    };
    const renderer = createRenderer({
      canvas: makeCanvas(),
      getCurrentTime: () => 0,
      getBeatGrid: () => grid,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      rafCallback: () => 0,
      cancelRafCallback: () => undefined
    });
    renderer.tick();
    expect((captured as { intensity: number }).intensity).toBe(0.42);
  });

  it('uses plugin defaults when clip.params is absent', () => {
    const timeline: TimelineState = {
      tracks: [{ id: 't1', kind: 'fx', name: 'P', muted: false, order: 0 }],
      clips: [
        {
          id: 'c1',
          trackId: 't1',
          kind: 'pulse',
          fxId: 'probe',
          startBeat: 0,
          lengthBeats: 16,
          label: 'P'
        }
      ],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    };
    const renderer = createRenderer({
      canvas: makeCanvas(),
      getCurrentTime: () => 0,
      getBeatGrid: () => grid,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      rafCallback: () => 0,
      cancelRafCallback: () => undefined
    });
    renderer.tick();
    expect((captured as { intensity: number }).intensity).toBe(0);
  });

  // Plan 8g.X — per-clip Flow Mode via beatSync<0.5. AutomationCurveEditor
  // stores points in CLIP-RELATIVE beats (X-axis = clip.lengthBeats). When
  // beatSync is unset / >= 0.5, the resolver uses absolute beats and the
  // curves resolve incorrectly (points all "past" the lookup → constant
  // value). When beatSync < 0.5, the loop treats this clip's automation
  // like global Flow Mode: paramBeat is clip-relative AND the curve is
  // stretched over the clip length. Lets users drive an FX as a
  // continuous look from a multi-point curve.
  it('per-clip Flow Mode: beatSync<0.5 evaluates curve clip-relative', () => {
    const timeline: TimelineState = {
      tracks: [{ id: 't1', kind: 'fx', name: 'P', muted: false, order: 0 }],
      clips: [
        {
          id: 'c1',
          trackId: 't1',
          kind: 'pulse',
          fxId: 'probe',
          startBeat: 100,    // clip starts far past curve point range
          lengthBeats: 10,   // 0..10 clip-relative
          label: 'P',
          params: {
            beatSync: 0,     // < 0.5 → per-clip flow on
            intensity: {
              mode: 'automation',
              points: [
                { beat: 0, value: 0 },
                { beat: 10, value: 1 }
              ],
              interpolation: 'linear'
            }
          }
        }
      ],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    };
    // currentTime = 105s → absolute beat 105 (= clip-relative 5, halfway).
    // Expected: intensity stretched halfway between 0 and 1 = 0.5
    const renderer = createRenderer({
      canvas: makeCanvas(),
      getCurrentTime: () => 105,
      getBeatGrid: () => grid,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      rafCallback: () => 0,
      cancelRafCallback: () => undefined
    });
    renderer.tick();
    expect((captured as { intensity: number }).intensity).toBeCloseTo(0.5);
  });

  it('per-clip Flow Mode OFF: beatSync>=0.5 keeps absolute-beat resolution', () => {
    // Same clip setup as above but beatSync=1. With absolute beats at 105
    // and last point at beat 10, the resolver returns the last point's
    // value (1.0) — current/legacy behavior, preserved.
    const timeline: TimelineState = {
      tracks: [{ id: 't1', kind: 'fx', name: 'P', muted: false, order: 0 }],
      clips: [
        {
          id: 'c1',
          trackId: 't1',
          kind: 'pulse',
          fxId: 'probe',
          startBeat: 100,
          lengthBeats: 10,
          label: 'P',
          params: {
            beatSync: 1,
            intensity: {
              mode: 'automation',
              points: [
                { beat: 0, value: 0 },
                { beat: 10, value: 1 }
              ],
              interpolation: 'linear'
            }
          }
        }
      ],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    };
    const renderer = createRenderer({
      canvas: makeCanvas(),
      getCurrentTime: () => 105,
      getBeatGrid: () => grid,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      rafCallback: () => 0,
      cancelRafCallback: () => undefined
    });
    renderer.tick();
    // Lookup at absolute beat 105 >= last curve point's beat (10) → last value.
    expect((captured as { intensity: number }).intensity).toBe(1);
  });

  it('per-clip Flow Mode: FX without beatSync param unaffected', () => {
    // Sanity: probe plugin has no beatSync in defaults. Should fall through
    // to standard Beat-Mode absolute resolution.
    const timeline: TimelineState = {
      tracks: [{ id: 't1', kind: 'fx', name: 'P', muted: false, order: 0 }],
      clips: [
        {
          id: 'c1',
          trackId: 't1',
          kind: 'pulse',
          fxId: 'probe',
          startBeat: 0,
          lengthBeats: 10,
          label: 'P',
          params: {
            intensity: {
              mode: 'automation',
              points: [
                { beat: 0, value: 0 },
                { beat: 4, value: 1 }
              ],
              interpolation: 'linear'
            }
          }
        }
      ],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    };
    const renderer = createRenderer({
      canvas: makeCanvas(),
      getCurrentTime: () => 2,
      getBeatGrid: () => grid,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      rafCallback: () => 0,
      cancelRafCallback: () => undefined
    });
    renderer.tick();
    expect((captured as { intensity: number }).intensity).toBeCloseTo(0.5);
  });
});
