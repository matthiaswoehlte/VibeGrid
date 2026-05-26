import type { FxPlugin, RenderContext } from '@/lib/renderer/types';
import { containRect } from '@/lib/renderer/loop';

interface RGBSplitParams {
  offset: number;
  decay: number;
  intensity: number;
}

/**
 * Plan 8e — chromatic aberration burst on every beat. The bitmap is
 * drawn once at center, then a red-tinted copy is offset to +X and a
 * blue-tinted copy to -X. The R and B copies are produced on per-clip
 * offscreens via a multiply with `rgba(255,0,0)` / `rgba(0,0,255)` to
 * isolate the channel, then `screen`-composited onto the main canvas.
 *
 * Why offscreens (and not multiply-on-main-canvas): the multiply would
 * also multiply against the already-drawn original, zeroing two channels
 * everywhere. Channel isolation only works on a clean offscreen. The
 * intermediate canvases are cached per `clipId` so the per-frame cost
 * stays at 2 × (clearRect + drawImage + multiply-fillRect).
 *
 * Performance trade-off vs. ImageData: this is a composite-tint
 * approximation, not pixel-perfect channel isolation. Bright pixels may
 * leak a tinge into adjacent channels because Canvas2D's `multiply`
 * operates on premultiplied alpha. Documented in KNOWN_LIMITATIONS.
 *
 * Category A (image-modifying) — re-draws `rc.imageBitmap` via
 * `containRect()`; loop.ts guards on `rc.imageBitmap` presence.
 */
const rgbOffByClip = new Map<
  string,
  { r: OffscreenCanvas; b: OffscreenCanvas; w: number; h: number }
>();

export const rgbSplitPlugin: FxPlugin<RGBSplitParams> = {
  id: 'rgb-split',
  name: 'RGB Split',
  kind: 'RGBSplit',
  defaultTrigger: 'beat',
  preloadState: 'ready',
  paramSchema: {
    offset: {
      kind: 'slider',
      label: 'Offset',
      min: 0,
      max: 0.05,
      step: 0.001,
      default: 0.004
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
    intensity: {
      kind: 'slider',
      label: 'Intensity',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6
    }
  },
  getDefaultParams: (): RGBSplitParams => ({
    offset: 0.004,
    decay: 0.15,
    intensity: 0.6
  }),
  async preload() {},
  render(rc: RenderContext, params: RGBSplitParams) {
    if (!rc.imageBitmap) return;
    if (rc.flowMode) return;
    const env = Math.max(0, 1 - rc.beatPhase / params.decay);
    if (env < 0.01) return;
    if (typeof OffscreenCanvas === 'undefined') return;

    const { sx, sy, sw, sh } = containRect(rc);
    const ox = rc.width * params.offset * env;

    // Lazy-init / resize the two channel offscreens.
    let pair = rgbOffByClip.get(rc.clipId);
    if (!pair || pair.w !== rc.width || pair.h !== rc.height) {
      pair = {
        r: new OffscreenCanvas(rc.width, rc.height),
        b: new OffscreenCanvas(rc.width, rc.height),
        w: rc.width,
        h: rc.height
      };
      rgbOffByClip.set(rc.clipId, pair);
    }

    // Main canvas: draw original first so the channel layers screen-add
    // brightness onto the existing image (image was already painted by
    // the main renderer pass, but ZoomPulse-style re-draw guarantees
    // aspect-fit consistency and a clean base for compositing).
    rc.ctx.drawImage(rc.imageBitmap, sx, sy, sw, sh);

    // Red channel: bitmap shifted +ox, multiply by rgba(255,0,0).
    const rCtx = pair.r.getContext('2d');
    if (rCtx) {
      rCtx.clearRect(0, 0, rc.width, rc.height);
      rCtx.drawImage(rc.imageBitmap, sx + ox, sy, sw, sh);
      rCtx.globalCompositeOperation = 'multiply';
      rCtx.fillStyle = 'rgba(255,0,0,1)';
      rCtx.fillRect(0, 0, rc.width, rc.height);
      rCtx.globalCompositeOperation = 'source-over';
    }

    // Blue channel: bitmap shifted -ox, multiply by rgba(0,0,255).
    const bCtx = pair.b.getContext('2d');
    if (bCtx) {
      bCtx.clearRect(0, 0, rc.width, rc.height);
      bCtx.drawImage(rc.imageBitmap, sx - ox, sy, sw, sh);
      bCtx.globalCompositeOperation = 'multiply';
      bCtx.fillStyle = 'rgba(0,0,255,1)';
      bCtx.fillRect(0, 0, rc.width, rc.height);
      bCtx.globalCompositeOperation = 'source-over';
    }

    // Composite both channels onto the main canvas with `screen` so the
    // red and blue offsets brighten the original.
    rc.ctx.save();
    rc.ctx.globalCompositeOperation = 'screen';
    rc.ctx.globalAlpha *= params.intensity * env;
    rc.ctx.drawImage(pair.r, 0, 0);
    rc.ctx.drawImage(pair.b, 0, 0);
    rc.ctx.restore();
  },
  dispose() {
    rgbOffByClip.clear();
  }
};

/** Test-only — inspect the per-clip offscreen cache. */
export const _testOnly_rgbOffByClip = rgbOffByClip;
