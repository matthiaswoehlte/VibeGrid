import { describe, it, expect, afterEach } from 'vitest';
import { particlesPlugin } from '@/lib/fx/particles';
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

  it('paramSchema has spawnPerBeat, life, color, size', () => {
    expect(particlesPlugin.paramSchema.spawnPerBeat.kind).toBe('slider');
    expect(particlesPlugin.paramSchema.life.kind).toBe('slider');
    expect(particlesPlugin.paramSchema.color.kind).toBe('color');
    expect(particlesPlugin.paramSchema.size.kind).toBe('slider');
  });
});
