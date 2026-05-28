import type { FxPlugin } from '@/lib/renderer/types';

interface BeatFlashParams {
  intensity: number;
  color: string;
  duration: number;
  blendMode: string;
  beatSync: number;
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
    // TODO(Plan-UX-1): replace beatSync slider (step:1) with kind:'toggle'
    // when Inspector supports toggle params. Touch-UX is suboptimal with
    // a 2-stop slider.
    beatSync: {
      kind: 'slider',
      label: 'Beat Sync',
      min: 0,
      max: 1,
      step: 1,
      default: 1,
    }
  },
  getDefaultParams: (): BeatFlashParams => ({
    intensity: 0.8,
    color: '#ffffff',
    duration: 0.1,
    blendMode: 'screen',
    beatSync: 1,
  }),
  async preload() {},
  render(rc, params) {
    if (rc.flowMode) return;
    const synced = params.beatSync >= 0.5;
    const env = synced
      ? Math.max(0, 1 - rc.beatPhase / params.duration)
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
