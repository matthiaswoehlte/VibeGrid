import type { FxPlugin } from '@/lib/renderer/types';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';
import { RETRO_VHS_FRAG_SRC } from '@/lib/renderer/webgl/programs/retro-vhs';

interface RetroVhsParams {
  scanlineOpacity: number;
  scanlineSpacing: number;
  colorFringe: number;
  dropoutIntensity: number;
  dropoutCount: number;
  warpIntensity: number;
  decay: number;
  seed: number;
}

/**
 * Plan 8f.2 — RetroVHS FX (second WebGL2 plugin, builds on 8f.1 infra).
 *
 * Mischung aus persistenten und beat-synchronen VHS-Artefakten:
 *   - **Persistent** (immer aktiv, auch ohne Beat): Scanlines, Color
 *     Fringe, Tape Warp (subtil ohne env-Modulation).
 *   - **Beat-synchron** (decay-Envelope `env = 1 - beatPhase / decay`):
 *     Dropout-Streifen, Warp-Amplitude.
 *
 * **Flow Mode**: Persistente Layer bleiben aktiv (`env = 1.0`,
 * Scanlines + Fringe sichtbar). Dropout + Warp werden auf 0 gesetzt,
 * sodass der kontinuierliche Look ohne Beat-Pulse rendert.
 *
 * `seed` ist als Slider exponiert — User können verschiedene
 * Dropout-Patterns ausprobieren ohne Code-Änderung. Im Shader gemixt
 * mit `u_beat_index` für pro-Beat-Variation.
 *
 * Kategorie-A (image-modifying): re-zeichnet `rc.imageBitmap` via
 * GLSL, daher vom Renderer-Loop nur invoked wenn `rc.imageBitmap`
 * vorhanden ist (IMAGE_MODIFYING_KINDS in `loop.ts`).
 */
export const retroVhsPlugin: FxPlugin<RetroVhsParams> = {
  id: 'retro-vhs',
  name: 'Retro VHS',
  kind: 'RetroVHS',
  defaultTrigger: 'beat',
  preloadState: 'loading',
  paramSchema: {
    scanlineOpacity: {
      kind: 'slider',
      label: 'Scanlines',
      min: 0,
      max: 0.6,
      step: 0.01,
      default: 0.25
    },
    scanlineSpacing: {
      kind: 'slider',
      label: 'Line Spacing',
      min: 2,
      max: 4,
      step: 1,
      default: 2
    },
    colorFringe: {
      kind: 'slider',
      label: 'Color Fringe',
      min: 0,
      max: 0.02,
      step: 0.001,
      default: 0.003
    },
    dropoutIntensity: {
      kind: 'slider',
      label: 'Dropout',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.4
    },
    dropoutCount: {
      kind: 'slider',
      label: 'Dropout Lines',
      min: 0,
      max: 8,
      step: 1,
      default: 3
    },
    warpIntensity: {
      kind: 'slider',
      label: 'Tape Warp',
      min: 0,
      max: 0.015,
      step: 0.001,
      default: 0.004
    },
    decay: {
      kind: 'slider',
      label: 'Decay',
      min: 0.01,
      max: 0.5,
      step: 0.01,
      default: 0.3,
      unit: 'beats'
    },
    seed: {
      kind: 'slider',
      label: 'Seed',
      min: 0,
      max: 999,
      step: 1,
      default: 7
    }
  },
  getDefaultParams: () => ({
    scanlineOpacity: 0.25,
    scanlineSpacing: 2,
    colorFringe: 0.003,
    dropoutIntensity: 0.4,
    dropoutCount: 3,
    warpIntensity: 0.004,
    decay: 0.3,
    seed: 7
  }),

  async preload() {
    if (typeof OffscreenCanvas === 'undefined') {
      this.preloadState = 'error';
      return;
    }
    const test = new OffscreenCanvas(1, 1);
    const gl = test.getContext('webgl2');
    this.preloadState = gl ? 'ready' : 'error';
  },

  render(rc, params) {
    if (!rc.imageBitmap) return;

    // Flow Mode: persistente Layer bleiben aktiv, dropout/warp aus.
    const isFlow = rc.flowMode;
    const env = isFlow
      ? 1.0
      : Math.max(0, 1 - rc.beatPhase / params.decay);
    // Beat Mode: skip the WebGL call when the envelope has fully
    // decayed (saves a per-frame texSubImage2D + drawArrays). In Flow
    // Mode env is pinned at 1.0, so the check is bypassed implicitly.
    if (!isFlow && env < 0.01) return;

    renderGlFx({
      rc,
      fragSrc: RETRO_VHS_FRAG_SRC,
      uniformNames: [
        'u_env',
        'u_beat_phase',
        'u_beat_index',
        'u_scanline_opacity',
        'u_scanline_spacing',
        'u_color_fringe',
        'u_dropout_intensity',
        'u_dropout_count',
        'u_warp_intensity',
        'u_seed'
      ],
      uniforms: {
        u_env: env,
        u_beat_phase: rc.beatPhase,
        u_beat_index: rc.beatIndex,
        u_scanline_opacity: params.scanlineOpacity,
        u_scanline_spacing: params.scanlineSpacing,
        u_color_fringe: params.colorFringe,
        u_dropout_intensity: isFlow ? 0 : params.dropoutIntensity,
        u_dropout_count: params.dropoutCount,
        u_warp_intensity: isFlow ? 0 : params.warpIntensity,
        u_seed: params.seed
      }
    });
  },

  // Per-Clip Cleanup läuft über `useWebGLClipCleanup`-Hook (Plan 8f.1).
  dispose() {}
};
