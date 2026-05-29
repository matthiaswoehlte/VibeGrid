import type { FxPlugin, RenderContext } from '@/lib/renderer/types';
import { containRect } from '@/lib/renderer/loop';

interface ScreenShakeParams {
  intensity: number;
  frequency: number;
  decay: number;
  axis: string;
  beatSync: boolean;
}

/**
 * Plan 8e — camera-shake impulse on every beat. The image is re-drawn
 * with a sinusoidal translate(dx, dy) whose envelope decays across the
 * beat. `intensity` is a fraction of canvas width (not raw pixels) so
 * the visible shake stays consistent across viewport sizes — a 1080p
 * stage and a Capacitor-iPhone-SE viewport see the same proportional
 * shake. `frequency` controls oscillations per beat.
 *
 * `axis='both'` mixes a sine on X and a slightly off-frequency cosine
 * on Y (1.3× scaling) so the trajectory is a Lissajous-style wobble
 * rather than a diagonal line. Single-axis modes zero the other axis.
 *
 * Category A (image-modifying).
 */
export const screenShakePlugin: FxPlugin<ScreenShakeParams> = {
  id: 'screen-shake',
  name: 'Screen Shake',
  kind: 'ScreenShake',
  defaultTrigger: 'beat',
  supportsSubdivision: true,
  preloadState: 'ready',
  paramSchema: {
    intensity: {
      kind: 'slider',
      label: 'Intensity',
      min: 0,
      max: 0.03,
      step: 0.001,
      default: 0.004
    },
    frequency: {
      kind: 'slider',
      label: 'Frequency',
      min: 0.5,
      max: 4,
      step: 0.1,
      default: 2
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
    axis: {
      kind: 'select',
      label: 'Axis',
      options: [
        { value: 'both', label: 'Both' },
        { value: 'x', label: 'Horizontal' },
        { value: 'y', label: 'Vertical' }
      ],
      default: 'both'
    },
    beatSync: { kind: 'toggle', label: 'Beat Sync', default: true }
  },
  getDefaultParams: (): ScreenShakeParams => ({
    intensity: 0.004,
    frequency: 2,
    decay: 0.4,
    axis: 'both',
    beatSync: true,
  }),
  async preload() {},
  render(rc: RenderContext, params: ScreenShakeParams) {
    if (!rc.imageBitmap) return;
    if (rc.flowMode) return;
    const synced = params.beatSync;
    const env = synced
      ? Math.max(0, 1 - rc.subdividedBeatPhase / params.decay)
      : 1.0;
    if (env < 0.01) return;

    const px = rc.width * params.intensity;
    const t = rc.subdividedBeatPhase * params.frequency * Math.PI * 2;
    const dx = params.axis !== 'y' ? Math.sin(t) * px * env : 0;
    const dy = params.axis !== 'x' ? Math.cos(t * 1.3) * px * env : 0;

    const { sx, sy, sw, sh } = containRect(rc);
    rc.ctx.save();
    rc.ctx.translate(dx, dy);
    rc.ctx.drawImage(rc.imageBitmap, sx, sy, sw, sh);
    rc.ctx.restore();
  }
};
