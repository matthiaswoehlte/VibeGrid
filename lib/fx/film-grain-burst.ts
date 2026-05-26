import type { FxPlugin, RenderContext } from '@/lib/renderer/types';

interface FilmGrainBurstParams {
  intensity: number;
  decay: number;
  grainSize: number;
  colorMode: string;
}

/**
 * Plan 8e — analog film-grain noise burst on every beat. Generates a
 * fresh noise ImageData per frame within the decay window and overlays
 * it onto the main canvas with `overlay` composite. With `grainSize>1`
 * the offscreen is allocated at `(canvas / grainSize)` and stretched
 * back to full size — quartic perf win at grainSize=2 (4× fewer noise
 * iterations), and the visible result looks more like classic 35mm
 * grain (chunky) rather than digital sensor noise (single-pixel).
 *
 * `colorMode`: 'white' = bright grain (R=G=B same noise), 'colored' =
 * RGB-decorrelated (each channel independent noise), 'black' = dark
 * grain (R=G=B=0, alpha-modulated).
 *
 * Category B (overlay). Per-clip offscreens cached, cleared on dispose.
 * KNOWN_LIMITATIONS: cache survives clip-remove until HMR/page reload.
 */
const grainOffByClip = new Map<string, OffscreenCanvas>();

export const filmGrainBurstPlugin: FxPlugin<FilmGrainBurstParams> = {
  id: 'film-grain-burst',
  name: 'Film Grain',
  kind: 'FilmGrainBurst',
  defaultTrigger: 'beat',
  preloadState: 'ready',
  paramSchema: {
    intensity: {
      kind: 'slider',
      label: 'Intensity',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.4
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
    grainSize: {
      kind: 'slider',
      label: 'Grain Size',
      min: 1,
      max: 4,
      step: 1,
      default: 1,
      unit: 'px'
    },
    colorMode: {
      kind: 'select',
      label: 'Color',
      options: [
        { value: 'white', label: 'White' },
        { value: 'colored', label: 'Colored' },
        { value: 'black', label: 'Black' }
      ],
      default: 'white'
    }
  },
  getDefaultParams: (): FilmGrainBurstParams => ({
    intensity: 0.4,
    decay: 0.15,
    grainSize: 1,
    colorMode: 'white'
  }),
  async preload() {},
  render(rc: RenderContext, params: FilmGrainBurstParams) {
    if (rc.flowMode) return;
    const env = Math.max(0, 1 - rc.beatPhase / params.decay);
    if (env < 0.02) return;
    if (typeof OffscreenCanvas === 'undefined') return;

    const scale = Math.max(1, Math.round(params.grainSize));
    const gw = Math.ceil(rc.width / scale);
    const gh = Math.ceil(rc.height / scale);

    let off = grainOffByClip.get(rc.clipId);
    if (!off || off.width !== gw || off.height !== gh) {
      off = new OffscreenCanvas(gw, gh);
      grainOffByClip.set(rc.clipId, off);
    }
    const gCtx = off.getContext('2d');
    if (!gCtx) return;

    const imgData = gCtx.createImageData(gw, gh);
    const d = imgData.data;
    const eff = params.intensity * env;
    const isColored = params.colorMode === 'colored';
    const isBlack = params.colorMode === 'black';

    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() - 0.5) * 255 * eff;
      if (isBlack) {
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
      } else if (isColored) {
        d[i] = 128 + v;
        d[i + 1] = 128 + (Math.random() - 0.5) * 255 * eff;
        d[i + 2] = 128 + (Math.random() - 0.5) * 255 * eff;
      } else {
        d[i] = 128 + v;
        d[i + 1] = 128 + v;
        d[i + 2] = 128 + v;
      }
      d[i + 3] = Math.abs(v);
    }
    gCtx.putImageData(imgData, 0, 0);

    rc.ctx.save();
    rc.ctx.globalCompositeOperation = 'overlay';
    rc.ctx.drawImage(off, 0, 0, rc.width, rc.height);
    rc.ctx.restore();
  },
  dispose() {
    grainOffByClip.clear();
  }
};

/** Test-only — inspect the per-clip offscreen cache. */
export const _testOnly_grainOffByClip = grainOffByClip;
