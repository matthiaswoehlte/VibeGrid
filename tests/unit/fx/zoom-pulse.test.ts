import { describe, it, expect } from 'vitest';
import { zoomPulsePlugin } from '@/lib/fx/zoom-pulse';
import { makeRenderContext } from './_helpers';

describe('zoomPulsePlugin', () => {
  it('has the correct plugin shape', () => {
    expect(zoomPulsePlugin.id).toBe('zoom-pulse');
    expect(zoomPulsePlugin.kind).toBe('ZoomPulse');
    expect(zoomPulsePlugin.defaultTrigger).toBe('beat');
    expect(zoomPulsePlugin.preloadState).toBe('ready');
    expect(zoomPulsePlugin.paramSchema.intensity.kind).toBe('slider');
    expect(zoomPulsePlugin.paramSchema.decay.kind).toBe('slider');
  });

  it('draws the image with a scale transform when imageBitmap + onBeat + intensity > 0', () => {
    const bitmap = { width: 400, height: 300, close: () => {} } as unknown as ImageBitmap;
    const rc = makeRenderContext({
      isOnBeat: true,
      beatPhase: 0,
      width: 800,
      height: 450,
      imageBitmap: bitmap
    });
    zoomPulsePlugin.render(rc, { intensity: 0.5, decay: 0.5 });
    const calls = (rc.ctx as unknown as { __calls: Array<{ method: string; args: unknown[] }> })
      .__calls;
    const scale = calls.find((c) => c.method === 'scale');
    const draw = calls.find((c) => c.method === 'drawImage');
    expect(scale).toBeDefined();
    expect(scale!.args[0]).toBeGreaterThan(1);
    expect(draw).toBeDefined();
  });

  it('does NOT draw when imageBitmap is missing', () => {
    const rc = makeRenderContext({ isOnBeat: true, beatPhase: 0, imageBitmap: undefined });
    zoomPulsePlugin.render(rc, { intensity: 0.5, decay: 0.5 });
    const calls = (rc.ctx as unknown as { __calls: Array<{ method: string }> }).__calls;
    expect(calls.find((c) => c.method === 'drawImage')).toBeUndefined();
  });

  it('higher intensity → larger scale factor', () => {
    const bitmap = { width: 400, height: 300, close: () => {} } as unknown as ImageBitmap;
    const rcLow = makeRenderContext({ isOnBeat: true, beatPhase: 0, imageBitmap: bitmap });
    const rcHigh = makeRenderContext({ isOnBeat: true, beatPhase: 0, imageBitmap: bitmap });
    zoomPulsePlugin.render(rcLow, { intensity: 0.2, decay: 0.5 });
    zoomPulsePlugin.render(rcHigh, { intensity: 0.8, decay: 0.5 });
    const scaleLow = (
      rcLow.ctx as unknown as { __calls: Array<{ method: string; args: unknown[] }> }
    ).__calls.find((c) => c.method === 'scale');
    const scaleHigh = (
      rcHigh.ctx as unknown as { __calls: Array<{ method: string; args: unknown[] }> }
    ).__calls.find((c) => c.method === 'scale');
    expect((scaleHigh!.args[0] as number) > (scaleLow!.args[0] as number)).toBe(true);
  });

  it('Flow Mode suppresses the per-beat scale punch', () => {
    const bitmap = { width: 400, height: 300, close: () => {} } as unknown as ImageBitmap;
    const rc = makeRenderContext({
      isOnBeat: true,
      beatPhase: 0,
      imageBitmap: bitmap,
      flowMode: true
    });
    zoomPulsePlugin.render(rc, { intensity: 0.8, decay: 0.5 });
    const calls = (rc.ctx as unknown as { __calls: Array<{ method: string }> }).__calls;
    // Neither the scale transform nor a re-draw of the bitmap happens.
    expect(calls.find((c) => c.method === 'scale')).toBeUndefined();
    expect(calls.find((c) => c.method === 'drawImage')).toBeUndefined();
  });

  it('ctx.save and ctx.restore are balanced', () => {
    const bitmap = { width: 400, height: 300, close: () => {} } as unknown as ImageBitmap;
    const rc = makeRenderContext({ isOnBeat: true, beatPhase: 0, imageBitmap: bitmap });
    zoomPulsePlugin.render(rc, { intensity: 0.5, decay: 0.5 });
    const calls = (rc.ctx as unknown as { __calls: Array<{ method: string }> }).__calls;
    const saves = calls.filter((c) => c.method === 'save').length;
    const restores = calls.filter((c) => c.method === 'restore').length;
    expect(saves).toBe(restores);
    expect(saves).toBeGreaterThan(0);
  });
});
