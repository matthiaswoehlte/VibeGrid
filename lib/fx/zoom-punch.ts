import type { FxPlugin, RenderContext } from '@/lib/renderer/types';
import { containRect } from '@/lib/renderer/loop';

interface ZoomPunchParams {
  strength: number;
  attack: number;
  decay: number;
  direction: string;
}

/**
 * Plan 8e — impulsive zoom on every beat. Unlike ZoomPulse (smooth fade
 * across the whole beat), ZoomPunch has a configurable `attack` ramp
 * (typically very short, 0.01–0.05 beats) and a `decay` tail. Choose
 * `direction='in'` for the classic camera-push, `'out'` for a brief
 * shrink that exposes letterbox bars at the peak — intentional Zoom-Out
 * effect, not a bug.
 *
 * Strength=1.0 means "no effect" (scale stays 1, early-return skips the
 * draw). Attack-min is 0.01 to dodge division-by-zero at exact beat
 * onset when the slider sits at its floor.
 *
 * Category A (image-modifying) — re-draws `rc.imageBitmap` via
 * `containRect()`. Loop guards on `rc.imageBitmap` presence; the
 * `if (!rc.imageBitmap) return` here is a belt-and-braces local guard.
 */
export const zoomPunchPlugin: FxPlugin<ZoomPunchParams> = {
  id: 'zoom-punch',
  name: 'Zoom Punch',
  kind: 'ZoomPunch',
  defaultTrigger: 'beat',
  preloadState: 'ready',
  paramSchema: {
    strength: {
      kind: 'slider',
      label: 'Strength',
      min: 1.0,
      max: 1.3,
      step: 0.01,
      default: 1.12
    },
    attack: {
      kind: 'slider',
      label: 'Attack',
      min: 0.01,
      max: 0.1,
      step: 0.01,
      default: 0.02,
      unit: 'beats'
    },
    decay: {
      kind: 'slider',
      label: 'Decay',
      min: 0.01,
      max: 0.5,
      step: 0.01,
      default: 0.15,
      unit: 'beats'
    },
    direction: {
      kind: 'select',
      label: 'Direction',
      options: [
        { value: 'in', label: 'Zoom In' },
        { value: 'out', label: 'Zoom Out' }
      ],
      default: 'in'
    }
  },
  getDefaultParams: (): ZoomPunchParams => ({
    strength: 1.12,
    attack: 0.02,
    decay: 0.15,
    direction: 'in'
  }),
  async preload() {},
  render(rc: RenderContext, params: ZoomPunchParams) {
    if (!rc.imageBitmap) return;
    if (rc.flowMode) return;
    const p = rc.beatPhase;
    let scale: number;
    if (p < params.attack) {
      scale = 1 + (params.strength - 1) * (p / params.attack);
    } else {
      scale =
        1 + (params.strength - 1) * Math.max(0, 1 - (p - params.attack) / params.decay);
    }
    if (params.direction === 'out') scale = 2 - scale;
    if (Math.abs(scale - 1) < 0.001) return;

    const { sx, sy, sw, sh } = containRect(rc);
    const cx = rc.width / 2;
    const cy = rc.height / 2;
    rc.ctx.save();
    rc.ctx.translate(cx, cy);
    rc.ctx.scale(scale, scale);
    rc.ctx.translate(-cx, -cy);
    rc.ctx.drawImage(rc.imageBitmap, sx, sy, sw, sh);
    rc.ctx.restore();
  }
};
