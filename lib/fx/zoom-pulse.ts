import type { FxPlugin } from '@/lib/renderer/types';

interface ZoomPulseParams {
  intensity: number;
  decay: number;
}

/**
 * Re-draws the active image bitmap with a centered scale transform that peaks
 * on each beat (`beatPhase = 0`) and fades back to 1.0 across the beat. The
 * `decay` slider steepens the fade. Skips rendering entirely when the scale
 * would be exactly 1.0 — avoids a redundant overlay of the same image.
 */
export const zoomPulsePlugin: FxPlugin<ZoomPulseParams> = {
  id: 'zoom-pulse',
  name: 'Zoom Pulse',
  kind: 'ZoomPulse',
  defaultTrigger: 'beat',
  preloadState: 'ready',
  paramSchema: {
    intensity: {
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.3,
      label: 'Zoom intensity'
    },
    decay: {
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
      label: 'Decay'
    }
  },
  getDefaultParams: () => ({ intensity: 0.3, decay: 0.5 }),
  async preload() {
    // No preload step — preloadState stays 'ready'.
  },
  render(rc, params) {
    if (!rc.imageBitmap) return;
    // Flow Mode disables the per-beat scale punch. Without it the image
    // would zoom on every beat regardless of the master toggle (ZoomPulse
    // reads beatPhase directly, not the isOnBeat flag).
    if (rc.flowMode) return;
    const fade = Math.max(0, 1 - rc.beatPhase * (1 + params.decay * 3));
    if (fade <= 0 || params.intensity <= 0) return;
    const scale = 1 + params.intensity * fade;
    if (scale === 1) return;

    const bm = rc.imageBitmap;
    rc.ctx.save();
    rc.ctx.translate(rc.width / 2, rc.height / 2);
    rc.ctx.scale(scale, scale);
    rc.ctx.translate(-rc.width / 2, -rc.height / 2);
    // Inline drawImage-contain math — same as drawImageContain in loop.ts.
    const contain = Math.min(rc.width / bm.width, rc.height / bm.height);
    const sw = bm.width * contain;
    const sh = bm.height * contain;
    const sx = (rc.width - sw) / 2;
    const sy = (rc.height - sh) / 2;
    rc.ctx.drawImage(bm, sx, sy, sw, sh);
    rc.ctx.restore();
  }
};
