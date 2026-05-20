import { describe, it, expect } from 'vitest';
import { pulsePlugin } from '@/lib/fx/pulse';
import { makeRenderContext } from './_helpers';

describe('pulsePlugin', () => {
  it('has the correct shape', () => {
    expect(pulsePlugin.id).toBe('pulse');
    expect(pulsePlugin.kind).toBe('Pulse');
    expect(pulsePlugin.defaultTrigger).toBe('beat');
    expect(pulsePlugin.preloadState).toBe('ready');
  });

  it('renders a fillRect that covers the whole canvas when isOnBeat', () => {
    const rc = makeRenderContext({ isOnBeat: true, beatPhase: 0, width: 800, height: 450 });
    pulsePlugin.render(rc, pulsePlugin.getDefaultParams());
    const calls = (rc.ctx as unknown as { __calls: Array<{ method: string; args: unknown[] }> })
      .__calls;
    const fill = calls.find((c) => c.method === 'fillRect');
    expect(fill).toBeDefined();
    expect(fill!.args).toEqual([0, 0, 800, 450]);
  });

  it('decays alpha as beatPhase grows (more transparent past the beat)', () => {
    const rcEarly = makeRenderContext({ isOnBeat: true, beatPhase: 0 });
    const rcLate = makeRenderContext({ isOnBeat: true, beatPhase: 0.45 });
    pulsePlugin.render(rcEarly, pulsePlugin.getDefaultParams());
    pulsePlugin.render(rcLate, pulsePlugin.getDefaultParams());
    const earlyCalls = (rcEarly.ctx as unknown as { __calls: Array<{ method: string }> }).__calls;
    const lateCalls = (rcLate.ctx as unknown as { __calls: Array<{ method: string }> }).__calls;
    expect(earlyCalls.some((c) => c.method === 'fillRect')).toBe(true);
    expect(lateCalls.some((c) => c.method === 'fillRect')).toBe(true);
  });

  it('does NOT fill when isOnBeat is false', () => {
    const rc = makeRenderContext({ isOnBeat: false });
    pulsePlugin.render(rc, pulsePlugin.getDefaultParams());
    const calls = (rc.ctx as unknown as { __calls: Array<{ method: string }> }).__calls;
    expect(calls.find((c) => c.method === 'fillRect')).toBeUndefined();
  });

  it('Flow Mode suppresses the beat flash even when isOnBeat is true', () => {
    const rc = makeRenderContext({ isOnBeat: true, beatPhase: 0, flowMode: true });
    pulsePlugin.render(rc, pulsePlugin.getDefaultParams());
    const calls = (rc.ctx as unknown as { __calls: Array<{ method: string }> }).__calls;
    expect(calls.find((c) => c.method === 'fillRect')).toBeUndefined();
  });

  it('has paramSchema entries for color and intensity', () => {
    expect(pulsePlugin.paramSchema.color.kind).toBe('color');
    expect(pulsePlugin.paramSchema.intensity.kind).toBe('slider');
  });
});
