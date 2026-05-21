import { describe, it, expect } from 'vitest';
import { dissolvePlugin } from '@/lib/fx/dissolve';
import { makeRenderContext } from '../renderer/_helpers';

interface CtxCalls {
  __calls: Array<{ method: string; args: unknown[] }>;
}

describe('dissolvePlugin', () => {
  it('has the correct plugin shape', () => {
    expect(dissolvePlugin.id).toBe('dissolve');
    expect(dissolvePlugin.kind).toBe('Dissolve');
    expect(dissolvePlugin.paramSchema.dissolveMode.kind).toBe('select');
    expect(dissolvePlugin.paramSchema.direction.kind).toBe('select');
  });

  it('beat-wipe at beatPhase=0 paints one fillRect (max veil)', () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    dissolvePlugin.render(rc, {
      ...dissolvePlugin.getDefaultParams(),
      dissolveMode: 'beat-wipe'
    });
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(1);
  });

  it('beat-wipe between beats (beatPhase=0.9) paints nothing (alpha decayed to 0)', () => {
    const rc = makeRenderContext({ beatPhase: 0.9 });
    dissolvePlugin.render(rc, {
      ...dissolvePlugin.getDefaultParams(),
      dissolveMode: 'beat-wipe'
    });
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(0);
  });

  it('beat-wipe in flowMode is suppressed entirely', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: true });
    dissolvePlugin.render(rc, {
      ...dissolvePlugin.getDefaultParams(),
      dissolveMode: 'beat-wipe'
    });
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(0);
  });

  it('directional-blur paints multiple stacked overlays regardless of beat', () => {
    const rc = makeRenderContext({ beatPhase: 0.5 });
    dissolvePlugin.render(rc, {
      ...dissolvePlugin.getDefaultParams(),
      dissolveMode: 'directional-blur'
    });
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(5); // BLUR_LAYERS
  });

  it('reveal-wipe at t=0 paints full veil, at t=1 paints nothing', () => {
    const params = {
      ...dissolvePlugin.getDefaultParams(),
      dissolveMode: 'reveal-wipe' as const
    };

    const rcStart = makeRenderContext({
      clipStartSec: 1,
      clipDurationSec: 4,
      time: 1
    });
    dissolvePlugin.render(rcStart, params);
    const fillsStart = (rcStart.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fillsStart.length).toBe(1);

    const rcEnd = makeRenderContext({
      clipStartSec: 1,
      clipDurationSec: 4,
      time: 5 // = clipStartSec + clipDurationSec → t=1
    });
    dissolvePlugin.render(rcEnd, params);
    const fillsEnd = (rcEnd.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fillsEnd.length).toBe(0);
  });

  it('center direction is a no-op (origin==end → nothing to wipe)', () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    dissolvePlugin.render(rc, {
      ...dissolvePlugin.getDefaultParams(),
      dissolveMode: 'beat-wipe',
      direction: 'center'
    });
    const fills = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillRect'
    );
    expect(fills.length).toBe(0);
  });
});
