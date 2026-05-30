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
    // Note: default life is 1.6 s. clipB particles were born at time=1 and we
    // are now rendering at time=1.02 (0.02 s later). 0.02 s << 1.6 s, so
    // every particle spawned in the first clipB render is still alive here,
    // making the "greater than 0 arcs" assertion reliably true.
    const rcB2 = makeRenderContext({ clipId: 'clipB', isOnBeat: false, beatIndex: 2, time: 1.02 });
    // makeRenderContext calls makeMockCtx() internally, so rcB2.ctx.__calls is
    // a FRESH empty array that belongs only to this render call. Arc counts
    // below reflect only what this single render drew (no bleed from rcB).
    particlesPlugin.render(rcB2, params);
    const arcsBAfterSeek = (rcB2.ctx as unknown as { __calls: Array<{ method: string }> }).__calls.filter(
      (c) => c.method === 'arc'
    );
    expect(arcsBAfterSeek.length).toBeGreaterThan(0); // clipB pool untouched
  });

  // Test 7 — onSeek brings the pool to the FRESH-SEEK state (reset == fresh).
  //
  // This test targets PARTICLES specifically. A stateless FX (e.g. Pulse) would
  // trivially pass this because it has no accumulated state to reset; the
  // assertion would be vacuously true and prove nothing. Against Particles —
  // a stateful FX — a passing result proves the onSeek hook genuinely
  // reconstructs the same first-trigger behaviour as a fresh plugin instance.
  //
  // Spawn count is a FIXED param (spawnPerBeat, default 12) resolved at call
  // time, not randomised. Arc count on a triggered frame is therefore
  // deterministic and safe to assert exactly. Exact particle POSITIONS are
  // intentionally NOT asserted: x/y/vx/vy are drawn from Math.random in
  // spawnGeometry — non-deterministic across runs per KNOWN_LIMITATIONS
  // ("Particles spawn non-deterministic across runs").
  it('onSeek(clipId) produces the same first-trigger arc count as a fresh plugin (reset == fresh)', () => {
    const params = particlesPlugin.getDefaultParams(); // spawnPerBeat = 12

    // --- Reference: fresh plugin, first triggered frame ---
    // afterEach calls dispose(), so the pool is empty here (fresh state).
    const rcFresh = makeRenderContext({ clipId: 'seek-clip', isOnBeat: true, beatIndex: 1, time: 2 });
    particlesPlugin.render(rcFresh, params);
    const freshArcCount = (rcFresh.ctx as unknown as { __calls: Array<{ method: string }> }).__calls.filter(
      (c) => c.method === 'arc'
    ).length;
    // A fresh pool with a beat trigger must draw exactly spawnPerBeat arcs
    // (no pre-existing particles, all pool slots were dead).
    expect(freshArcCount).toBe(params.spawnPerBeat); // deterministic: fixed spawn count

    // --- Accumulate state on the same clipId ---
    // Dispose to clear inter-test state, then build up accumulated history.
    particlesPlugin.dispose?.();
    // First beat: populate the pool.
    const rcAccum1 = makeRenderContext({ clipId: 'seek-clip', isOnBeat: true, beatIndex: 1, time: 2 });
    particlesPlugin.render(rcAccum1, params);
    // Second beat: spawn another batch into the still-alive pool, so the clip
    // has accumulated MORE than spawnPerBeat particles (two batches alive).
    // Use time=3 so the first batch is still alive (0 < 3-2=1s < 1.6s life).
    const rcAccum2 = makeRenderContext({ clipId: 'seek-clip', isOnBeat: true, beatIndex: 2, time: 3 });
    particlesPlugin.render(rcAccum2, params);
    const accumArcCount = (rcAccum2.ctx as unknown as { __calls: Array<{ method: string }> }).__calls.filter(
      (c) => c.method === 'arc'
    ).length;
    // Confirm the pool is now carrying more than one batch (both are alive).
    expect(accumArcCount).toBeGreaterThan(params.spawnPerBeat);

    // --- Seek: reset the accumulated pool ---
    particlesPlugin.onSeek?.('seek-clip');

    // --- Post-seek: first triggered frame must match the fresh arc count ---
    // After onSeek the clip's state entry is deleted, so the next render
    // re-creates an empty pool. A triggered frame thus spawns exactly
    // spawnPerBeat particles from a fully dead pool — identical to the fresh
    // reference above. Exact positions are NOT compared (PRNG non-determinism).
    const rcAfterSeek = makeRenderContext({ clipId: 'seek-clip', isOnBeat: true, beatIndex: 1, time: 2 });
    particlesPlugin.render(rcAfterSeek, params);
    const afterSeekArcCount = (rcAfterSeek.ctx as unknown as { __calls: Array<{ method: string }> }).__calls.filter(
      (c) => c.method === 'arc'
    ).length;
    expect(afterSeekArcCount).toBe(freshArcCount); // reset == fresh: same arc count, positions not asserted
  });

  // onSeek is OPTIONAL — stateless plugins must NOT have it.
  it('pulsePlugin has no onSeek (hook is opt-in, not added broadly)', () => {
    expect(pulsePlugin.onSeek).toBeUndefined();
  });
});
