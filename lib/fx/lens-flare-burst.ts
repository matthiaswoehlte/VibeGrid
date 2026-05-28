import type { FxPlugin, RenderContext } from '@/lib/renderer/types';
import { hexToRgba } from '@/lib/utils/color';

interface LensFlareBurstParams {
  color: string;
  intensity: number;
  rayCount: number;
  rayLength: number;
  centerX: number;
  centerY: number;
  decay: number;
  beatSync: number;
}

/**
 * Plan 8e — radial light burst on every beat. Draws `rayCount` linear
 * gradients fanning out from `(centerX, centerY)` (both expressed as
 * fractions of canvas size) plus a central radial-gradient glow. All
 * rays + glow composite via `screen` so they brighten what's underneath
 * rather than overlay-blend it.
 *
 * Category B (overlay).
 */
export const lensFlareBurstPlugin: FxPlugin<LensFlareBurstParams> = {
  id: 'lens-flare-burst',
  name: 'Lens Flare',
  kind: 'LensFlareBurst',
  defaultTrigger: 'beat',
  preloadState: 'ready',
  paramSchema: {
    color: { kind: 'color', label: 'Color', default: '#ffffff' },
    intensity: {
      kind: 'slider',
      label: 'Intensity',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6
    },
    rayCount: {
      kind: 'slider',
      label: 'Ray Count',
      min: 4,
      max: 16,
      step: 1,
      default: 8
    },
    rayLength: {
      kind: 'slider',
      label: 'Ray Length',
      min: 0.2,
      max: 1.0,
      step: 0.05,
      default: 0.5
    },
    centerX: {
      kind: 'slider',
      label: 'Center X',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5
    },
    centerY: {
      kind: 'slider',
      label: 'Center Y',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5
    },
    decay: {
      kind: 'slider',
      label: 'Decay',
      min: 0.01,
      max: 0.5,
      step: 0.01,
      default: 0.2,
      unit: 'beats'
    },
    beatSync: {
      kind: 'slider',
      label: 'Beat Sync',
      min: 0,
      max: 1,
      step: 1,
      default: 1,
    }
  },
  getDefaultParams: (): LensFlareBurstParams => ({
    color: '#ffffff',
    intensity: 0.6,
    rayCount: 8,
    rayLength: 0.5,
    centerX: 0.5,
    centerY: 0.5,
    decay: 0.2,
    beatSync: 1,
  }),
  async preload() {},
  render(rc: RenderContext, params: LensFlareBurstParams) {
    if (rc.flowMode) return;
    const synced = params.beatSync >= 0.5;
    const env = synced
      ? Math.max(0, 1 - rc.beatPhase / params.decay)
      : 1.0;
    if (env < 0.01) return;
    const { width: w, height: h } = rc;
    const cx = w * params.centerX;
    const cy = h * params.centerY;
    const len = w * params.rayLength * env;
    const rayCount = Math.max(1, Math.round(params.rayCount));

    rc.ctx.save();
    rc.ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < rayCount; i++) {
      const angle = (i / rayCount) * Math.PI * 2;
      const ex = cx + Math.cos(angle) * len;
      const ey = cy + Math.sin(angle) * len;
      const grad = rc.ctx.createLinearGradient(cx, cy, ex, ey);
      grad.addColorStop(0, hexToRgba(params.color, params.intensity * env));
      grad.addColorStop(1, hexToRgba(params.color, 0));
      rc.ctx.beginPath();
      rc.ctx.moveTo(cx, cy);
      rc.ctx.lineTo(ex, ey);
      rc.ctx.strokeStyle = grad;
      rc.ctx.lineWidth = Math.max(1, 3 * env);
      rc.ctx.stroke();
    }

    // Central glow disc.
    const glow = rc.ctx.createRadialGradient(cx, cy, 0, cx, cy, 50 * env);
    glow.addColorStop(0, hexToRgba(params.color, params.intensity * env));
    glow.addColorStop(1, hexToRgba(params.color, 0));
    rc.ctx.fillStyle = glow;
    rc.ctx.fillRect(0, 0, w, h);

    rc.ctx.restore();
  }
};
