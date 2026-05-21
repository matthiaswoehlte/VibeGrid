import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOfflineRenderer } from '@/lib/renderer/offline-tick';
import { _resetBuiltInPluginsForTests, registerBuiltInPlugins } from '@/lib/fx';
import type { TimelineState } from '@/lib/timeline/types';
import { makeMockCtx, grid120 } from './_helpers';

interface CtxCalls {
  __calls: Array<{ method: string; args: unknown[] }>;
}

function makeCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = makeMockCtx();
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);
  return { canvas, ctx };
}

function emptyTimeline(): TimelineState {
  return {
    tracks: [],
    clips: [],
    playhead: { beats: 0, playing: false },
    zoom: 1,
    snap: 'beat'
  };
}

beforeEach(() => {
  _resetBuiltInPluginsForTests();
  registerBuiltInPlugins();
});

describe('makeOfflineRenderer', () => {
  it('renderAt(t) executes one tick that paints the background', () => {
    const { canvas, ctx } = makeCanvas();
    const r = makeOfflineRenderer({
      canvas,
      beatGrid: grid120,
      timeline: emptyTimeline(),
      getImageBitmap: () => undefined,
      flowMode: false
    });
    r.renderAt(0);
    const fills = (ctx as unknown as CtxCalls).__calls.filter((c) => c.method === 'fillRect');
    // The renderer always paints the opaque background — that's exactly one
    // fillRect for an empty timeline.
    expect(fills).toHaveLength(1);
  });

  it('renderAt(t) at the same t twice produces identical canvas commands', () => {
    const { canvas: c1, ctx: ctx1 } = makeCanvas();
    const r1 = makeOfflineRenderer({
      canvas: c1,
      beatGrid: grid120,
      timeline: emptyTimeline(),
      getImageBitmap: () => undefined,
      flowMode: false
    });
    r1.renderAt(0.5);
    const calls1 = (ctx1 as unknown as CtxCalls).__calls.map((c) => c.method);

    const { canvas: c2, ctx: ctx2 } = makeCanvas();
    const r2 = makeOfflineRenderer({
      canvas: c2,
      beatGrid: grid120,
      timeline: emptyTimeline(),
      getImageBitmap: () => undefined,
      flowMode: false
    });
    r2.renderAt(0.5);
    const calls2 = (ctx2 as unknown as CtxCalls).__calls.map((c) => c.method);
    expect(calls1).toEqual(calls2);
  });

  it('flowMode flag reaches plugins via the render context', () => {
    // A Pulse clip at beat 0: in beat mode it would paint a fillRect on the
    // beat-hit; in flow mode the Hotfix short-circuit returns early. With
    // beats=0 and the empty grid (offset=0), the very first tick is on the beat.
    const timeline: TimelineState = {
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
    };

    const { canvas: cBeat, ctx: ctxBeat } = makeCanvas();
    makeOfflineRenderer({
      canvas: cBeat,
      beatGrid: grid120,
      timeline,
      getImageBitmap: () => undefined,
      flowMode: false
    }).renderAt(0);

    const { canvas: cFlow, ctx: ctxFlow } = makeCanvas();
    makeOfflineRenderer({
      canvas: cFlow,
      beatGrid: grid120,
      timeline,
      getImageBitmap: () => undefined,
      flowMode: true
    }).renderAt(0);

    const beatFills = (ctxBeat as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    ).length;
    const flowFills = (ctxFlow as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    ).length;
    // Beat mode = background + Pulse flash = 2. Flow mode = background only = 1.
    expect(beatFills).toBe(2);
    expect(flowFills).toBe(1);
  });

  it('one renderer instance handles many renderAt calls (no per-frame setup cost)', () => {
    const { canvas, ctx } = makeCanvas();
    const r = makeOfflineRenderer({
      canvas,
      beatGrid: grid120,
      timeline: emptyTimeline(),
      getImageBitmap: () => undefined,
      flowMode: false
    });
    for (let i = 0; i < 10; i++) r.renderAt(i / 30);
    const fills = (ctx as unknown as CtxCalls).__calls.filter((c) => c.method === 'fillRect');
    expect(fills).toHaveLength(10); // 10 ticks × 1 background fill each
  });
});
