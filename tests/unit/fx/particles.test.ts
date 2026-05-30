import { describe, it, expect, afterEach } from 'vitest';
import { particlesPlugin } from '@/lib/fx/particles';
import { pulsePlugin } from '@/lib/fx/pulse';
import { makeRenderContext } from './_helpers';

describe('particlesPlugin', () => {
  // particlesPlugin holds module-level pool + lastSpawnBeat state (v0.1 limit).
  // Reset between tests so spawn-guard assertions are deterministic.
  afterEach(() => {
    particlesPlugin.dispose?.();
  });

  it('has the correct shape', () => {
    expect(particlesPlugin.id).toBe('particles');
    expect(particlesPlugin.kind).toBe('Particle');
    expect(particlesPlugin.defaultTrigger).toBe('beat');
  });

  it('spawns particles on beat and renders them', () => {
    const rc = makeRenderContext({ isOnBeat: true, beatIndex: 1, time: 0.5 });
    particlesPlugin.render(rc, particlesPlugin.getDefaultParams());
    const calls = (rc.ctx as unknown as { __calls: Array<{ method: string }> }).__calls;
    const arcs = calls.filter((c) => c.method === 'arc');
    expect(arcs.length).toBeGreaterThan(0);
  });

  it('does not crash on consecutive renders within the same beat', () => {
    const params = particlesPlugin.getDefaultParams();
    const rc1 = makeRenderContext({ isOnBeat: true, beatIndex: 1, time: 0.5 });
    particlesPlugin.render(rc1, params);
    const rc2 = makeRenderContext({ isOnBeat: true, beatIndex: 1, time: 0.52 });
    particlesPlugin.render(rc2, params);
    const after2 = (rc2.ctx as unknown as { __calls: Array<{ method: string }> }).__calls.filter(
      (c) => c.method === 'arc'
    ).length;
    expect(after2).toBeGreaterThanOrEqual(0);
  });

  it('Flow Mode suppresses the beat-burst spawn', () => {
    // Fresh state (afterEach disposes), so no in-flight particles either.
    const rc = makeRenderContext({
      isOnBeat: true,
      beatIndex: 1,
      time: 0.5,
      flowMode: true
    });
    particlesPlugin.render(rc, particlesPlugin.getDefaultParams());
    const calls = (rc.ctx as unknown as { __calls: Array<{ method: string }> }).__calls;
    // Without a spawn there's nothing to draw — no arc/fill in this frame.
    expect(calls.find((c) => c.method === 'arc')).toBeUndefined();
  });

  it('paramSchema has spawnPerBeat, life, color, size', () => {
    expect(particlesPlugin.paramSchema.spawnPerBeat.kind).toBe('slider');
    expect(particlesPlugin.paramSchema.life.kind).toBe('slider');
    expect(particlesPlugin.paramSchema.color.kind).toBe('color');
    expect(particlesPlugin.paramSchema.size.kind).toBe('slider');
  });

  // Test 9 — onSeek hook: pool reset per-clip, leaves other clips untouched
  it('onSeek clears clipA pool while leaving clipB pool intact', () => {
    const params = particlesPlugin.getDefaultParams();

    // Render clipA with a beat trigger so its pool is populated.
    const rcA = makeRenderContext({ clipId: 'clipA', isOnBeat: true, beatIndex: 1, time: 1 });
    particlesPlugin.render(rcA, params);
    // Confirm particles were spawned by checking arc calls on clipA's ctx.
    const arcsA = (rcA.ctx as unknown as { __calls: Array<{ method: string }> }).__calls.filter(
      (c) => c.method === 'arc'
    );
    expect(arcsA.length).toBeGreaterThan(0);

    // Render clipB with a beat trigger so its pool is also populated.
    const rcB = makeRenderContext({ clipId: 'clipB', isOnBeat: true, beatIndex: 1, time: 1 });
    particlesPlugin.render(rcB, params);
    const arcsB = (rcB.ctx as unknown as { __calls: Array<{ method: string }> }).__calls.filter(
      (c) => c.method === 'arc'
    );
    expect(arcsB.length).toBeGreaterThan(0);

    // Seek clipA — its pool must be reset.
    particlesPlugin.onSeek?.('clipA');

    // After seek, render clipA at the same time but NOT on a beat boundary
    // (beatIndex different → spawn guard won't trigger) — pool starts empty so
    // there is nothing to draw this frame.
    const rcA2 = makeRenderContext({ clipId: 'clipA', isOnBeat: false, beatIndex: 2, time: 1.02 });
    particlesPlugin.render(rcA2, params);
    const arcsAfterSeek = (rcA2.ctx as unknown as { __calls: Array<{ method: string }> }).__calls.filter(
      (c) => c.method === 'arc'
    );
    expect(arcsAfterSeek).toHaveLength(0); // pool was empty after seek

    // clipB must be unaffected — render it again (off-beat so no new spawns)
    // and confirm it still draws its in-flight particles.
    const rcB2 = makeRenderContext({ clipId: 'clipB', isOnBeat: false, beatIndex: 2, time: 1.02 });
    particlesPlugin.render(rcB2, params);
    const arcsBAfterSeek = (rcB2.ctx as unknown as { __calls: Array<{ method: string }> }).__calls.filter(
      (c) => c.method === 'arc'
    );
    expect(arcsBAfterSeek.length).toBeGreaterThan(0); // clipB pool untouched
  });

  // onSeek is OPTIONAL — stateless plugins must NOT have it.
  it('pulsePlugin has no onSeek (hook is opt-in, not added broadly)', () => {
    expect(pulsePlugin.onSeek).toBeUndefined();
  });
});
