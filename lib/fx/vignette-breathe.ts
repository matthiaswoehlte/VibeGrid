import type { FxPlugin, RenderContext } from '@/lib/renderer/types';
import { hexToRgba } from '@/lib/utils/color';

interface VignetteBreatheParams {
  color: string;
  baseSize: number;
  peakSize: number;
  intensity: number;
  decay: number;
}

/**
 * Plan 8e — radial vignette that pulses on every beat. With `baseSize=0`
 * the vignette disappears completely between beats (true pulse). With
 * `baseSize>0` it never fully retracts — it "breathes" between baseSize
 * (off-beat) and peakSize (on-beat).
 *
 * Flow mode: the beat envelope is forced to 0 and the vignette holds at
 * baseSize — gives the producer a static reference shot while authoring.
 *
 * Category B (overlay).
 */
export const vignetteBreathePlugin: FxPlugin<VignetteBreatheParams> = {
  id: 'vignette-breathe',
  name: 'Vignette Breathe',
  kind: 'VignetteBreathe',
  defaultTrigger: 'beat',
  preloadState: 'ready',
  paramSchema: {
    color: { kind: 'color', label: 'Color', default: '#000000' },
    baseSize: {
      kind: 'slider',
      label: 'Base Size',
      min: 0,
      max: 0.8,
      step: 0.01,
      default: 0.0
    },
    peakSize: {
      kind: 'slider',
      label: 'Peak Size',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5
    },
    intensity: {
      kind: 'slider',
      label: 'Intensity',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.7
    },
    decay: {
      kind: 'slider',
      label: 'Decay',
      min: 0.01,
      max: 1,
      step: 0.01,
      default: 0.3,
      unit: 'beats'
    }
  },
  getDefaultParams: (): VignetteBreatheParams => ({
    color: '#000000',
    baseSize: 0.0,
    peakSize: 0.5,
    intensity: 0.7,
    decay: 0.3
  }),
  async preload() {},
  render(rc: RenderContext, params: VignetteBreatheParams) {
    const env = rc.flowMode ? 0 : Math.max(0, 1 - rc.beatPhase / params.decay);
    const vigSize = params.baseSize + (params.peakSize - params.baseSize) * env;
    if (vigSize < 0.001) return;

    const { width: w, height: h } = rc;
    const r = Math.min(w, h);
    const inner = r * (1 - vigSize);
    const outer = r * 1.4;
    const grad = rc.ctx.createRadialGradient(w / 2, h / 2, inner, w / 2, h / 2, outer);
    grad.addColorStop(0, hexToRgba(params.color, 0));
    grad.addColorStop(1, hexToRgba(params.color, params.intensity));

    rc.ctx.save();
    rc.ctx.fillStyle = grad;
    rc.ctx.fillRect(0, 0, w, h);
    rc.ctx.restore();
  }
};
