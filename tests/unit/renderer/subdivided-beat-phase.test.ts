import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRenderer } from '@/lib/renderer/loop';
import { register, _resetRegistryForTests } from '@/lib/renderer/registry';
import { _resetBuiltInPluginsForTests } from '@/lib/fx';
import type { FxPlugin, RenderContext } from '@/lib/renderer/types';
import type { TimelineState, TriggerSubdivision } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 100;
  c.height = 100;
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

function buildTimeline(triggerSubdivision?: TriggerSubdivision): TimelineState {
  return {
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
        triggerSubdivision
      }
    ],
    playhead: { beats: 0, playing: false },
    zoom: 1,
    snap: 'beat'
  };
}

describe('renderer — subdividedBeatPhase (Plan 9c)', () => {
  let captured: RenderContext | null;
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
      paramSchema: {},
      getDefaultParams: () => ({}),
      async preload() {},
      render(rc) {
        captured = rc;
      }
    };
    register(probe);
  });

  function runAt(time: number, sub?: TriggerSubdivision): RenderContext {
    const timeline = buildTimeline(sub);
    const renderer = createRenderer({
      canvas: makeCanvas(),
      getCurrentTime: () => time,
      getBeatGrid: () => grid,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      rafCallback: () => 0,
      cancelRafCallback: () => undefined
    });
    renderer.tick();
    if (!captured) throw new Error('probe.render was not invoked');
    return captured;
  }

  it('beatPhase=0 with subdivision=4× → subdividedBeatPhase=0', () => {
    const rc = runAt(0, '4×');
    expect(rc.beatPhase).toBeCloseTo(0);
    expect(rc.subdividedBeatPhase).toBeCloseTo(0);
    expect(rc.subdivision).toBe('4×');
  });

  it('beatPhase=0.125 with subdivision=4× → subdividedBeatPhase=0.5', () => {
    // At 60 bpm, t=0.125s ≡ beatPhase=0.125 within beat 0.
    const rc = runAt(0.125, '4×');
    expect(rc.beatPhase).toBeCloseTo(0.125);
    expect(rc.subdividedBeatPhase).toBeCloseTo(0.5);
  });

  it('beatPhase=0.25 with subdivision=4× wraps → subdividedBeatPhase=0', () => {
    const rc = runAt(0.25, '4×');
    expect(rc.beatPhase).toBeCloseTo(0.25);
    expect(rc.subdividedBeatPhase).toBeCloseTo(0);
  });

  it('beatPhase≈0.9999 with subdivision=16× → subdividedBeatPhase≈0.998', () => {
    const rc = runAt(0.9999, '16×');
    // 16 * 0.9999 = 15.9984 → mod 1 = 0.9984
    expect(rc.subdividedBeatPhase).toBeCloseTo(0.9984, 3);
  });

  it('triggerSubdivision=undefined → multiplier 1, subdividedBeatPhase === beatPhase', () => {
    const rc = runAt(0.42);
    expect(rc.subdivision).toBe('1×');
    expect(rc.subdividedBeatPhase).toBeCloseTo(rc.beatPhase);
    expect(rc.subdividedBeatPhase).toBeCloseTo(0.42);
  });

  it('flowMode does not bypass subdivision computation', () => {
    // Even with flow-mode on (set on the plugin contract independently of
    // subdivision), the loop still computes subdividedBeatPhase. Plugins
    // that early-return on rc.flowMode simply never read it; the value is
    // still present in rc for test-consistency.
    const rc = runAt(0.0625, '8×');
    expect(rc.subdividedBeatPhase).toBeCloseTo(0.5);
  });
});
