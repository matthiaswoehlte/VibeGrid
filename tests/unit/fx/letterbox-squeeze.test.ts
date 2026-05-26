import { describe, it, expect } from 'vitest';
import { letterboxSqueezePlugin } from '@/lib/fx/letterbox-squeeze';
import { makeRenderContext } from './_helpers';

interface CtxCalls {
  __calls: Array<{ method: string; args: unknown[] }>;
}

describe('letterboxSqueezePlugin', () => {
  it('has the expected plugin shape', () => {
    expect(letterboxSqueezePlugin.id).toBe('letterbox-squeeze');
    expect(letterboxSqueezePlugin.kind).toBe('LetterboxSqueeze');
    expect(letterboxSqueezePlugin.paramSchema.targetRatio.kind).toBe('select');
  });

  it('16:9 source + targetRatio=2.35:1 → bars are drawn', () => {
    // 16:9 = ~1.78 aspect. Target 2.35 → bars required.
    const rc = makeRenderContext({
      beatPhase: 0.05, // = attack peak
      flowMode: false,
      width: 1920,
      height: 1080
    });
    letterboxSqueezePlugin.render(rc, letterboxSqueezePlugin.getDefaultParams());
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(2);
    // First fill: top bar at (0, 0, w, barH); second: bottom bar.
    const [topX, topY, topW, topH] = fills[0].args as [number, number, number, number];
    expect(topX).toBe(0);
    expect(topY).toBe(0);
    expect(topW).toBe(1920);
    expect(topH).toBeGreaterThan(0);
  });

  it('2.35:1 source + targetRatio=2.35:1 → no bars (already at target)', () => {
    const rc = makeRenderContext({
      beatPhase: 0.05,
      flowMode: false,
      width: 2350,
      height: 1000
    });
    letterboxSqueezePlugin.render(rc, letterboxSqueezePlugin.getDefaultParams());
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(0);
  });

  it('flowMode=true → static bars at intensity × targetBarH', () => {
    const rc = makeRenderContext({
      beatPhase: 0.5, // would be past decay normally
      flowMode: true,
      width: 1920,
      height: 1080
    });
    letterboxSqueezePlugin.render(rc, letterboxSqueezePlugin.getDefaultParams());
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(2);
  });

  it('intensity=0 → no draw (env collapses)', () => {
    const rc = makeRenderContext({
      beatPhase: 0.05,
      flowMode: false,
      width: 1920,
      height: 1080
    });
    letterboxSqueezePlugin.render(rc, {
      ...letterboxSqueezePlugin.getDefaultParams(),
      intensity: 0
    });
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(0);
  });

  it('beatPhase past attack+decay → no draw', () => {
    const rc = makeRenderContext({
      beatPhase: 0.9,
      flowMode: false,
      width: 1920,
      height: 1080
    });
    letterboxSqueezePlugin.render(rc, {
      ...letterboxSqueezePlugin.getDefaultParams(),
      attack: 0.05,
      decay: 0.3
    });
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(0);
  });

  it('save/restore discipline', () => {
    const rc = makeRenderContext({
      beatPhase: 0.05,
      flowMode: false,
      width: 1920,
      height: 1080
    });
    letterboxSqueezePlugin.render(rc, letterboxSqueezePlugin.getDefaultParams());
    const calls = (rc.ctx as unknown as CtxCalls).__calls;
    const saves = calls.filter((c) => c.method === 'save').length;
    const restores = calls.filter((c) => c.method === 'restore').length;
    expect(saves).toBe(restores);
  });
});
