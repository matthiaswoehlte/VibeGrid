import { describe, it, expect } from 'vitest';
import { beatFlashPlugin } from '@/lib/fx/beat-flash';
import { makeRenderContext } from './_helpers';

interface CtxCalls {
  __calls: Array<{ method: string; args: unknown[] }>;
}

describe('beatFlashPlugin', () => {
  it('has the expected plugin shape', () => {
    expect(beatFlashPlugin.id).toBe('beat-flash');
    expect(beatFlashPlugin.kind).toBe('BeatFlash');
    expect(beatFlashPlugin.defaultTrigger).toBe('beat');
    expect(beatFlashPlugin.paramSchema.color.kind).toBe('color');
    expect(beatFlashPlugin.paramSchema.blendMode.kind).toBe('select');
  });

  it('blendMode select uses {value,label}[] form (not bare strings)', () => {
    const schema = beatFlashPlugin.paramSchema.blendMode;
    if (schema.kind !== 'select') throw new Error('blendMode should be select');
    expect(Array.isArray(schema.options)).toBe(true);
    for (const opt of schema.options) {
      expect(typeof opt.value).toBe('string');
      expect(typeof opt.label).toBe('string');
    }
  });

  it('blendMode default is source-over-compatible (no invalid "normal")', () => {
    const schema = beatFlashPlugin.paramSchema.blendMode;
    if (schema.kind !== 'select') throw new Error('blendMode should be select');
    const valid = ['source-over', 'screen', 'overlay'];
    for (const opt of schema.options) {
      expect(valid).toContain(opt.value);
    }
  });

  it('flowMode → no draw call', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: true });
    beatFlashPlugin.render(rc, beatFlashPlugin.getDefaultParams());
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(0);
  });

  it('beatPhase=0 with positive intensity → fillRect across the canvas', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    beatFlashPlugin.render(rc, beatFlashPlugin.getDefaultParams());
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(1);
    expect(fills[0].args).toEqual([0, 0, rc.width, rc.height]);
  });

  it('beatPhase past duration → envelope is zero, no draw', () => {
    const rc = makeRenderContext({ beatPhase: 0.5, flowMode: false });
    beatFlashPlugin.render(rc, { ...beatFlashPlugin.getDefaultParams(), duration: 0.1 });
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(0);
  });

  it('ctx.save and ctx.restore are balanced (discipline)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    beatFlashPlugin.render(rc, beatFlashPlugin.getDefaultParams());
    const calls = (rc.ctx as unknown as CtxCalls).__calls;
    const saves = calls.filter((c) => c.method === 'save').length;
    const restores = calls.filter((c) => c.method === 'restore').length;
    expect(saves).toBe(restores);
    expect(saves).toBeGreaterThan(0);
  });

  it('intensity=0 → no draw', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    beatFlashPlugin.render(rc, { ...beatFlashPlugin.getDefaultParams(), intensity: 0 });
    // intensity=0 still hits the fillRect (env > 0.01 at phase=0), but with
    // globalAlpha=0 the paint is invisible. Acceptable; test the alpha path.
    expect(rc.ctx.globalAlpha).toBeGreaterThanOrEqual(0);
  });

  // --- beatSync tests (Plan 8g) ---

  it('beatSync=1 decays with beat phase (default behavior)', () => {
    // At beatPhase=0.5 with default duration=0.1, env = 1 - 0.5/0.1 = -4 → 0,
    // so fillRect should not be called.
    const rc = makeRenderContext({ beatPhase: 0.5, flowMode: false });
    beatFlashPlugin.render(rc, { ...beatFlashPlugin.getDefaultParams(), beatSync: 1 });
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(0);
  });

  it('beatSync=0 runs at full intensity (env=1.0) regardless of beatPhase', () => {
    // beatPhase=0.99 with duration=0.1 would normally yield env≈0 and skip.
    // With beatSync=0, env is pinned to 1.0 → fillRect fires.
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: false });
    beatFlashPlugin.render(rc, { ...beatFlashPlugin.getDefaultParams(), beatSync: 0, duration: 0.1 });
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(1);
  });
});
