import type { FxPlugin } from '@/lib/renderer/types';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';
import { EDGE_GLOW_FRAG_SRC } from '@/lib/renderer/webgl/programs/edge-glow';

interface EdgeGlowParams {
  threshold: number;
  color: string;
  colorEnd: string;
  glowAmount: number;
  bgOpacity: number;
  intensity: number;
  decay: number;
  beatSync: boolean;
}

/**
 * Parse `#rrggbb` (or `rrggbb`) to a normalized RGBA tuple. Falls back
 * to white on any malformed input — picks correctness over throwing,
 * because the user-facing color-picker is the only producer and there's
 * no safe failure mode mid-render. Exported as `_hexToRgba01` for tests.
 */
export function _hexToRgba01(
  hex: string,
  a = 1
): readonly [number, number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return [1, 1, 1, a] as const;
  const n = parseInt(m[1], 16);
  return [
    ((n >> 16) & 0xff) / 255,
    ((n >> 8) & 0xff) / 255,
    (n & 0xff) / 255,
    a
  ] as const;
}

/**
 * Plan 8f.3 — Edge Glow FX (third WebGL2 plugin).
 *
 * CapCut/Canva-style edge outline with optional glow band. Sobel auf
 * Luma im Fragment-Shader, single-pass, mit smoothstep-Band als
 * Pseudo-Glow (echtes Gaussian wäre 2-Pass mit FBO, kommt ggf. in
 * Plan 8f.4).
 *
 * **Variante B — source='canvas'**: Edge Glow sampelt den **bereits
 * composed Frame** (post-CGS / post-VHS / post-jeder-Image-Modifying-
 * FX), nicht das Original-Bitmap. Damit chained Edge Glow korrekt auf
 * vorherige FX. Bedingt die Render-Order-Position am Ende der
 * image-modifying group in `plugin-mapping.ts`.
 *
 * **Flow Mode**: env pinned auf 1.0 — Edge Glow ist ein persistenter
 * Look (Outline + Glow), kein reiner Beat-Pulse. In Beat Mode dämpft
 * `env = 1 - beatPhase / decay` die intensity nach jedem Beat ab.
 *
 * **Bekannte Limitation**: ColorGradeShift + RetroVHS auf demselben
 * Clip composen noch nicht miteinander (beide nutzen source='bitmap',
 * last writer wins). Edge Glow sieht nur den letzten der beiden im
 * gestackten Fall. Folge-Plan 8f.4 kann CGS/VHS auf 'canvas' opten.
 */
export const edgeGlowPlugin: FxPlugin<EdgeGlowParams> = {
  id: 'edge-glow',
  name: 'Edge Glow',
  kind: 'EdgeGlow',
  defaultTrigger: 'beat',
  supportsSubdivision: true,
  preloadState: 'loading',
  paramSchema: {
    threshold: {
      kind: 'slider',
      label: 'Threshold',
      min: 0.02,
      max: 0.40,
      step: 0.01,
      default: 0.10
    },
    color: {
      kind: 'color',
      label: 'Edge color',
      default: '#00e5ff'
    },
    colorEnd: {
      kind: 'color',
      label: 'Edge color (end)',
      default: '#00e5ff'
    },
    glowAmount: {
      kind: 'slider',
      label: 'Glow',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5
    },
    bgOpacity: {
      kind: 'slider',
      label: 'Background',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.3
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
    beatSync: { kind: 'toggle', label: 'Beat Sync', default: true }
  },
  getDefaultParams: () => ({
    threshold: 0.10,
    color: '#00e5ff',
    colorEnd: '#00e5ff',
    glowAmount: 0.5,
    bgOpacity: 0.3,
    intensity: 1.0,
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
    // Edge Glow sampelt rc.ctx.canvas (source='canvas'), nicht
    // rc.imageBitmap. Auf den Canvas guarden — wenn künftig overlay-
    // only FX-Clips ohne Bitmap composen, würde ein Bitmap-Guard
    // fälschlicherweise skippen.
    if (!rc.ctx?.canvas) return;

    const synced = params.beatSync;
    const isConstant = rc.flowMode || !synced;
    const env = isConstant
      ? 1.0
      : Math.max(0, 1 - rc.subdividedBeatPhase / params.decay);
    if (!isConstant && env < 0.01) return;

    // Linear color interpolation across the clip duration. When
    // colorEnd === color (default), this is a no-op (t-mix yields the
    // same color regardless of progress) — back-compat with pre-color-
    // gradient Edge Glow clips. clipProgress is time-based (not beat-
    // based), so it's independent of the automation-resolver mode
    // (per-clip Flow Mode) and behaves identically under variable BPM.
    const cStart = _hexToRgba01(params.color);
    const cEnd = _hexToRgba01(params.colorEnd);
    const t =
      rc.clipDurationSec > 0
        ? Math.max(
            0,
            Math.min(1, (rc.time - rc.clipStartSec) / rc.clipDurationSec)
          )
        : 0;
    const color = [
      cStart[0] + (cEnd[0] - cStart[0]) * t,
      cStart[1] + (cEnd[1] - cStart[1]) * t,
      cStart[2] + (cEnd[2] - cStart[2]) * t,
      cStart[3] + (cEnd[3] - cStart[3]) * t
    ] as const;
    const canvas = rc.ctx.canvas;

    renderGlFx({
      rc,
      fragSrc: EDGE_GLOW_FRAG_SRC,
      source: 'canvas',
      uniformNames: [
        'u_resolution',
        'u_threshold',
        'u_color',
        'u_glow',
        'u_bg_opacity',
        'u_intensity'
      ],
      uniforms: {
        // u_resolution shadows the pipeline default (GL canvas dims) on
        // purpose: source='canvas' uploads rc.ctx.canvas as the texture,
        // so Sobel's `1.0 / u_resolution` texel offsets must be in main-
        // canvas pixel space, not in scaled-GL-canvas pixel space.
        u_resolution: [canvas.width, canvas.height] as const,
        u_threshold: params.threshold,
        u_color: color,
        u_glow: params.glowAmount,
        u_bg_opacity: params.bgOpacity,
        u_intensity: params.intensity * env
      }
    });
  },

  dispose() {}
};
