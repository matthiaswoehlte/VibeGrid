import type { FxPlugin } from '@/lib/renderer/types';

interface ParticlesParams {
  color: string;
  spawnPerBeat: number;
  life: number;
  size: number;
}

interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  bornAt: number;
}

const POOL_SIZE = 200;

function makePool(): Particle[] {
  return Array.from({ length: POOL_SIZE }, () => ({
    alive: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    bornAt: 0
  }));
}

// v0.1: module-level state — single particles track expected.
// Two simultaneous particles clips would share `lastSpawnBeat` and `pool`.
// v0.2: move pool + lastSpawnBeat into a per-instance closure if multi-track
// support is needed. Tests must call `particlesPlugin.dispose()` in afterEach
// to keep the spawn-guard deterministic.
let pool: Particle[] = makePool();
let lastSpawnBeat: number | null = null;

function spawn(rc: { width: number; height: number; time: number }, count: number): void {
  let spawned = 0;
  for (const p of pool) {
    if (spawned >= count) break;
    if (p.alive) continue;
    p.alive = true;
    p.x = Math.random() * rc.width;
    p.y = rc.height;
    p.vx = (Math.random() - 0.5) * 60;
    p.vy = -80 - Math.random() * 120;
    p.bornAt = rc.time;
    spawned++;
  }
}

export const particlesPlugin: FxPlugin<ParticlesParams> = {
  id: 'particles',
  name: 'Particles',
  kind: 'Particle',
  defaultTrigger: 'beat',
  preloadState: 'ready',
  paramSchema: {
    color: { kind: 'color', default: '#2ee0d0', label: 'Color' },
    spawnPerBeat: {
      kind: 'slider',
      min: 1,
      max: 40,
      step: 1,
      default: 12,
      label: 'Particles per beat'
    },
    life: { kind: 'slider', min: 0.5, max: 4, step: 0.1, default: 1.6, unit: 's', label: 'Life' },
    size: { kind: 'slider', min: 1, max: 12, step: 1, default: 3, unit: 'px', label: 'Size' }
  },
  getDefaultParams: () => ({ color: '#2ee0d0', spawnPerBeat: 12, life: 1.6, size: 3 }),
  async preload() {},
  render(rc, params) {
    if (rc.isOnBeat && lastSpawnBeat !== rc.beatIndex) {
      lastSpawnBeat = rc.beatIndex;
      spawn(rc, params.spawnPerBeat);
    }

    rc.ctx.save();
    // Capture the outer alpha (set by the renderer's crossfade envelope) and
    // multiply each particle's life-decay on top. Naive `*= (1 - lifeT)` would
    // compound across particles since the loop shares one outer save/restore.
    const baseAlpha = rc.ctx.globalAlpha;
    rc.ctx.fillStyle = params.color;
    for (const p of pool) {
      if (!p.alive) continue;
      const age = rc.time - p.bornAt;
      if (age >= params.life) {
        p.alive = false;
        continue;
      }
      const dt = 1 / 60;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const lifeT = age / params.life;
      rc.ctx.globalAlpha = baseAlpha * (1 - lifeT);
      rc.ctx.beginPath();
      rc.ctx.arc(p.x, p.y, params.size, 0, Math.PI * 2);
      rc.ctx.fill();
    }
    rc.ctx.restore();
  },
  dispose() {
    pool = makePool();
    lastSpawnBeat = null;
  }
};
