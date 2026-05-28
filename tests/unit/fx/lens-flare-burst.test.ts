import { describe, it, expect } from 'vitest';
import { lensFlareBurstPlugin } from '@/lib/fx/lens-flare-burst';
import { makeRenderContext } from './_helpers';

interface CtxCalls {
  __calls: Array<{ method: string; args: unknown[] }>;
}

describe('lensFlareBurstPlugin', () => {
  it('has the expected plugin shape', () => {
    expect(lensFlareBurstPlugin.id).toBe('lens-flare-burst');
    expect(lensFlareBurstPlugin.kind).toBe('LensFlareBurst');
    expect(lensFlareBurstPlugin.paramSchema.color.kind).toBe('color');
  });

  it('flowMode → no draw', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: true });
    lensFlareBurstPlugin.render(rc, lensFlareBurstPlugin.getDefaultParams());
    const strokes = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'stroke'
    );
    expect(strokes.length).toBe(0);
  });

  it('beatPhase=0 with rayCount=8 → exactly 8 stroke calls', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    lensFlareBurstPlugin.render(rc, {
      ...lensFlareBurstPlugin.getDefaultParams(),
      rayCount: 8
    });
    const strokes = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'stroke'
    );
    expect(strokes.length).toBe(8);
  });

  it('rayCount=12 → 12 strokes', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    lensFlareBurstPlugin.render(rc, {
      ...lensFlareBurstPlugin.getDefaultParams(),
      rayCount: 12
    });
    const strokes = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'stroke'
    );
    expect(strokes.length).toBe(12);
  });

  it('beatPhase past decay → no draws', () => {
    const rc = makeRenderContext({ beatPhase: 0.9, flowMode: false });
    lensFlareBurstPlugin.render(rc, {
      ...lensFlareBurstPlugin.getDefaultParams(),
      decay: 0.2
    });
    const strokes = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'stroke'
    );
    expect(strokes.length).toBe(0);
  });

  it('intensity=0 → no envelope, draws still happen but with zero alpha', () => {
    // intensity scales the color alpha only; geometric strokes still fire
    // (env = max(0, 1 - phase/decay) > 0 at phase=0). Acceptable —
    // visually invisible but draw-count check stays meaningful.
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    lensFlareBurstPlugin.render(rc, {
      ...lensFlareBurstPlugin.getDefaultParams(),
      intensity: 0,
      rayCount: 8
    });
    const strokes = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'stroke'
    );
    expect(strokes.length).toBe(8);
  });

  it('center fills are honored (radial glow draws fillRect)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    lensFlareBurstPlugin.render(rc, lensFlareBurstPlugin.getDefaultParams());
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(1);
  });

  it('save/restore discipline', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    lensFlareBurstPlugin.render(rc, lensFlareBurstPlugin.getDefaultParams());
    const calls = (rc.ctx as unknown as CtxCalls).__calls;
    const saves = calls.filter((c) => c.method === 'save').length;
    const restores = calls.filter((c) => c.method === 'restore').length;
    expect(saves).toBe(restores);
    expect(saves).toBe(1);
  });

  // --- beatSync tests (Plan 8g) ---

  it('beatSync=1 decays with beat phase (default behavior)', () => {
    // beatPhase=0.5 with default decay=0.2: env = 1 - 0.5/0.2 = -1.5 → 0 → no draw.
    const rc = makeRenderContext({ beatPhase: 0.5, flowMode: false });
    lensFlareBurstPlugin.render(rc, { ...lensFlareBurstPlugin.getDefaultParams(), beatSync: 1 });
    const strokes = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'stroke'
    );
    expect(strokes.length).toBe(0);
  });

  it('beatSync=0 runs at full intensity (env=1.0) regardless of beatPhase', () => {
    // beatPhase=0.99 with decay=0.1 would normally yield env=0 → no draw.
    // With beatSync=0, env=1.0 → rayCount=8 strokes fire.
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: false });
    lensFlareBurstPlugin.render(rc, {
      ...lensFlareBurstPlugin.getDefaultParams(),
      beatSync: 0,
      decay: 0.1,
      rayCount: 8
    });
    const strokes = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'stroke'
    );
    expect(strokes.length).toBe(8);
  });
});
