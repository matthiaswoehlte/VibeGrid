import type { FxPlugin, RenderContext } from '@/lib/renderer/types';
import {
  FX_DIRECTION_OPTIONS,
  directionToOrigin,
  directionToAngle,
  type FXDirection
} from './direction';
import { hexToRgba } from '@/lib/utils/color';

interface SunrayParams {
  direction: FXDirection;
  color: string;
  intensity: number;
  rayCount: number;
  spread: number;
  decay: number;
}

const RAY_TRIANGLE_HALFSPREAD = 0.04; // radians — each ray is a narrow wedge

/**
 * Plan 5.8a Task 6 — directional light rays from a chosen origin.
 *
 * Stateless beat-pulse: `pulseAlpha` peaks at beatPhase=0 and decays
 * with `decay`. In flow mode the beat-pulse is replaced by a
 * continuous half-strength glow so the rays don't vanish entirely.
 *
 * Geometry per ray:
 *   angle = baseAngle + (i/rayCount) × spreadAngle − spreadAngle/2
 *   ray   = narrow triangle from origin, fanning out by spreadAngle
 *   colour = linear-gradient(origin → far, color@pulseAlpha → color@0)
 *   maxLength = canvas diagonal — guarantees the ray always reaches off-screen
 */
export const sunrayPlugin: FxPlugin<SunrayParams> = {
  id: 'sunray',
  name: 'Sunray',
  kind: 'Sunray',
  defaultTrigger: 'beat',
  preloadState: 'ready',
  paramSchema: {
    direction: {
      kind: 'select',
      options: [...FX_DIRECTION_OPTIONS],
      default: 'top',
      label: 'Origin'
    },
    color: { kind: 'color', default: '#fffbe6', label: 'Color' },
    intensity: {
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.6,
      label: 'Intensity'
    },
    rayCount: {
      kind: 'slider',
      min: 3,
      max: 16,
      step: 1,
      default: 8,
      label: 'Ray count'
    },
    spread: {
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.6,
      label: 'Spread'
    },
    decay: {
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.65,
      label: 'Decay'
    }
  },
  getDefaultParams: (): SunrayParams => ({
    direction: 'top',
    color: '#fffbe6',
    intensity: 0.6,
    rayCount: 8,
    spread: 0.6,
    decay: 0.65
  }),
  async preload() {},
  render(rc: RenderContext, params: SunrayParams): void {
    // Beat-pulse envelope (or continuous half-strength glow in flow mode).
    const beatPulse = Math.max(0, 1 - rc.beatPhase * (1 + params.decay * 3));
    const pulseAlpha = rc.flowMode
      ? params.intensity * 0.5
      : params.intensity * beatPulse;
    if (pulseAlpha <= 0) return;

    const origin = directionToOrigin(params.direction, rc.width, rc.height);
    const baseAngle = directionToAngle(params.direction);
    const spreadAngle = params.spread * Math.PI; // max = 180°
    const maxLength = Math.hypot(rc.width, rc.height);
    const rayCount = Math.max(1, Math.min(16, Math.round(params.rayCount)));

    rc.ctx.save();
    for (let i = 0; i < rayCount; i++) {
      // Distribute rays evenly across spreadAngle, centred on baseAngle.
      const angle =
        baseAngle + (i / Math.max(1, rayCount - 1)) * spreadAngle - spreadAngle / 2;
      const ex = origin.x + Math.cos(angle) * maxLength;
      const ey = origin.y + Math.sin(angle) * maxLength;
      const grad = rc.ctx.createLinearGradient(origin.x, origin.y, ex, ey);
      grad.addColorStop(0, hexToRgba(params.color, pulseAlpha));
      grad.addColorStop(1, hexToRgba(params.color, 0));

      rc.ctx.beginPath();
      rc.ctx.moveTo(origin.x, origin.y);
      rc.ctx.lineTo(
        origin.x + Math.cos(angle - RAY_TRIANGLE_HALFSPREAD) * maxLength,
        origin.y + Math.sin(angle - RAY_TRIANGLE_HALFSPREAD) * maxLength
      );
      rc.ctx.lineTo(
        origin.x + Math.cos(angle + RAY_TRIANGLE_HALFSPREAD) * maxLength,
        origin.y + Math.sin(angle + RAY_TRIANGLE_HALFSPREAD) * maxLength
      );
      rc.ctx.closePath();
      rc.ctx.fillStyle = grad;
      rc.ctx.fill();
    }
    rc.ctx.restore();
  }
};
