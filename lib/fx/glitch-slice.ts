import type { FxPlugin, RenderContext } from '@/lib/renderer/types';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';
import {
  GLITCH_SLICE_FRAG_SRC,
  GLITCH_SLICE_UNIFORM_NAMES
} from '@/lib/renderer/webgl/programs/glitch-slice';

interface GlitchSliceParams {
  sliceCount: number;
  maxOffset: number;
  decay: number;
  seed: number;
  axis: string;
  beatSync: boolean;
}

/**
 * Plan 11b — GlitchSlice als WebGL2-Fragment-Shader.
 *
 * Migriert von der Canvas-2D-Implementierung (Plan 8e) auf
 * `renderGlFx` (Plan 8f.1+). Der Shader macht slice-shift per Fragment
 * statt eines Pre-Render-Offscreens mit einer Schleife von `drawImage`-
 * Aufrufen — kein per-Clip State, kein OffscreenCanvas-Cache, keine
 * `mulberry32`-CPU-PRNG.
 *
 * **Behavior-Drift** (siehe KNOWN_LIMITATIONS.md, Architekt-A Variante b):
 * 1. GLSL `fract(sin)`-Hash statt `mulberry32` — andere Slice-Versatz-
 *    Verteilung bei gleichem `seed`-Param.
 * 2. `fract()`-UV-Wrap statt Pixel-Clipping — Wrap-Around-Glitch statt
 *    Black-Band-Glitch. Texture ist bitmap-sized (kein Letterbox-Bereich
 *    in der Texture), Wrap sampelt immer echtes Bitmap-Content.
 * 3. Cosmetic: `sin()` verliert bei sehr großem `u_seed` (>10k) Entropie.
 *
 * `source: 'bitmap'` (Default in `renderGlFx`) — sampelt das Original-
 * Bitmap, nicht den bereits composed Canvas. Damit ist GlitchSlice
 * gemeinsam mit RGBSplit (Plan 11a), ColorGradeShift, RetroVHS und
 * ContourGL last-writer-wins beim Stacking auf demselben Clip
 * (KNOWN_LIMITATIONS-Eintrag).
 *
 * Plan 9c-Erbe bleibt erhalten:
 *  - `supportsSubdivision: true`
 *  - `params.beatSync: boolean` (kind:'toggle')
 *  - env basiert auf `rc.subdividedBeatPhase`
 *
 * Category A (image-modifying) — guarded auf `rc.imageBitmap`.
 */
export const glitchSlicePlugin: FxPlugin<GlitchSliceParams> = {
  id: 'glitch-slice',
  name: 'Glitch Slice',
  kind: 'GlitchSlice',
  defaultTrigger: 'beat',
  supportsSubdivision: true,
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
    },
    beatSync: { kind: 'toggle', label: 'Beat Sync', default: true }
  },
  getDefaultParams: (): GlitchSliceParams => ({
    sliceCount: 4,
    maxOffset: 0.01,
    decay: 0.08,
    seed: 42,
    axis: 'h',
    beatSync: true
  }),
  async preload() {},
  render(rc: RenderContext, params: GlitchSliceParams) {
    if (!rc.imageBitmap) return;
    if (rc.flowMode) return;

    // Plan 9c — beatSync truthy + env auf subdividedBeatPhase.
    const env = params.beatSync
      ? Math.max(0, 1 - rc.subdividedBeatPhase / params.decay)
      : 1.0;
    if (env < 0.01) return;

    renderGlFx({
      rc,
      fragSrc: GLITCH_SLICE_FRAG_SRC,
      uniforms: {
        u_sliceCount: Math.round(params.sliceCount),
        u_maxOffset: params.maxOffset,
        u_env: env,
        // Plan 9c.1 — seed advances per SUBDIVISION, not per beat. Bei
        // sub=1× ist `subdivisionIndex === beatIndex`, also Verhalten
        // identisch zum pre-9c.1 Canvas-2D-Vorgänger (mulberry32-
        // determinism preserved). Bei sub=N× bekommt jede Subdivision
        // ein neues Slice-Pattern statt das Beat-Pattern N× zu
        // wiederholen — sonst würde der User „1 Glitch flackert" sehen
        // statt „N verschiedene Glitches pro Beat".
        u_seed: params.seed + rc.subdivisionIndex,
        // Architekt-B: float-Uniform statt Doppel-Shader.
        u_axis: params.axis === 'v' ? 1.0 : 0.0
      },
      uniformNames: GLITCH_SLICE_UNIFORM_NAMES
      // source default = 'bitmap' — GlitchSlice sampelt rc.imageBitmap.
    });
  }
  // Kein dispose() — kein per-clip State mehr nach der Migration.
};
