import { describe, it, expect } from 'vitest';
import { zoomPunchPlugin } from '@/lib/fx/zoom-punch';
import { makeRenderContext } from './_helpers';

interface CtxCalls {
  __calls: Array<{ method: string; args: unknown[] }>;
}

describe('zoomPunchPlugin', () => {
  it('has the expected plugin shape', () => {
    expect(zoomPunchPlugin.id).toBe('zoom-punch');
    expect(zoomPunchPlugin.kind).toBe('ZoomPunch');
    expect(zoomPunchPlugin.defaultTrigger).toBe('beat');
    expect(zoomPunchPlugin.paramSchema.direction.kind).toBe('select');
  });

  it('flowMode → no scale or draw', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: true });
    zoomPunchPlugin.render(rc, zoomPunchPlugin.getDefaultParams());
    const scales = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'scale'
    );
    expect(scales.length).toBe(0);
  });

  it('beatPhase=0 with strength>1 (direction=in) → scale > 1 at the apex of attack', () => {
    // At phase=0, scale = 1 + (strength-1) * (0/attack) = 1 — gated by
    // the identity check (Math.abs(scale-1) < 0.001), so no draw.
    // Test at phase=attack instead to capture the peak.
    const rc = makeRenderContext({ beatPhase: 0.02, flowMode: false });
    zoomPunchPlugin.render(rc, {
      ...zoomPunchPlugin.getDefaultParams(),
      strength: 1.2,
      attack: 0.02
    });
    const scales = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'scale'
    );
    expect(scales.length).toBe(1);
    const [sx, sy] = scales[0].args as [number, number];
    expect(sx).toBeCloseTo(1.2, 3);
    expect(sy).toBeCloseTo(1.2, 3);
  });

  it('direction=out → scale < 1 at the apex (Zoom Out)', () => {
    const rc = makeRenderContext({ beatPhase: 0.02, flowMode: false });
    zoomPunchPlugin.render(rc, {
      ...zoomPunchPlugin.getDefaultParams(),
      strength: 1.2,
      attack: 0.02,
      direction: 'out'
    });
    const scales = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'scale'
    );
    expect(scales.length).toBe(1);
    const [sx] = scales[0].args as [number, number];
    // 2 - 1.2 = 0.8
    expect(sx).toBeCloseTo(0.8, 3);
  });

  it('strength=1.0 → identity scale, early return (no draw)', () => {
    const rc = makeRenderContext({ beatPhase: 0.02, flowMode: false });
    zoomPunchPlugin.render(rc, { ...zoomPunchPlugin.getDefaultParams(), strength: 1.0 });
    const scales = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'scale'
    );
    expect(scales.length).toBe(0);
  });

  it('beatPhase well past attack+decay → scale collapses to identity, no draw', () => {
    const rc = makeRenderContext({ beatPhase: 0.5, flowMode: false });
    zoomPunchPlugin.render(rc, {
      ...zoomPunchPlugin.getDefaultParams(),
      attack: 0.02,
      decay: 0.1
    });
    const scales = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'scale'
    );
    expect(scales.length).toBe(0);
  });

  it('attack=0.01 (min) at beatPhase=0 → no NaN, no draw (scale is 1)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    zoomPunchPlugin.render(rc, {
      ...zoomPunchPlugin.getDefaultParams(),
      attack: 0.01
    });
    // scale = 1 + 0.12 * (0 / 0.01) = 1 → identity, no draw.
    const scales = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'scale'
    );
    expect(scales.length).toBe(0);
  });

  it('no imageBitmap → early return', () => {
    const rc = makeRenderContext({ beatPhase: 0.02, flowMode: false, imageBitmap: undefined });
    zoomPunchPlugin.render(rc, zoomPunchPlugin.getDefaultParams());
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(0);
  });

  it('save/restore discipline', () => {
    const rc = makeRenderContext({ beatPhase: 0.02, flowMode: false });
    zoomPunchPlugin.render(rc, { ...zoomPunchPlugin.getDefaultParams(), strength: 1.2 });
    const calls = (rc.ctx as unknown as CtxCalls).__calls;
    const saves = calls.filter((c) => c.method === 'save').length;
    const restores = calls.filter((c) => c.method === 'restore').length;
    expect(saves).toBe(restores);
    expect(saves).toBe(1);
  });
});
