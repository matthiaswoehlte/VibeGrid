import type { FxPlugin } from '@/lib/renderer/types';

interface BeatFlashParams {
  intensity: number;
  color: string;
  duration: number;
  blendMode: string;
  beatSync: boolean;
}

/**
 * Plan 8e — full-screen colored flash on every beat. Differs from Pulse
 * in three ways: configurable duration (Pulse hard-codes ~1/4 beat), a
 * blend-mode picker (Pulse always paints on top with multiplied alpha),
 * and an envelope-based decay (Pulse fires only on the exact `isOnBeat`
 * frame). Use BeatFlash when you want a longer, mode-selectable flash;
 * use Pulse for the simple instant blink.
 *
 * Blend modes: 'source-over' (= normal alpha blend), 'screen' (additive,
 * brighter), 'overlay' (contrast boost). `'normal'` is intentionally NOT
 * an option — Canvas2D treats it as an invalid value and silently keeps
 * the previous compositing mode, which would leak FX state across plugin
 * calls. `'source-over'` is the canonical default-alpha mode.
 *
 * Category B (overlay) — paints on top of whatever was drawn, never
 * touches `rc.imageBitmap`.
 */
export const beatFlashPlugin: FxPlugin<BeatFlashParams> = {
  id: 'beat-flash',
  name: 'Beat Flash',
  kind: 'BeatFlash',
  defaultTrigger: 'beat',
  supportsSubdivision: true,
  preloadState: 'ready',
  paramSchema: {
    intensity: {
      kind: 'slider',
      label: 'Intensity',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.8
    },
    color: { kind: 'color', label: 'Color', default: '#ffffff' },
    duration: {
      kind: 'slider',
      label: 'Duration',
      min: 0.01,
      max: 1,
      step: 0.01,
      default: 0.1,
      unit: 'beats'
    },
    blendMode: {
      kind: 'select',
      label: 'Blend',
      options: [
        { value: 'source-over', label: 'Normal' },
        { value: 'screen', label: 'Screen' },
        { value: 'overlay', label: 'Overlay' }
      ],
      default: 'screen'
    },
    beatSync: { kind: 'toggle', label: 'Beat Sync', default: true }
  },
  getDefaultParams: (): BeatFlashParams => ({
    intensity: 0.8,
    color: '#ffffff',
    duration: 0.1,
    blendMode: 'screen',
    beatSync: true,
  }),
  async preload() {},
  render(rc, params) {
    if (rc.flowMode) return;
    const synced = params.beatSync;
    const env = synced
      ? Math.max(0, 1 - rc.subdividedBeatPhase / params.duration)
      : 1.0;
    if (env < 0.01) return;
    rc.ctx.save();
    rc.ctx.globalAlpha *= params.intensity * env;
    rc.ctx.globalCompositeOperation = params.blendMode as GlobalCompositeOperation;
    rc.ctx.fillStyle = params.color;
    rc.ctx.fillRect(0, 0, rc.width, rc.height);
    rc.ctx.restore();
  }
};
