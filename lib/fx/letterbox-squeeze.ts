import type { FxPlugin, RenderContext } from '@/lib/renderer/types';

interface LetterboxSqueezeParams {
  targetRatio: string;
  attack: number;
  decay: number;
  intensity: number;
  color: string;
}

/**
 * Plan 8e — cinematic letterbox bars that squeeze in on every beat
 * (attack ramp) and ease out (decay tail). Target aspect ratios cover
 * 2.35:1 Scope, 2.39:1 Ultra Panavision, and 1.85:1 Flat. The actual
 * bar height is derived from the canvas aspect — if the canvas is
 * ALREADY wider than the target ratio, the FX no-ops (no negative bars).
 *
 * Flow mode: bars hold at their static `intensity × targetBarHeight`
 * position — useful for screenshots and reviewing aspect during edit.
 *
 * Category B (overlay). Painted LAST in the render order so it covers
 * any other FX that strayed into the bar zone (intentional — the bar
 * IS the frame edge).
 */
export const letterboxSqueezePlugin: FxPlugin<LetterboxSqueezeParams> = {
  id: 'letterbox-squeeze',
  name: 'Letterbox',
  kind: 'LetterboxSqueeze',
  defaultTrigger: 'beat',
  preloadState: 'ready',
  paramSchema: {
    targetRatio: {
      kind: 'select',
      label: 'Ratio',
      options: [
        { value: '2.35:1', label: '2.35:1 Scope' },
        { value: '2.39:1', label: '2.39:1 Ultra' },
        { value: '1.85:1', label: '1.85:1 Flat' }
      ],
      default: '2.35:1'
    },
    attack: {
      kind: 'slider',
      label: 'Attack',
      min: 0.01,
      max: 0.2,
      step: 0.01,
      default: 0.05,
      unit: 'beats'
    },
    decay: {
      kind: 'slider',
      label: 'Decay',
      min: 0.01,
      max: 1,
      step: 0.01,
      default: 0.4,
      unit: 'beats'
    },
    intensity: {
      kind: 'slider',
      label: 'Intensity',
      min: 0,
      max: 1,
      step: 0.01,
      default: 1.0
    },
    color: { kind: 'color', label: 'Color', default: '#000000' }
  },
  getDefaultParams: (): LetterboxSqueezeParams => ({
    targetRatio: '2.35:1',
    attack: 0.05,
    decay: 0.4,
    intensity: 1.0,
    color: '#000000'
  }),
  async preload() {},
  render(rc: RenderContext, params: LetterboxSqueezeParams) {
    const { width: w, height: h } = rc;
    const ratio = parseFloat(params.targetRatio);
    if (!isFinite(ratio) || ratio <= 0) return;
    const targetBarH = Math.max(0, (h - w / ratio) / 2);
    if (targetBarH <= 1) return; // canvas already wider than target

    let env: number;
    if (rc.flowMode) {
      env = params.intensity;
    } else {
      const p = rc.beatPhase;
      env =
        p < params.attack
          ? params.intensity * (p / params.attack)
          : params.intensity *
            Math.max(0, 1 - (p - params.attack) / params.decay);
    }
    if (env < 0.001) return;

    const barH = targetBarH * env;
    rc.ctx.save();
    rc.ctx.fillStyle = params.color;
    rc.ctx.fillRect(0, 0, w, barH);
    rc.ctx.fillRect(0, h - barH, w, barH);
    rc.ctx.restore();
  }
};
