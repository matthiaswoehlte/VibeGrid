import { describe, it, expect } from 'vitest';
import { sweepPlugin } from '@/lib/fx/sweep';
import { makeRenderContext } from './_helpers';

describe('sweepPlugin', () => {
  it('has the correct shape', () => {
    expect(sweepPlugin.id).toBe('sweep');
    expect(sweepPlugin.kind).toBe('Sweep');
    expect(sweepPlugin.defaultTrigger).toBe('bar');
    expect(sweepPlugin.preloadState).toBe('ready');
  });

  it('creates 3 radial gradients per render', () => {
    const rc = makeRenderContext({ time: 0 });
    sweepPlugin.render(rc, sweepPlugin.getDefaultParams());
    const gradSpy = rc.ctx.createRadialGradient as unknown as {
      mock: { calls: unknown[][] };
    };
    expect(gradSpy.mock.calls.length).toBe(3);
  });

  it('fills 3 ellipses (one per orb) per render', () => {
    const rc = makeRenderContext({ time: 0 });
    sweepPlugin.render(rc, sweepPlugin.getDefaultParams());
    const calls = (rc.ctx as unknown as { __calls: Array<{ method: string }> }).__calls;
    const fills = calls.filter((c) => c.method === 'fillRect');
    expect(fills.length).toBe(3);
  });

  it('orb positions change with time (drift)', () => {
    const rc1 = makeRenderContext({ time: 0 });
    const rc2 = makeRenderContext({ time: 4 });
    sweepPlugin.render(rc1, sweepPlugin.getDefaultParams());
    sweepPlugin.render(rc2, sweepPlugin.getDefaultParams());
    const g1 = (rc1.ctx.createRadialGradient as unknown as { mock: { calls: number[][] } }).mock
      .calls;
    const g2 = (rc2.ctx.createRadialGradient as unknown as { mock: { calls: number[][] } }).mock
      .calls;
    expect(g1[0][0]).not.toBe(g2[0][0]);
  });

  it('paramSchema has speed and color params', () => {
    expect(sweepPlugin.paramSchema.speed.kind).toBe('slider');
    expect(sweepPlugin.paramSchema.color.kind).toBe('color');
  });
});
