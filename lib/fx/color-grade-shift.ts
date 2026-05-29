import type { FxPlugin } from '@/lib/renderer/types';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';
import { COLOR_GRADE_FRAG_SRC } from '@/lib/renderer/webgl/programs/color-grade';

interface ColorGradeShiftParams {
  saturation: number;
  contrast: number;
  brightness: number;
  hueShift: number;
  decay: number;
  beatSync: boolean;
}

/**
 * Plan 8f.1 — ColorGradeShift FX (first WebGL2 plugin).
 *
 * Re-color das Bild auf jeden Beat: Saturation / Contrast / Brightness /
 * Hue-Shift, moduliert über `env = 1 - beatPhase / decay`. Auf
 * `env < 0.01` skipped der Plugin den WebGL-Call komplett (saves
 * texSubImage2D + drawArrays + drawImage-composite).
 *
 * `preloadState` startet auf `'loading'` und wird in `preload()` zu
 * `'ready'` (WebGL2 vorhanden) oder `'error'` (Browser ohne WebGL2).
 * Erste Plugin-Klasse, die diese Mutation nutzt — siehe FxPlugin-Interface,
 * Feld ist nicht `readonly`. Inspector zeigt einen Warn-Banner bei `'error'`.
 *
 * `flowMode` skipped die WebGL-Pass ebenfalls — ColorGradeShift ist
 * bewusst kein Dauerlook, sondern ein Beat-Pulse.
 *
 * Kategorie-A (image-modifying): re-zeichnet `rc.imageBitmap`, daher
 * vom Renderer-Loop nur invoked wenn `rc.imageBitmap` vorhanden ist.
 */
export const colorGradeShiftPlugin: FxPlugin<ColorGradeShiftParams> = {
  id: 'color-grade-shift',
  name: 'Color Grade',
  kind: 'ColorGradeShift',
  defaultTrigger: 'beat',
  supportsSubdivision: true,
  preloadState: 'loading',
  paramSchema: {
    saturation: {
      kind: 'slider',
      label: 'Saturation',
      min: 1.0,
      max: 4.0,
      step: 0.1,
      default: 2.0
    },
    contrast: {
      kind: 'slider',
      label: 'Contrast',
      min: 1.0,
      max: 2.0,
      step: 0.05,
      default: 1.3
    },
    brightness: {
      kind: 'slider',
      label: 'Brightness',
      min: 0.7,
      max: 1.5,
      step: 0.05,
      default: 1.1
    },
    hueShift: {
      kind: 'slider',
      label: 'Hue Shift',
      min: -180,
      max: 180,
      step: 1,
      default: 0,
      unit: '°'
    },
    decay: {
      kind: 'slider',
      label: 'Decay',
      min: 0.01,
      max: 0.5,
      step: 0.01,
      default: 0.25,
      unit: 'beats'
    },
    beatSync: { kind: 'toggle', label: 'Beat Sync', default: true }
  },
  getDefaultParams: () => ({
    saturation: 2.0,
    contrast: 1.3,
    brightness: 1.1,
    hueShift: 0,
    decay: 0.25,
    beatSync: true,
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
    if (rc.flowMode) return;
    const synced = params.beatSync;
    const env = synced
      ? Math.max(0, 1 - rc.subdividedBeatPhase / params.decay)
      : 1.0;
    if (env < 0.01) return;

    renderGlFx({
      rc,
      fragSrc: COLOR_GRADE_FRAG_SRC,
      uniformNames: [
        'u_saturation',
        'u_contrast',
        'u_brightness',
        'u_hue_shift',
        'u_env'
      ],
      uniforms: {
        u_saturation: params.saturation,
        u_contrast: params.contrast,
        u_brightness: params.brightness,
        u_hue_shift: params.hueShift,
        u_env: env
      }
    });
  },

  // Per-Clip Cleanup läuft über `useWebGLClipCleanup`-Hook (siehe
  // lib/hooks/useWebGLClipCleanup.ts). Plugin-dispose() ist no-op.
  dispose() {}
};
