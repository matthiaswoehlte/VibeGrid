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
    globalAlpha: 1,
    fillStyle: '#000'
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(c, 'getContext').mockReturnValue(stubCtx as unknown as RenderingContext);
  return c;
}

const grid: BeatGrid = { bpm: 60, offsetMs: 0, source: 'manual' };

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
      tracks: [{ id: 't1', kind: 'pulse', name: 'P', muted: false, order: 0 }],
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
      tracks: [{ id: 't1', kind: 'pulse', name: 'P', muted: false, order: 0 }],
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
      tracks: [{ id: 't1', kind: 'pulse', name: 'P', muted: false, order: 0 }],
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
});
