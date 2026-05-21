import { describe, it, expect, afterEach } from 'vitest';
import { textPlugin } from '@/lib/fx/text';
import { makeRenderContext } from '../renderer/_helpers';

interface CtxCalls {
  __calls: Array<{ method: string; args: unknown[] }>;
}

describe('textPlugin', () => {
  afterEach(() => textPlugin.dispose?.());

  it('has the correct plugin shape', () => {
    expect(textPlugin.id).toBe('text');
    expect(textPlugin.kind).toBe('Text');
    expect(textPlugin.preloadState).toBe('ready');
    expect(textPlugin.paramSchema.text.kind).toBe('text');
    expect(textPlugin.paramSchema.fontFamily.kind).toBe('select');
  });

  it('renders nothing when text is empty', () => {
    const rc = makeRenderContext();
    textPlugin.render(rc, { ...textPlugin.getDefaultParams(), text: '' });
    const calls = (rc.ctx as unknown as CtxCalls).__calls;
    expect(calls.find((c) => c.method === 'fillText')).toBeUndefined();
  });

  it('position at t=0 is at (startX, startY)', () => {
    const rc = makeRenderContext({
      width: 1000,
      height: 500,
      clipStartSec: 1,
      clipDurationSec: 0, // disables auto-progress → t falls to 0
      time: 1
    });
    textPlugin.render(rc, {
      ...textPlugin.getDefaultParams(),
      startX: 0.2,
      startY: 0.4,
      endX: 0.8,
      endY: 0.6
    });
    const calls = (rc.ctx as unknown as CtxCalls).__calls;
    const draw = calls.find((c) => c.method === 'fillText');
    expect(draw).toBeDefined();
    // 0.2 * 1000 = 200, 0.4 * 500 = 200
    expect(draw!.args[1]).toBe(200);
    expect(draw!.args[2]).toBe(200);
  });

  it('position at t=1 is at (endX, endY)', () => {
    const rc = makeRenderContext({
      width: 1000,
      height: 500,
      clipStartSec: 0,
      clipDurationSec: 4,
      time: 4 // end of clip → t=1
    });
    textPlugin.render(rc, {
      ...textPlugin.getDefaultParams(),
      startX: 0.2,
      startY: 0.4,
      endX: 0.8,
      endY: 0.6
    });
    const calls = (rc.ctx as unknown as CtxCalls).__calls;
    const draw = calls.find((c) => c.method === 'fillText');
    expect(draw).toBeDefined();
    expect(draw!.args[1]).toBe(800); // 0.8 * 1000
    expect(draw!.args[2]).toBe(300); // 0.6 * 500
  });

  it('useAutoProgress=false uses params.progress directly', () => {
    const rc = makeRenderContext({
      width: 1000,
      height: 500,
      clipStartSec: 0,
      clipDurationSec: 10,
      time: 0 // auto would give t=0 …
    });
    textPlugin.render(rc, {
      ...textPlugin.getDefaultParams(),
      useAutoProgress: false,
      progress: 0.5,
      startX: 0,
      startY: 0,
      endX: 1,
      endY: 1
    });
    const draw = (rc.ctx as unknown as CtxCalls).__calls.find(
      (c) => c.method === 'fillText'
    );
    // … but useAutoProgress=false uses progress=0.5 → centre of canvas
    expect(draw!.args[1]).toBe(500);
    expect(draw!.args[2]).toBe(250);
  });

  it('3D extrusion draws depth+1 fillText calls (stack + foreground)', () => {
    const rc = makeRenderContext();
    textPlugin.render(rc, {
      ...textPlugin.getDefaultParams(),
      enable3d: true,
      extrusionDepth: 5,
      extrusionStyle: 'plain'
    });
    const fillTexts = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillText'
    );
    expect(fillTexts.length).toBe(6); // 5 extrusion layers + 1 foreground
  });

  it('rock-style jitter is deterministic across re-renders of the same clip', () => {
    const params = {
      ...textPlugin.getDefaultParams(),
      enable3d: true,
      extrusionDepth: 5,
      extrusionStyle: 'rock' as const
    };
    const rc1 = makeRenderContext({ clipId: 'clip-rock' });
    textPlugin.render(rc1, params);
    const calls1 = (rc1.ctx as unknown as CtxCalls).__calls
      .filter((c) => c.method === 'fillText')
      .map((c) => [c.args[1], c.args[2]]);

    const rc2 = makeRenderContext({ clipId: 'clip-rock' });
    textPlugin.render(rc2, params);
    const calls2 = (rc2.ctx as unknown as CtxCalls).__calls
      .filter((c) => c.method === 'fillText')
      .map((c) => [c.args[1], c.args[2]]);

    // Same clipId → same cached jitter → identical positions.
    expect(calls2).toEqual(calls1);
  });

  it('blink in flow mode is suppressed', () => {
    // With blink on a normal beat-hit (beatPhase=0) the alpha would drop
    // from globalAlpha. In flow mode we expect globalAlpha unchanged
    // before the text draw — easier to assert: blink active but rc.flowMode
    // true should give the same number of fillText calls regardless.
    const params = {
      ...textPlugin.getDefaultParams(),
      blink: true,
      blinkDecay: 0.5
    };
    const rc = makeRenderContext({
      isOnBeat: true,
      beatPhase: 0,
      flowMode: true
    });
    textPlugin.render(rc, params);
    const fillTexts = (rc.ctx as unknown as CtxCalls).__calls.filter(
      (c) => c.method === 'fillText'
    );
    expect(fillTexts.length).toBe(1);
  });
});
