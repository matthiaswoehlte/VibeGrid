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

  // Plan 9c.1 — subdividedBeatPhase is "beats since last subdivision
  // boundary" with subdivisionInterval = 1/multiplier. At sub=1× it
  // reduces to phase.phase (identity); at sub=N× it wraps to [0, 1/N)
  // and the FX `env = 1 - subdividedBeatPhase / decay` uses `decay`
  // in absolute beats, identical to pre-9c semantics.

  it('beatPhase=0 with subdivision=4× → subdividedBeatPhase=0', () => {
    const rc = runAt(0, '4×');
    expect(rc.beatPhase).toBeCloseTo(0);
    expect(rc.subdividedBeatPhase).toBeCloseTo(0);
    expect(rc.subdivision).toBe('4×');
  });

  it('beatPhase=0.125 with subdivision=4× → subdividedBeatPhase=0.125 (≤ interval)', () => {
    // sub_interval = 0.25 beat. 0.125 < 0.25 → no wrap → identity.
    const rc = runAt(0.125, '4×');
    expect(rc.beatPhase).toBeCloseTo(0.125);
    expect(rc.subdividedBeatPhase).toBeCloseTo(0.125);
  });

  it('beatPhase=0.25 with subdivision=4× wraps → subdividedBeatPhase=0', () => {
    // 0.25 % 0.25 = 0 (next subdivision begins).
    const rc = runAt(0.25, '4×');
    expect(rc.beatPhase).toBeCloseTo(0.25);
    expect(rc.subdividedBeatPhase).toBeCloseTo(0);
  });

  it('beatPhase=0.3 with subdivision=4× → subdividedBeatPhase=0.05 (after 1× wrap)', () => {
    // 0.3 % 0.25 = 0.05 — 0.05 beats into the second subdivision.
    const rc = runAt(0.3, '4×');
    expect(rc.subdividedBeatPhase).toBeCloseTo(0.05);
  });

  it('beatPhase≈0.9999 with subdivision=16× → subdividedBeatPhase≈0.0624', () => {
    // 0.9999 % 0.0625 — last subdivision (15th, starting at 0.9375).
    // 0.9999 - 15*0.0625 = 0.9999 - 0.9375 = 0.0624.
    const rc = runAt(0.9999, '16×');
    expect(rc.subdividedBeatPhase).toBeCloseTo(0.0624, 3);
  });

  it('triggerSubdivision=undefined → multiplier 1, subdividedBeatPhase === beatPhase', () => {
    const rc = runAt(0.42);
    expect(rc.subdivision).toBe('1×');
    expect(rc.subdividedBeatPhase).toBeCloseTo(rc.beatPhase);
    expect(rc.subdividedBeatPhase).toBeCloseTo(0.42);
  });

  it('subdivided phase fits inside [0, 1/multiplier) for any time', () => {
    // Property: at sub=8× the subdivided phase is always < 0.125.
    for (const t of [0, 0.001, 0.124, 0.125, 0.2, 0.5, 0.9999]) {
      const rc = runAt(t, '8×');
      expect(rc.subdividedBeatPhase).toBeGreaterThanOrEqual(0);
      expect(rc.subdividedBeatPhase).toBeLessThan(0.125);
    }
  });

  it('flowMode does not bypass subdivision computation', () => {
    // The loop still computes subdividedBeatPhase even when an FX would
    // skip via rc.flowMode — value is present in rc for test consistency.
    const rc = runAt(0.0625, '8×');
    // 0.0625 < 0.125 → identity within first subdivision.
    expect(rc.subdividedBeatPhase).toBeCloseTo(0.0625);
  });
});
