import type { FxPlugin, RenderContext } from '@/lib/renderer/types';
import { darken } from '@/lib/utils/color';

export type TextFontFamily =
  | 'Arial'
  | 'Georgia'
  | 'Impact'
  | 'Courier New'
  | 'Times New Roman'
  | 'Verdana';

type GradientOrientation =
  | 'top-to-bottom'
  | 'left-to-right'
  | 'top-left-to-bottom-right'
  | 'center-to-outside';

type ExtrusionDirection = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
type ExtrusionStyle = 'plain' | 'rock';

interface TextParams {
  text: string;
  fontSize: number;
  fontFamily: TextFontFamily;
  colorFrom: string;
  colorTo: string;
  gradientOrientation: GradientOrientation;
  /** When true, position interpolates 0→1 over the clip length;
   *  the `progress` param is ignored. When false, `progress` is used directly. */
  useAutoProgress: boolean;
  progress: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  blink: boolean;
  blinkDecay: number;
  enable3d: boolean;
  extrusionDirection: ExtrusionDirection;
  extrusionDepth: number;
  extrusionStyle: ExtrusionStyle;
}

interface TextClipState {
  /** Pre-baked random jitter for the 'rock' 3D style — generated once per
   *  clip so the rocky edges don't flicker frame-to-frame. Length matches
   *  the max extrusionDepth (30). */
  rockJitter: Array<{ dx: number; dy: number }>;
}

const MAX_EXTRUSION_DEPTH = 30;
const clipStates = new Map<string, TextClipState>();

function getOrCreateState(clipId: string): TextClipState {
  let s = clipStates.get(clipId);
  if (!s) {
    s = {
      rockJitter: Array.from({ length: MAX_EXTRUSION_DEPTH }, () => ({
        dx: Math.random() * 1.5 - 0.75,
        dy: Math.random() * 1.5 - 0.75
      }))
    };
    clipStates.set(clipId, s);
  }
  return s;
}

const EXTRUSION_DIR: Record<ExtrusionDirection, { x: number; y: number }> = {
  'top-right': { x: 1, y: -1 },
  'top-left': { x: -1, y: -1 },
  'bottom-right': { x: 1, y: 1 },
  'bottom-left': { x: -1, y: 1 }
};

function buildGradient(
  ctx: CanvasRenderingContext2D,
  orientation: GradientOrientation,
  metrics: { x: number; y: number; width: number; height: number },
  from: string,
  to: string
): CanvasGradient {
  const { x, y, width, height } = metrics;
  if (orientation === 'center-to-outside') {
    const r = Math.max(width, height) / 2;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, from);
    grad.addColorStop(1, to);
    return grad;
  }
  let x0 = x - width / 2;
  let y0 = y;
  let x1 = x + width / 2;
  let y1 = y;
  if (orientation === 'top-to-bottom') {
    x0 = x;
    y0 = y - height / 2;
    x1 = x;
    y1 = y + height / 2;
  } else if (orientation === 'top-left-to-bottom-right') {
    x0 = x - width / 2;
    y0 = y - height / 2;
    x1 = x + width / 2;
    y1 = y + height / 2;
  }
  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, from);
  grad.addColorStop(1, to);
  return grad;
}

export const textPlugin: FxPlugin<TextParams> = {
  id: 'text',
  name: 'Text',
  kind: 'Text',
  defaultTrigger: 'beat',
  preloadState: 'ready',
  paramSchema: {
    text: { kind: 'text', default: 'VibeGrid', maxLength: 64, label: 'Text' },
    fontSize: {
      kind: 'slider',
      min: 8,
      max: 200,
      step: 1,
      default: 48,
      unit: 'px',
      label: 'Font size'
    },
    fontFamily: {
      kind: 'select',
      options: [
        { value: 'Arial', label: 'Arial' },
        { value: 'Georgia', label: 'Georgia' },
        { value: 'Impact', label: 'Impact' },
        { value: 'Courier New', label: 'Courier New' },
        { value: 'Times New Roman', label: 'Times New Roman' },
        { value: 'Verdana', label: 'Verdana' }
      ],
      default: 'Arial',
      label: 'Font'
    },
    colorFrom: { kind: 'color', default: '#ffffff', label: 'Color from' },
    colorTo: { kind: 'color', default: '#a86bff', label: 'Color to' },
    gradientOrientation: {
      kind: 'select',
      options: [
        { value: 'top-to-bottom', label: '↓ Top → bottom' },
        { value: 'left-to-right', label: '→ Left → right' },
        { value: 'top-left-to-bottom-right', label: '↘ Diagonal' },
        { value: 'center-to-outside', label: '⊙ Radial' }
      ],
      default: 'left-to-right',
      label: 'Gradient'
    },
    useAutoProgress: { kind: 'toggle', default: true, label: 'Auto-progress' },
    progress: {
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      label: 'Progress (manual)',
      // Plan 5.8b — manual progress is overridden by auto, so it only
      // matters when the user has explicitly turned auto off.
      visibleWhen: (p) => p.useAutoProgress === false
    },
    startX: { kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.1, label: 'Start X' },
    startY: { kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Start Y' },
    endX: {
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.9,
      label: 'End X',
      // Plan 5.8b — the end position only matters when the text actually
      // moves toward it: either auto-progress is on (animation will hit
      // the end), or manual progress is past zero (text has moved at
      // least somewhat toward end). With auto off AND progress=0 the
      // text is statically anchored at startX/startY — endX/endY are
      // dead inputs in that state and we hide them.
      visibleWhen: (p) =>
        p.useAutoProgress === true ||
        (typeof p.progress === 'number' && p.progress > 0)
    },
    endY: {
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      label: 'End Y',
      visibleWhen: (p) =>
        p.useAutoProgress === true ||
        (typeof p.progress === 'number' && p.progress > 0)
    },
    blink: { kind: 'toggle', default: false, label: 'Blink on beat' },
    blinkDecay: {
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.7,
      label: 'Blink decay',
      // Plan 5.8b — only relevant while blink-on-beat is active.
      visibleWhen: (p) => p.blink === true
    },
    enable3d: { kind: 'toggle', default: false, label: '3D extrusion' },
    extrusionDirection: {
      kind: 'select',
      options: [
        { value: 'bottom-right', label: '↘ Bottom-right' },
        { value: 'bottom-left', label: '↙ Bottom-left' },
        { value: 'top-right', label: '↗ Top-right' },
        { value: 'top-left', label: '↖ Top-left' }
      ],
      default: 'bottom-right',
      label: 'Extrusion dir',
      // Plan 5.8b — only meaningful when 3D extrusion is enabled.
      visibleWhen: (p) => p.enable3d === true
    },
    extrusionDepth: {
      kind: 'slider',
      min: 2,
      max: MAX_EXTRUSION_DEPTH,
      step: 1,
      default: 8,
      unit: 'px',
      label: 'Extrusion depth',
      visibleWhen: (p) => p.enable3d === true
    },
    extrusionStyle: {
      kind: 'select',
      options: [
        { value: 'plain', label: 'Plain (smooth)' },
        { value: 'rock', label: 'Rock (jittered)' }
      ],
      default: 'plain',
      label: 'Extrusion style',
      visibleWhen: (p) => p.enable3d === true
    }
  },
  getDefaultParams: (): TextParams => ({
    text: 'VibeGrid',
    fontSize: 48,
    fontFamily: 'Arial',
    colorFrom: '#ffffff',
    colorTo: '#a86bff',
    gradientOrientation: 'left-to-right',
    useAutoProgress: true,
    progress: 0,
    startX: 0.1,
    startY: 0.5,
    endX: 0.9,
    endY: 0.5,
    blink: false,
    blinkDecay: 0.7,
    enable3d: false,
    extrusionDirection: 'bottom-right',
    extrusionDepth: 8,
    extrusionStyle: 'plain'
  }),
  async preload() {
    // System fonts only — no network load needed.
  },
  render(rc: RenderContext, params: TextParams): void {
    if (!params.text) return;

    // Clip-relative progress 0..1
    const t = params.useAutoProgress
      ? rc.clipDurationSec > 0
        ? Math.max(0, Math.min(1, (rc.time - rc.clipStartSec) / rc.clipDurationSec))
        : 0
      : Math.max(0, Math.min(1, params.progress));

    const x = (params.startX + (params.endX - params.startX) * t) * rc.width;
    const y = (params.startY + (params.endY - params.startY) * t) * rc.height;

    // Blink alpha — stateless from beatPhase. flowMode skips the blink
    // entirely (continuous output, no beat-pulse).
    const blinkAlpha =
      params.blink && !rc.flowMode
        ? Math.max(0, 1 - rc.beatPhase * (1 + params.blinkDecay * 3))
        : 1;

    rc.ctx.save();
    rc.ctx.globalAlpha *= blinkAlpha;
    rc.ctx.font = `bold ${params.fontSize}px ${params.fontFamily}`;
    rc.ctx.textAlign = 'center';
    rc.ctx.textBaseline = 'middle';

    // 3D extrusion stack — draw from deep layers up. Each layer offset by
    // (i × dirX, i × dirY); 'rock' adds the pre-baked per-clip jitter.
    if (params.enable3d && params.extrusionDepth > 0) {
      const dir = EXTRUSION_DIR[params.extrusionDirection];
      const state = getOrCreateState(rc.clipId);
      const depth = Math.min(MAX_EXTRUSION_DEPTH, Math.max(1, Math.round(params.extrusionDepth)));
      for (let i = depth; i > 0; i--) {
        const dx = i * dir.x;
        const dy = i * dir.y;
        const jx = params.extrusionStyle === 'rock' ? state.rockJitter[i - 1]?.dx ?? 0 : 0;
        const jy = params.extrusionStyle === 'rock' ? state.rockJitter[i - 1]?.dy ?? 0 : 0;
        rc.ctx.fillStyle = darken(params.colorFrom, (i / depth) * 0.6);
        rc.ctx.fillText(params.text, x + dx + jx, y + dy + jy);
      }
    }

    // Foreground text with gradient.
    const metrics = rc.ctx.measureText(params.text);
    const width = metrics.width || params.fontSize * params.text.length * 0.5;
    const height = params.fontSize;
    const grad = buildGradient(
      rc.ctx,
      params.gradientOrientation,
      { x, y, width, height },
      params.colorFrom,
      params.colorTo
    );
    rc.ctx.fillStyle = grad;
    rc.ctx.fillText(params.text, x, y);
    rc.ctx.restore();
  },
  dispose() {
    clipStates.clear();
  }
};
