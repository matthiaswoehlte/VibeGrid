import type { FxPlugin } from '@/lib/renderer/types';
import { isClient } from '@/lib/utils/is-client';
import { extractContours, type ContourPath } from './preload';

type SweepDirection = 'all' | 'bl-tr' | 'tl-br' | 'tr-bl' | 'br-tl' | 'lr' | 'rl' | 'tb' | 'bt';

interface ContourParams {
  color: string;
  lineWidth: number;
  dashLength: number;
  sweepDirection: SweepDirection;
  sweepSpeed: number;
}

const cache = new WeakMap<ImageBitmap, ContourPath[]>();
const inflight = new WeakSet<ImageBitmap>();

/** Edge-detection threshold for extractContours. */
const CONTOUR_THRESHOLD = 0.3;
/** Paths shorter than this point count are dropped as noise. */
const MIN_PATH_POINTS = 8;

/**
 * Normalized progress (0..1) for a point at (x, y) under the given sweep
 * direction. Image-space coordinates; w/h are the image dimensions.
 */
function pointProgress(
  x: number,
  y: number,
  w: number,
  h: number,
  dir: SweepDirection
): number {
  switch (dir) {
    case 'all':
      return 0; // not used — caller short-circuits
    case 'lr':
      return x / w;
    case 'rl':
      return 1 - x / w;
    case 'tb':
      return y / h;
    case 'bt':
      return 1 - y / h;
    case 'bl-tr':
      // bottom-left (0, h) → top-right (w, 0)
      return (x + (h - y)) / (w + h);
    case 'tl-br':
      return (x + y) / (w + h);
    case 'tr-bl':
      return ((w - x) + y) / (w + h);
    case 'br-tl':
      return ((w - x) + (h - y)) / (w + h);
    default:
      return 0;
  }
}

export const contourPlugin: FxPlugin<ContourParams> = {
  id: 'contour',
  name: 'Contour',
  kind: 'Contour',
  defaultTrigger: 'beat',
  preloadState: 'idle',
  paramSchema: {
    color: { kind: 'color', default: '#a86bff', label: 'Stroke color' },
    lineWidth: {
      kind: 'slider',
      min: 0.5,
      max: 4,
      step: 0.1,
      default: 1,
      unit: 'px',
      label: 'Line width'
    },
    dashLength: {
      kind: 'slider',
      min: 0,
      max: 40,
      step: 1,
      default: 0,
      unit: 'px',
      label: 'Dash length (0 = solid)'
    },
    sweepDirection: {
      kind: 'select',
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
      default: 'all',
      label: 'Sweep direction'
    },
    sweepSpeed: {
      kind: 'slider',
      min: 0.25,
      max: 4,
      step: 0.25,
      default: 1,
      unit: 'cyc/bar',
      label: 'Sweep speed'
    }
  },
  getDefaultParams: () => ({
    color: '#a86bff',
    lineWidth: 1,
    dashLength: 0,
    sweepDirection: 'all',
    sweepSpeed: 1
  }),
  async preload(imageBitmap, signal) {
    if (!isClient()) return;
    contourPlugin.preloadState = 'loading';
    try {
      const off = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
      const offCtx = off.getContext('2d');
      if (!offCtx) throw new Error('OffscreenCanvas 2d context unavailable');
      offCtx.drawImage(imageBitmap as unknown as CanvasImageSource, 0, 0);
      const img = (offCtx as unknown as CanvasRenderingContext2D).getImageData(
        0,
        0,
        imageBitmap.width,
        imageBitmap.height
      );
      if (signal.aborted) {
        contourPlugin.preloadState = 'idle';
        return;
      }
      const allPaths = extractContours(img, CONTOUR_THRESHOLD);
      // Drop short paths — they're almost always single-pixel noise that
      // produces the "edges everywhere" look on busy images. Keeps the
      // contour overlay tight to actual structural lines.
      const paths = allPaths.filter((p) => p.points.length >= MIN_PATH_POINTS);
      cache.set(imageBitmap, paths);
      contourPlugin.preloadState = 'ready';
    } catch {
      contourPlugin.preloadState = 'error';
    }
  },
  render(rc, params) {
    if (!rc.imageBitmap) return;
    const paths = cache.get(rc.imageBitmap);
    if (!paths) {
      if (!inflight.has(rc.imageBitmap)) {
        inflight.add(rc.imageBitmap);
        const ctrl = new AbortController();
        contourPlugin.preload(rc.imageBitmap, ctrl.signal).catch(() => {
          /* swallow — preloadState reflects errors */
        });
      }
      return;
    }
    if (paths.length === 0) return;

    const bw = rc.imageBitmap.width;
    const bh = rc.imageBitmap.height;
    // Match drawImageContain's scale + offset so contours stay tight to the
    // image and never leak into the letterbox bars. Same math as in
    // lib/renderer/loop.ts drawImageContain().
    const fit = Math.min(rc.width / bw, rc.height / bh);
    const drawnW = bw * fit;
    const drawnH = bh * fit;
    const offX = (rc.width - drawnW) / 2;
    const offY = (rc.height - drawnH) / 2;

    // Sweep progress: one full cycle every `beatsPerBar / sweepSpeed` beats.
    // With beatsPerBar = 4 (v0.1 fixed) and sweepSpeed = 1 → 4-beat cycle.
    // beatPhase alone (0..1 within a beat) is too fast — use a running
    // bar-relative phase derived from beatIndex.
    const beatsPerBar = 4;
    const cycleBeats = beatsPerBar / Math.max(0.01, params.sweepSpeed);
    const cyclePos =
      (((rc.beatIndex + rc.beatPhase) % cycleBeats) + cycleBeats) % cycleBeats;
    const sweepPhase = cyclePos / cycleBeats; // 0..1
    const useSweep = params.sweepDirection !== 'all';
    // Reveal trails ~20% of the sweep front so transitions feel smooth.
    const REVEAL_TRAIL = 0.2;

    rc.ctx.save();
    rc.ctx.strokeStyle = params.color;
    rc.ctx.lineWidth = params.lineWidth;
    rc.ctx.lineJoin = 'round';
    rc.ctx.lineCap = 'round';
    if (params.dashLength > 0) {
      rc.ctx.setLineDash([params.dashLength, params.dashLength]);
      rc.ctx.lineDashOffset = -rc.beatPhase * params.dashLength * 2;
    } else {
      rc.ctx.setLineDash([]);
    }

    for (const path of paths) {
      if (path.points.length < 2) continue;

      if (!useSweep) {
        // Fast path — draw the whole path.
        rc.ctx.beginPath();
        const [x0, y0] = path.points[0];
        rc.ctx.moveTo(offX + x0 * fit, offY + y0 * fit);
        for (let i = 1; i < path.points.length; i++) {
          const [x, y] = path.points[i];
          rc.ctx.lineTo(offX + x * fit, offY + y * fit);
        }
        rc.ctx.stroke();
        continue;
      }

      // Sweep path: draw only segments whose endpoints are inside the
      // reveal window [sweepPhase - REVEAL_TRAIL, sweepPhase]. Each segment
      // gets an alpha based on its distance from the leading edge so the
      // wipe trails off smoothly.
      let prevInWindow = false;
      let prevX = 0;
      let prevY = 0;
      for (let i = 0; i < path.points.length; i++) {
        const [x, y] = path.points[i];
        const t = pointProgress(x, y, bw, bh, params.sweepDirection);
        const dist = sweepPhase - t;
        const inWindow = dist >= 0 && dist <= REVEAL_TRAIL;
        const sx = offX + x * fit;
        const sy = offY + y * fit;
        if (inWindow) {
          if (prevInWindow) {
            // Alpha follows distance from leading edge — points near the
            // front are full alpha, points near the trail fade out.
            const alpha = 1 - dist / REVEAL_TRAIL;
            rc.ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
            rc.ctx.beginPath();
            rc.ctx.moveTo(prevX, prevY);
            rc.ctx.lineTo(sx, sy);
            rc.ctx.stroke();
          }
          prevX = sx;
          prevY = sy;
          prevInWindow = true;
        } else {
          prevInWindow = false;
        }
      }
    }
    rc.ctx.restore();
  }
};
