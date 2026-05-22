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

/** String-keyed cache. The key is `rc.imageBitmapKey` (provided by the
 *  renderer: `mediaId` for image clips, `${mediaId}|${500ms-bucket}`
 *  for video clips). Falls back to a bitmap-derived id when no key is
 *  provided — keeps existing tests / direct callers working. */
const cache = new Map<string, ContourPath[]>();
const inflight = new Set<string>();
/** Cap on cache size — protects against unbounded growth when a long
 *  video sweeps through many 500 ms buckets. FIFO eviction. */
const MAX_CACHE_ENTRIES = 128;

/** Mint a stable string id for an ImageBitmap that has no `imageBitmapKey`
 *  context (direct `preload()` calls in tests, future API consumers).
 *  WeakMap-backed so entries are GC'd with the bitmap. */
const bitmapKeyById = new WeakMap<ImageBitmap, string>();
let nextBitmapId = 0;
function getBitmapKey(bm: ImageBitmap): string {
  let k = bitmapKeyById.get(bm);
  if (!k) {
    k = `bm-${++nextBitmapId}`;
    bitmapKeyById.set(bm, k);
  }
  return k;
}

function evictIfFull(): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Edge-detection threshold for extractContours. */
const CONTOUR_THRESHOLD = 0.3;
/** Paths shorter than this point count are dropped as noise. */
const MIN_PATH_POINTS = 8;

/** Synchronous edge extraction from an ImageBitmap. Used by both the
 *  public `preload()` (warm the cache ahead of render) and `render()`
 *  (extract on cache miss for video bucket transitions). */
function extractFromBitmap(bm: ImageBitmap): ContourPath[] {
  const off = new OffscreenCanvas(bm.width, bm.height);
  const offCtx = off.getContext('2d');
  if (!offCtx) throw new Error('OffscreenCanvas 2d context unavailable');
  offCtx.drawImage(bm as unknown as CanvasImageSource, 0, 0);
  const img = (offCtx as unknown as CanvasRenderingContext2D).getImageData(
    0,
    0,
    bm.width,
    bm.height
  );
  const allPaths = extractContours(img, CONTOUR_THRESHOLD);
  return allPaths.filter((p) => p.points.length >= MIN_PATH_POINTS);
}

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
      label: 'Sweep speed',
      // Plan 5.8b — `sweepDirection='all'` renders the contour without
      // animation, so the speed slider has no effect there.
      visibleWhen: (p) => p.sweepDirection !== 'all'
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
      const paths = extractFromBitmap(imageBitmap);
      if (signal.aborted) {
        contourPlugin.preloadState = 'idle';
        return;
      }
      cache.set(getBitmapKey(imageBitmap), paths);
      evictIfFull();
      contourPlugin.preloadState = 'ready';
    } catch {
      contourPlugin.preloadState = 'error';
    }
  },
  render(rc, params) {
    if (!rc.imageBitmap) return;
    // Renderer provides `imageBitmapKey` for normal flow (image: mediaId,
    // video: `${mediaId}|${500ms-bucket}`). Direct callers without a
    // RenderContext from the loop (tests, future) fall back to a bitmap-
    // derived id so caching still works per-bitmap.
    const key = rc.imageBitmapKey ?? getBitmapKey(rc.imageBitmap);
    let paths = cache.get(key);
    if (!paths) {
      // Cache miss → extract synchronously. Blocks the RAF for 50-200 ms
      // (the cost of getImageData + Canny). For video clips this hits
      // once per 500 ms bucket transition; for images this hits once on
      // first render. The inflight guard collapses concurrent miss
      // attempts on the same key during the same call stack — paranoia,
      // since extraction is synchronous.
      if (inflight.has(key)) return;
      inflight.add(key);
      try {
        paths = extractFromBitmap(rc.imageBitmap);
        cache.set(key, paths);
        evictIfFull();
      } catch {
        return;
      } finally {
        inflight.delete(key);
      }
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
