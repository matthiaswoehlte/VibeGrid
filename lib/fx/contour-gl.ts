import type { FxPlugin } from '@/lib/renderer/types';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';
import { CONTOUR_GL_FRAG_SRC } from '@/lib/renderer/webgl/programs/contour-gl';
import { _hexToRgba01 } from './edge-glow';

type SweepDirection =
  | 'all'
  | 'lr'
  | 'rl'
  | 'tb'
  | 'bt'
  | 'bl-tr'
  | 'tl-br'
  | 'tr-bl'
  | 'br-tl';

interface ContourGlParams {
  color: string;
  threshold: number;
  lineWidth: number;
  stippleSize: number;
  sweepDirection: SweepDirection;
  sweepSpeed: number;
  intensity: number;
  decay: number;
  beatSync: number;
}

/** Direction → float code for u_sweep_dir. 0 means "no sweep gating". */
const DIR_CODE: Record<SweepDirection, number> = {
  all: 0,
  lr: 1,
  rl: 2,
  tb: 3,
  bt: 4,
  'bl-tr': 5,
  'tl-br': 6,
  'tr-bl': 7,
  'br-tl': 8
};

/** Same constants as the Canvas2D Contour plugin, for behavioural parity. */
const BEATS_PER_BAR = 4;
const REVEAL_TRAIL = 0.2;

/**
 * lineWidth (0.5 .. 4.0) → dilatePx (0 .. 2). Linear map. The shader
 * skips the 4-sample dilate branch when `u_dilate_px <= 0.001`, so
 * lineWidth=0.5 costs only one Sobel evaluation.
 */
function lineWidthToDilatePx(lw: number): number {
  return Math.max(0, (lw - 0.5) * (2 / 3.5));
}

/**
 * Plan 8f.4 — Contour GL.
 *
 * GPU-Port der Canvas2D `contour` FX. Same renderGlFx({source:'canvas'})
 * Pattern wie Edge Glow (Plan 8f.3): sampled den bereits composed Frame,
 * läuft als single-pass Fragment-Shader, chained korrekt auf CGS/VHS/
 * Edge Glow.
 *
 * Unterschiede zur Canvas2D Contour:
 * - **lineWidth** wird über einen Dilate-Pass (5-Sample Max) realisiert
 *   statt über `ctx.lineWidth`. Visuell vergleichbares Widening.
 * - **dashLength** ersetzt durch `stippleSize` (Stipple-Hash): cell-
 *   basierter Hash gated 50/50 der edge pixels. Anderer Look als
 *   parametric dashes, dafür GPU-nativ.
 * - **Performance**: keine CPU-Sobel/Flood-Fill mehr, kein cache-miss-
 *   Spike, kein 500-ms-bucket-transition-spike auf Video. Per-Frame-Cost
 *   ist konstant.
 *
 * Flow Mode / Beat Sync: identisch zu Edge Glow (Plan 8g Template B).
 * Output ist pre-multiplied alpha, drawn back via source-over → BG
 * bleibt sichtbar (keine `bgOpacity` wie bei Edge Glow).
 */
export const contourGlPlugin: FxPlugin<ContourGlParams> = {
  id: 'contour-gl',
  name: 'Contour GL',
  kind: 'ContourGL',
  defaultTrigger: 'beat',
  preloadState: 'loading',
  paramSchema: {
    color: {
      kind: 'color',
      label: 'Stroke color',
      default: '#a86bff'
    },
    threshold: {
      kind: 'slider',
      label: 'Threshold',
      min: 0.05,
      max: 0.40,
      step: 0.01,
      default: 0.15
    },
    lineWidth: {
      kind: 'slider',
      label: 'Line width',
      min: 0.5,
      max: 4,
      step: 0.1,
      default: 1.0,
      unit: 'px'
    },
    stippleSize: {
      kind: 'slider',
      label: 'Stipple size',
      min: 0,
      max: 20,
      step: 1,
      default: 0,
      unit: 'px'
    },
    sweepDirection: {
      kind: 'select',
      label: 'Sweep direction',
      options: [
        { value: 'all', label: 'All (no sweep)' },
        { value: 'bl-tr', label: '↗ Bottom-left → top-right' },
        { value: 'tl-br', label: '↘ Top-left → bottom-right' },
        { value: 'tr-bl', label: '↙ Top-right → bottom-left' },
        { value: 'br-tl', label: '↖ Bottom-right → top-left' },
        { value: 'lr', label: '→ Left → right' },
        { value: 'rl', label: '← Right → left' },
        { value: 'tb', label: '↓ Top → bottom' },
        { value: 'bt', label: '↑ Bottom → top' }
      ],
      default: 'all'
    },
    sweepSpeed: {
      kind: 'slider',
      label: 'Sweep speed',
      min: 0.25,
      max: 4,
      step: 0.25,
      default: 1,
      unit: 'cyc/bar',
      visibleWhen: (p) =>
        (p as { sweepDirection: string }).sweepDirection !== 'all'
    },
    intensity: {
      kind: 'slider',
      label: 'Intensity',
      min: 0,
      max: 1,
      step: 0.05,
      default: 1.0
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
    beatSync: {
      kind: 'slider',
      label: 'Beat Sync',
      min: 0,
      max: 1,
      step: 1,
      default: 1
    }
  },
  getDefaultParams: () => ({
    color: '#a86bff',
    threshold: 0.15,
    lineWidth: 1.0,
    stippleSize: 0,
    sweepDirection: 'all',
    sweepSpeed: 1,
    intensity: 1.0,
    decay: 0.25,
    beatSync: 1
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
    // source='canvas' samples rc.ctx.canvas; guard on the canvas reference
    // (not on imageBitmap, which is irrelevant for canvas-mode shaders).
    if (!rc.ctx?.canvas) return;

    const synced = params.beatSync >= 0.5;
    const isConstant = rc.flowMode || !synced;
    const env = isConstant
      ? 1.0
      : Math.max(0, 1 - rc.beatPhase / params.decay);
    if (!isConstant && env < 0.01) return;

    // Sweep phase — identical math to lib/fx/contour/index.ts so that
    // the GL variant feels indistinguishable from the Canvas2D one when
    // params are equal.
    const cycleBeats = BEATS_PER_BAR / Math.max(0.01, params.sweepSpeed);
    const cyclePos =
      (((rc.beatIndex + rc.beatPhase) % cycleBeats) + cycleBeats) %
      cycleBeats;
    const sweepPhase = cyclePos / cycleBeats;

    const dilatePx = lineWidthToDilatePx(params.lineWidth);
    const color = _hexToRgba01(params.color);
    const canvas = rc.ctx.canvas;

    renderGlFx({
      rc,
      fragSrc: CONTOUR_GL_FRAG_SRC,
      source: 'canvas',
      uniformNames: [
        'u_resolution',
        'u_threshold',
        'u_color',
        'u_dilate_px',
        'u_stipple_size',
        'u_sweep_dir',
        'u_sweep_phase',
        'u_reveal_trail',
        'u_intensity'
      ],
      uniforms: {
        // u_resolution shadows the pipeline default (GL canvas dims) on
        // purpose: source='canvas' uploads rc.ctx.canvas, so the Sobel
        // texel offsets and stipple-cell px must be in main-canvas pixel
        // space. Same discipline as Edge Glow.
        u_resolution: [canvas.width, canvas.height] as const,
        u_threshold: params.threshold,
        u_color: color,
        u_dilate_px: dilatePx,
        u_stipple_size: params.stippleSize,
        u_sweep_dir: DIR_CODE[params.sweepDirection],
        u_sweep_phase: sweepPhase,
        u_reveal_trail: REVEAL_TRAIL,
        u_intensity: params.intensity * env
      }
    });
  },

  dispose() {}
};
