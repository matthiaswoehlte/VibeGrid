import type { FxPlugin } from '@/lib/renderer/types';

type ParticleDirection =
  | 'bottom-up'
  | 'top-down'
  | 'left-right'
  | 'right-left'
  | 'center-out'
  | 'bl-tr'
  | 'tl-br'
  | 'tr-bl'
  | 'br-tl';

interface ParticlesParams {
  color: string;
  spawnPerBeat: number;
  life: number;
  size: number;
  direction: ParticleDirection;
  speed: number;
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

interface ClipState {
  pool: Particle[];
  lastSpawnBeat: number | null;
}

// Per-clip state — two overlapping Particles clips need independent pools
// so their crossfade can show one set of particles fading out while another
// fades in. The renderer passes the clip id via RenderContext.clipId.
const clipStates = new Map<string, ClipState>();

function getOrCreateState(clipId: string): ClipState {
  let s = clipStates.get(clipId);
  if (!s) {
    s = { pool: makePool(), lastSpawnBeat: null };
    clipStates.set(clipId, s);
  }
  return s;
}

interface SpawnRC {
  width: number;
  height: number;
  time: number;
}

/** Initial (x, y) and (vx, vy) for one particle, in canvas pixel coordinates.
 *  Per-direction spawn geometry — the renderer then advances by (vx, vy) * dt. */
function spawnGeometry(
  rc: SpawnRC,
  direction: ParticleDirection,
  speed: number
): { x: number; y: number; vx: number; vy: number } {
  const jitter = (range: number) => (Math.random() - 0.5) * range;
  const speedFactor = 1 + Math.random() * 0.5; // 1..1.5x variance
  const v = speed * speedFactor;
  switch (direction) {
    case 'bottom-up':
      return {
        x: Math.random() * rc.width,
        y: rc.height,
        vx: jitter(60),
        vy: -v
      };
    case 'top-down':
      return {
        x: Math.random() * rc.width,
        y: 0,
        vx: jitter(60),
        vy: v
      };
    case 'left-right':
      return {
        x: 0,
        y: Math.random() * rc.height,
        vx: v,
        vy: jitter(60)
      };
    case 'right-left':
      return {
        x: rc.width,
        y: Math.random() * rc.height,
        vx: -v,
        vy: jitter(60)
      };
    case 'center-out': {
      const angle = Math.random() * Math.PI * 2;
      return {
        x: rc.width / 2,
        y: rc.height / 2,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v
      };
    }
    case 'bl-tr':
      return {
        x: Math.random() * rc.width * 0.4,
        y: rc.height - Math.random() * rc.height * 0.2,
        vx: v * 0.7,
        vy: -v * 0.7
      };
    case 'tl-br':
      return {
        x: Math.random() * rc.width * 0.4,
        y: Math.random() * rc.height * 0.2,
        vx: v * 0.7,
        vy: v * 0.7
      };
    case 'tr-bl':
      return {
        x: rc.width - Math.random() * rc.width * 0.4,
        y: Math.random() * rc.height * 0.2,
        vx: -v * 0.7,
        vy: v * 0.7
      };
    case 'br-tl':
      return {
        x: rc.width - Math.random() * rc.width * 0.4,
        y: rc.height - Math.random() * rc.height * 0.2,
        vx: -v * 0.7,
        vy: -v * 0.7
      };
  }
}

function spawn(
  rc: SpawnRC,
  pool: Particle[],
  count: number,
  direction: ParticleDirection,
  speed: number
): void {
  let spawned = 0;
  for (const p of pool) {
    if (spawned >= count) break;
    if (p.alive) continue;
    p.alive = true;
    const g = spawnGeometry(rc, direction, speed);
    p.x = g.x;
    p.y = g.y;
    p.vx = g.vx;
    p.vy = g.vy;
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
    size: { kind: 'slider', min: 1, max: 12, step: 1, default: 3, unit: 'px', label: 'Size' },
    direction: {
      kind: 'select',
      options: [
        { value: 'bottom-up', label: '↑ Bottom → top' },
        { value: 'top-down', label: '↓ Top → bottom' },
        { value: 'left-right', label: '→ Left → right' },
        { value: 'right-left', label: '← Right → left' },
        { value: 'center-out', label: '⊙ Center → out' },
        { value: 'bl-tr', label: '↗ Bottom-left → top-right' },
        { value: 'tl-br', label: '↘ Top-left → bottom-right' },
        { value: 'tr-bl', label: '↙ Top-right → bottom-left' },
        { value: 'br-tl', label: '↖ Bottom-right → top-left' }
      ],
      default: 'bottom-up',
      label: 'Direction'
    },
    speed: {
      kind: 'slider',
      min: 20,
      max: 400,
      step: 10,
      default: 140,
      unit: 'px/s',
      label: 'Speed'
    }
  },
  getDefaultParams: () => ({
    color: '#2ee0d0',
    spawnPerBeat: 12,
    life: 1.6,
    size: 3,
    direction: 'bottom-up',
    speed: 140
  }),
  async preload() {},
  render(rc, params) {
    const state = getOrCreateState(rc.clipId);
    // Flow Mode suppresses the beat-burst spawn — existing in-flight
    // particles keep animating to their natural life-end so the toggle
    // doesn't snap-clear the screen; the pool simply stops being refilled.
    if (!rc.flowMode && rc.isOnBeat && state.lastSpawnBeat !== rc.beatIndex) {
      state.lastSpawnBeat = rc.beatIndex;
      spawn(rc, state.pool, params.spawnPerBeat, params.direction, params.speed);
    }

    rc.ctx.save();
    // Capture the outer alpha (set by the renderer's crossfade envelope) and
    // multiply each particle's life-decay on top. Naive `*= (1 - lifeT)` would
    // compound across particles since the loop shares one outer save/restore.
    const baseAlpha = rc.ctx.globalAlpha;
    rc.ctx.fillStyle = params.color;
    for (const p of state.pool) {
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
  onSeek(clipId: string) {
    clipStates.delete(clipId);
  },
  dispose() {
    clipStates.clear();
  }
};
