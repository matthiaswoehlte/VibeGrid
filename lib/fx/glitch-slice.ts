import type { FxPlugin, RenderContext } from '@/lib/renderer/types';
import { containRect } from '@/lib/renderer/loop';
import { mulberry32 } from '@/lib/utils/prng';

interface GlitchSliceParams {
  sliceCount: number;
  maxOffset: number;
  decay: number;
  seed: number;
  axis: string;
}

/**
 * Plan 8e — datamosh-style slice shift on every beat. The bitmap is
 * first painted onto a per-clip offscreen at canvas-aligned coords
 * (via `containRect`), then sliced into `sliceCount` horizontal or
 * vertical strips, each pseudo-randomly displaced along the
 * perpendicular axis. The PRNG is reseeded each beat to
 * `seed + beatIndex` — same seed in the same project produces the
 * same slice pattern on every viewer; different beats produce
 * different patterns.
 *
 * Why the offscreen pre-render: slicing directly from `rc.imageBitmap`
 * mixes bitmap-intrinsic coords (e.g. 4000×3000) with canvas coords
 * (1920×1080) in `drawImage`'s source rect, which produces incorrect
 * slice geometry. The offscreen normalises everything to canvas-space.
 *
 * Category A (image-modifying). Per-clip offscreens cached, cleared on
 * dispose. Same KNOWN_LIMITATIONS clip-remove caveat as FilmGrain.
 */
const glitchOffByClip = new Map<string, OffscreenCanvas>();

export const glitchSlicePlugin: FxPlugin<GlitchSliceParams> = {
  id: 'glitch-slice',
  name: 'Glitch Slice',
  kind: 'GlitchSlice',
  defaultTrigger: 'beat',
  preloadState: 'ready',
  paramSchema: {
    sliceCount: {
      kind: 'slider',
      label: 'Slices',
      min: 2,
      max: 8,
      step: 1,
      default: 4
    },
    maxOffset: {
      kind: 'slider',
      label: 'Offset',
      min: 0,
      max: 0.05,
      step: 0.001,
      default: 0.01
    },
    decay: {
      kind: 'slider',
      label: 'Decay',
      min: 0.01,
      max: 0.3,
      step: 0.01,
      default: 0.08,
      unit: 'beats'
    },
    seed: {
      kind: 'slider',
      label: 'Seed',
      min: 0,
      max: 999,
      step: 1,
      default: 42
    },
    axis: {
      kind: 'select',
      label: 'Axis',
      options: [
        { value: 'h', label: 'Horizontal' },
        { value: 'v', label: 'Vertical' }
      ],
      default: 'h'
    }
  },
  getDefaultParams: (): GlitchSliceParams => ({
    sliceCount: 4,
    maxOffset: 0.01,
    decay: 0.08,
    seed: 42,
    axis: 'h'
  }),
  async preload() {},
  render(rc: RenderContext, params: GlitchSliceParams) {
    if (!rc.imageBitmap) return;
    if (rc.flowMode) return;
    const env = Math.max(0, 1 - rc.beatPhase / params.decay);
    if (env < 0.01) return;
    if (typeof OffscreenCanvas === 'undefined') return;

    // Pre-render bitmap with contain-math onto a canvas-sized offscreen so
    // subsequent slicing works in pure canvas coordinates.
    let off = glitchOffByClip.get(rc.clipId);
    if (!off || off.width !== rc.width || off.height !== rc.height) {
      off = new OffscreenCanvas(rc.width, rc.height);
      glitchOffByClip.set(rc.clipId, off);
    }
    const oCtx = off.getContext('2d');
    if (!oCtx) return;
    oCtx.clearRect(0, 0, rc.width, rc.height);
    const { sx, sy, sw, sh } = containRect(rc);
    oCtx.drawImage(rc.imageBitmap, sx, sy, sw, sh);

    const rand = mulberry32(params.seed + rc.beatIndex);
    const { width: w, height: h } = rc;
    const isH = params.axis === 'h';
    const sliceCount = Math.max(1, Math.round(params.sliceCount));
    const sliceSize = (isH ? h : w) / sliceCount;
    const maxPx = w * params.maxOffset * env;

    for (let i = 0; i < sliceCount; i++) {
      const offsetPx = (rand() - 0.5) * 2 * maxPx;
      if (isH) {
        const y0 = i * sliceSize;
        rc.ctx.drawImage(off, 0, y0, w, sliceSize, offsetPx, y0, w, sliceSize);
      } else {
        const x0 = i * sliceSize;
        rc.ctx.drawImage(off, x0, 0, sliceSize, h, x0, offsetPx, sliceSize, h);
      }
    }
  },
  dispose() {
    glitchOffByClip.clear();
  }
};

/** Test-only — inspect the per-clip offscreen cache. */
export const _testOnly_glitchOffByClip = glitchOffByClip;
