import type { FxPlugin } from '@/lib/renderer/types';
import { isClient } from '@/lib/utils/is-client';
import { extractContours, type ContourPath } from './preload';

interface ContourParams {
  color: string;
  threshold: number;
  dashLength: number;
}

const cache = new WeakMap<ImageBitmap, ContourPath[]>();

export const contourPlugin: FxPlugin<ContourParams> = {
  id: 'contour',
  name: 'Contour',
  kind: 'Contour',
  defaultTrigger: 'beat',
  preloadState: 'idle',
  paramSchema: {
    color: { kind: 'color', default: '#a86bff', label: 'Stroke color' },
    threshold: {
      kind: 'slider',
      min: 0.05,
      max: 0.95,
      step: 0.05,
      default: 0.3,
      label: 'Edge threshold'
    },
    dashLength: {
      kind: 'slider',
      min: 4,
      max: 40,
      step: 1,
      default: 12,
      unit: 'px',
      label: 'Dash length'
    }
  },
  getDefaultParams: () => ({ color: '#a86bff', threshold: 0.3, dashLength: 12 }),
  async preload(imageBitmap, signal) {
    // SSR / Capacitor guard — OffscreenCanvas is browser-only (CLAUDE.md rule #1).
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
      const paths = extractContours(img, 0.3);
      cache.set(imageBitmap, paths);
      contourPlugin.preloadState = 'ready';
    } catch {
      contourPlugin.preloadState = 'error';
    }
  },
  render(rc, params) {
    if (!rc.imageBitmap) return;
    const paths = cache.get(rc.imageBitmap);
    if (!paths || paths.length === 0) return;

    const sx = rc.width / rc.imageBitmap.width;
    const sy = rc.height / rc.imageBitmap.height;

    rc.ctx.save();
    rc.ctx.strokeStyle = params.color;
    rc.ctx.lineWidth = 2;
    rc.ctx.setLineDash([params.dashLength, params.dashLength]);
    rc.ctx.lineDashOffset = -rc.beatPhase * params.dashLength * 2;

    for (const path of paths) {
      if (path.points.length < 2) continue;
      rc.ctx.beginPath();
      const [x0, y0] = path.points[0];
      rc.ctx.moveTo(x0 * sx, y0 * sy);
      for (let i = 1; i < path.points.length; i++) {
        const [x, y] = path.points[i];
        rc.ctx.lineTo(x * sx, y * sy);
      }
      rc.ctx.stroke();
    }
    rc.ctx.restore();
  }
};
