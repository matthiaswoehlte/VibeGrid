import type { FxPlugin } from '@/lib/renderer/types';

interface SweepParams {
  color: string;
  speed: number;
  radius: number;
}

const ORB_COUNT = 3;

export const sweepPlugin: FxPlugin<SweepParams> = {
  id: 'sweep',
  name: 'Sweep',
  kind: 'Sweep',
  defaultTrigger: 'bar',
  preloadState: 'ready',
  paramSchema: {
    color: { kind: 'color', default: '#a86bff', label: 'Orb color' },
    speed: {
      kind: 'slider',
      min: 10,
      max: 400,
      step: 10,
      default: 80,
      unit: 'px/s',
      label: 'Drift speed'
    },
    radius: {
      kind: 'slider',
      min: 50,
      max: 400,
      step: 10,
      default: 180,
      unit: 'px',
      label: 'Orb radius'
    }
  },
  getDefaultParams: () => ({ color: '#a86bff', speed: 80, radius: 180 }),
  async preload() {},
  render(rc, params) {
    const driftPx = params.speed * rc.time;
    for (let i = 0; i < ORB_COUNT; i++) {
      const phase = i / ORB_COUNT;
      const x = ((driftPx + phase * rc.width) % (rc.width + params.radius * 2)) - params.radius;
      const y = rc.height * (0.3 + 0.4 * phase);
      const grad = rc.ctx.createRadialGradient(x, y, 0, x, y, params.radius);
      grad.addColorStop(0, params.color);
      grad.addColorStop(1, 'transparent');
      rc.ctx.save();
      rc.ctx.fillStyle = grad as unknown as string;
      rc.ctx.globalAlpha = 0.5;
      rc.ctx.fillRect(x - params.radius, y - params.radius, params.radius * 2, params.radius * 2);
      rc.ctx.restore();
    }
  }
};
