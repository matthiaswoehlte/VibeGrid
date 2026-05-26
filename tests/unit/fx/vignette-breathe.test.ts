import { describe, it, expect } from 'vitest';
import { vignetteBreathePlugin } from '@/lib/fx/vignette-breathe';
import { makeRenderContext } from './_helpers';

interface CtxCalls {
  __calls: Array<{ method: string; args: unknown[] }>;
}

describe('vignetteBreathePlugin', () => {
  it('has the expected plugin shape', () => {
    expect(vignetteBreathePlugin.id).toBe('vignette-breathe');
    expect(vignetteBreathePlugin.kind).toBe('VignetteBreathe');
    expect(vignetteBreathePlugin.paramSchema.color.kind).toBe('color');
  });

  it('beatPhase=0 with default params → fills the canvas', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    vignetteBreathePlugin.render(rc, vignetteBreathePlugin.getDefaultParams());
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(1);
  });

  it('baseSize=0, flowMode=true → vigSize is 0, no draw', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: true });
    vignetteBreathePlugin.render(rc, {
      ...vignetteBreathePlugin.getDefaultParams(),
      baseSize: 0
    });
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(0);
  });

  it('baseSize>0, flowMode=true → static vignette at baseSize', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: true });
    vignetteBreathePlugin.render(rc, {
      ...vignetteBreathePlugin.getDefaultParams(),
      baseSize: 0.3
    });
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(1);
  });

  it('baseSize=0 beyond decay → no draw (true pulse)', () => {
    const rc = makeRenderContext({ beatPhase: 0.95, flowMode: false });
    vignetteBreathePlugin.render(rc, {
      ...vignetteBreathePlugin.getDefaultParams(),
      baseSize: 0,
      decay: 0.2
    });
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(0);
  });

  it('baseSize>0 beyond decay → still drawing (breathe — never retracts to zero)', () => {
    const rc = makeRenderContext({ beatPhase: 0.95, flowMode: false });
    vignetteBreathePlugin.render(rc, {
      ...vignetteBreathePlugin.getDefaultParams(),
      baseSize: 0.3,
      decay: 0.2
    });
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(1);
  });

  it('save/restore discipline', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: false });
    vignetteBreathePlugin.render(rc, vignetteBreathePlugin.getDefaultParams());
    const calls = (rc.ctx as unknown as CtxCalls).__calls;
    const saves = calls.filter((c) => c.method === 'save').length;
    const restores = calls.filter((c) => c.method === 'restore').length;
    expect(saves).toBe(restores);
  });
});
