import { describe, it, expect } from 'vitest';
import { screenShakePlugin } from '@/lib/fx/screen-shake';
import { makeRenderContext } from './_helpers';

interface CtxCalls {
  __calls: Array<{ method: string; args: unknown[] }>;
}

function lastTranslate(rc: ReturnType<typeof makeRenderContext>): [number, number] | null {
  const t = (rc.ctx as unknown as CtxCalls).__calls.find((c) => c.method === 'translate');
  return t ? (t.args as [number, number]) : null;
}

describe('screenShakePlugin', () => {
  it('has the expected plugin shape', () => {
    expect(screenShakePlugin.id).toBe('screen-shake');
    expect(screenShakePlugin.kind).toBe('ScreenShake');
    expect(screenShakePlugin.paramSchema.axis.kind).toBe('select');
  });

  it('flowMode → no draw', () => {
    const rc = makeRenderContext({ beatPhase: 0.1, flowMode: true });
    screenShakePlugin.render(rc, screenShakePlugin.getDefaultParams());
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(0);
  });

  it('mid-beat with positive intensity → translate + drawImage', () => {
    const rc = makeRenderContext({ beatPhase: 0.1, flowMode: false });
    screenShakePlugin.render(rc, screenShakePlugin.getDefaultParams());
    const tr = lastTranslate(rc);
    expect(tr).not.toBeNull();
  });

  it('axis="x" → dy is always 0', () => {
    const rc = makeRenderContext({ beatPhase: 0.1, flowMode: false });
    screenShakePlugin.render(rc, {
      ...screenShakePlugin.getDefaultParams(),
      axis: 'x'
    });
    const tr = lastTranslate(rc);
    expect(tr).not.toBeNull();
    expect(tr![1]).toBe(0);
  });

  it('axis="y" → dx is always 0', () => {
    const rc = makeRenderContext({ beatPhase: 0.1, flowMode: false });
    screenShakePlugin.render(rc, {
      ...screenShakePlugin.getDefaultParams(),
      axis: 'y'
    });
    const tr = lastTranslate(rc);
    expect(tr).not.toBeNull();
    expect(tr![0]).toBe(0);
  });

  it('beatPhase past decay → envelope is zero, no draw', () => {
    const rc = makeRenderContext({ beatPhase: 0.9, flowMode: false });
    screenShakePlugin.render(rc, {
      ...screenShakePlugin.getDefaultParams(),
      decay: 0.2
    });
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(0);
  });

  it('intensity scales with canvas width (fraction-of-width)', () => {
    const wide = makeRenderContext({ beatPhase: 0.05, flowMode: false, width: 1920 });
    const narrow = makeRenderContext({ beatPhase: 0.05, flowMode: false, width: 480 });
    screenShakePlugin.render(wide, screenShakePlugin.getDefaultParams());
    screenShakePlugin.render(narrow, screenShakePlugin.getDefaultParams());
    const trWide = lastTranslate(wide)!;
    const trNarrow = lastTranslate(narrow)!;
    // Wide canvas → larger absolute dx (same fraction, larger basis).
    expect(Math.abs(trWide[0])).toBeGreaterThan(Math.abs(trNarrow[0]));
  });

  it('no imageBitmap → early return', () => {
    const rc = makeRenderContext({
      beatPhase: 0.1,
      flowMode: false,
      imageBitmap: undefined
    });
    screenShakePlugin.render(rc, screenShakePlugin.getDefaultParams());
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(0);
  });

  it('save/restore discipline', () => {
    const rc = makeRenderContext({ beatPhase: 0.1, flowMode: false });
    screenShakePlugin.render(rc, screenShakePlugin.getDefaultParams());
    const calls = (rc.ctx as unknown as CtxCalls).__calls;
    const saves = calls.filter((c) => c.method === 'save').length;
    const restores = calls.filter((c) => c.method === 'restore').length;
    expect(saves).toBe(restores);
    expect(saves).toBe(1);
  });

  // --- beatSync tests (Plan 8g) ---

  it('beatSync=1 decays with beat phase (default behavior)', () => {
    // beatPhase=0.5 with default decay=0.4: env = 1 - 0.5/0.4 = -0.25 → 0, no draw.
    const rc = makeRenderContext({ beatPhase: 0.5, flowMode: false });
    screenShakePlugin.render(rc, { ...screenShakePlugin.getDefaultParams(), beatSync: true });
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(0);
  });

  it('beatSync=0 runs at full intensity (env=1.0) regardless of beatPhase', () => {
    // beatPhase=0.99 with decay=0.1 would normally yield env=0 → no draw.
    // With beatSync=0, env=1.0 → translate + drawImage fires.
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: false });
    screenShakePlugin.render(rc, {
      ...screenShakePlugin.getDefaultParams(),
      beatSync: false,
      decay: 0.1
    });
    const draws = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'drawImage'
    );
    expect(draws.length).toBe(1);
  });
});
