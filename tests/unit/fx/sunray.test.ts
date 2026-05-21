import { describe, it, expect } from 'vitest';
import { sunrayPlugin } from '@/lib/fx/sunray';
import { makeRenderContext } from '../renderer/_helpers';

interface CtxCalls {
  __calls: Array<{ method: string; args: unknown[] }>;
}

describe('sunrayPlugin', () => {
  it('has the correct plugin shape', () => {
    expect(sunrayPlugin.id).toBe('sunray');
    expect(sunrayPlugin.kind).toBe('Sunray');
    expect(sunrayPlugin.paramSchema.color.kind).toBe('color');
    expect(sunrayPlugin.paramSchema.direction.kind).toBe('select');
  });

  it('draws `rayCount` triangles when on the beat', () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    sunrayPlugin.render(rc, { ...sunrayPlugin.getDefaultParams(), rayCount: 6 });
    const closes = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'closePath'
    );
    expect(closes.length).toBe(6);
  });

  it('clamps rayCount to the param range (max 16)', () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    sunrayPlugin.render(rc, { ...sunrayPlugin.getDefaultParams(), rayCount: 50 });
    const closes = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'closePath'
    );
    expect(closes.length).toBe(16);
  });

  it('skips rendering when pulseAlpha decays to 0 (mid-beat in beat mode)', () => {
    const rc = makeRenderContext({ beatPhase: 0.9, flowMode: false });
    sunrayPlugin.render(rc, { ...sunrayPlugin.getDefaultParams(), decay: 0.65 });
    const closes = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'closePath'
    );
    expect(closes.length).toBe(0);
  });

  it('flow mode renders continuous half-strength glow regardless of beatPhase', () => {
    const rc = makeRenderContext({ beatPhase: 0.9, flowMode: true });
    sunrayPlugin.render(rc, sunrayPlugin.getDefaultParams());
    const closes = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'closePath'
    );
    expect(closes.length).toBe(8); // default rayCount
  });

  it('intensity = 0 produces no rays even on the beat', () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    sunrayPlugin.render(rc, { ...sunrayPlugin.getDefaultParams(), intensity: 0 });
    const closes = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'closePath'
    );
    expect(closes.length).toBe(0);
  });
});
