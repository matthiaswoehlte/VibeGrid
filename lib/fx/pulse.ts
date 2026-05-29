import type { FxPlugin } from '@/lib/renderer/types';

interface PulseParams {
  color: string;
  intensity: number;
}

export const pulsePlugin: FxPlugin<PulseParams> = {
  id: 'pulse',
  name: 'Pulse',
  kind: 'Pulse',
  defaultTrigger: 'beat',
  supportsSubdivision: true,
  preloadState: 'ready',
  paramSchema: {
    color: { kind: 'color', default: '#ffffff', label: 'Glow color' },
    intensity: {
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.6,
      label: 'Intensity'
    }
  },
  getDefaultParams: () => ({ color: '#ffffff', intensity: 0.6 }),
  async preload() {
    // Pulse never preloads — preloadState stays 'ready'.
  },
  render(rc, params) {
    // Flow Mode kills the beat flash entirely — Pulse has no continuous
    // animation, so flowMode + no beat trigger == nothing to paint.
    if (rc.flowMode) return;
    if (!rc.isOnBeat) return;
    const decay = Math.max(0, 1 - rc.subdividedBeatPhase * 4);
    rc.ctx.save();
    // *= so the outer crossfade alpha set by the renderer composes correctly.
    rc.ctx.globalAlpha *= decay * params.intensity;
    rc.ctx.fillStyle = params.color;
    rc.ctx.fillRect(0, 0, rc.width, rc.height);
    rc.ctx.restore();
  }
};
