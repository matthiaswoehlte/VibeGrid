import type { FxPlugin, RenderContext } from '@/lib/renderer/types';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';
import {
  RGB_SPLIT_FRAG_SRC,
  RGB_SPLIT_UNIFORM_NAMES
} from '@/lib/renderer/webgl/programs/rgb-split';

interface RGBSplitParams {
  offset: number;
  decay: number;
  intensity: number;
  beatSync: number;
}

/**
 * Plan 11a — RGBSplit als WebGL2-Fragment-Shader.
 *
 * Migriert von der Canvas-2D-Implementierung (Plan 8e) auf
 * `renderGlFx` (Plan 8f.1+). Der Shader macht channel-replace
 * per Fragment statt zwei tinted Offscreens mit screen-Composite —
 * sauberer, deterministischer Look, kein per-Clip State.
 *
 * **Behavior-Drift** (siehe KNOWN_LIMITATIONS.md): die alte Canvas-2D-
 * Variante war additiv-aufhellend, `u_intensity` ist jetzt ein linearer
 * Mix zwischen Original und Aberration. Param-Range identisch (0..1),
 * Pixel-Werte aber nicht bit-equivalent.
 *
 * `source: 'bitmap'` (Default in `renderGlFx`) — sampelt das Original-
 * Bitmap, nicht den bereits composed Canvas. Damit chaint RGBSplit
 * NICHT auf vorige FX (gemeinsam mit CGS / VHS / Contour GL ist es
 * last-writer-wins, siehe KNOWN_LIMITATIONS-Eintrag).
 *
 * Plan 8g beatSync-Toggle: `beatSync >= 0.5` → Beat-Decay-Envelope,
 * `beatSync < 0.5` → konstant `env = 1.0`. Verhalten bleibt identisch
 * zum Canvas-2D-Vorgänger; nur der Renderer wechselt.
 *
 * Category A (image-modifying) — guarded auf `rc.imageBitmap`.
 */
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
    },
    beatSync: {
      kind: 'slider',
      label: 'Beat Sync',
      min: 0,
      max: 1,
      step: 1,
      default: 1
    }
  },
  getDefaultParams: (): RGBSplitParams => ({
    offset: 0.004,
    decay: 0.15,
    intensity: 0.6,
    beatSync: 1
  }),
  async preload() {},
  render(rc: RenderContext, params: RGBSplitParams) {
    if (!rc.imageBitmap) return;
    if (rc.flowMode) return;

    // Plan 8g beatSync — Verhalten 1:1 erhalten gegenüber Canvas-2D-Vorgänger.
    const synced = params.beatSync >= 0.5;
    const env = synced
      ? Math.max(0, 1 - rc.beatPhase / params.decay)
      : 1.0;
    if (env < 0.01) return;

    // params.offset ist bereits eine fraction-of-width (Schema 0..0.05),
    // also eine UV-Differenz. Keine Pixel→UV-Konvertierung nötig; der
    // Shader multipliziert intern mit u_env.
    renderGlFx({
      rc,
      fragSrc: RGB_SPLIT_FRAG_SRC,
      uniforms: {
        u_shift: params.offset,
        u_env: env,
        u_intensity: params.intensity
      },
      uniformNames: RGB_SPLIT_UNIFORM_NAMES
      // source default = 'bitmap' — RGBSplit sampelt rc.imageBitmap.
    });
  }
  // Kein dispose() — kein per-clip State mehr nach der Migration.
};
