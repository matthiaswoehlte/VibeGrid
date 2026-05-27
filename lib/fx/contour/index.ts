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

/**
 * Beat-Trigger state per clip. Records `(beatIndex, bitmapKey)` of the
 * LAST extract for each clipId. The render path re-extracts only when
 * the beatIndex changes — bitmap-key changes mid-beat (video bucket
 * transitions every 500 ms) do NOT trigger a fresh Sobel run; the
 * previous beat's edges are reused. Trade-off: edges visually lag by
 * up to one beat on video clips, in exchange for the per-frame spike
 * cost being capped at "max 1 extract per beat per clip" (≤ 4 extracts/s
 * at 240 BPM, ≤ 1/s at 60 BPM).
 *
 * The spike still happens — but at a predictable musical instant where
 * a visual "edge-refresh" reads as intentional, not as a stutter.
 */
const lastExtractByClip = new Map<
  string,
  { beatIndex: number; bitmapKey: string }
>();

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

/** Test-only: clear the contour edge cache between cases. */
export function _resetContourCacheForTests(): void {
  cache.clear();
  inflight.clear();
  lastExtractByClip.clear();
}

/** Edge-detection threshold for extractContours. */
const CONTOUR_THRESHOLD = 0.3;
/** Paths shorter than this point count are dropped as noise. */
const MIN_PATH_POINTS = 8;

/**
 * Resolution scale applied before Sobel runs. At 0.5 we drop pixel count
 * by 4× (1920×1080 → 960×540). The full extract pipeline (grayscale →
 * blur → sobel → flood-fill) costs roughly ¼ as much; cache-miss spikes
 * drop from ~191 ms to ~125 ms on a 1080p frame.
 *
 * **Why not lower (0.25)?** Empirically tested — quarter-res Sobel
 * generates MORE paths due to aliasing artifacts on high-detail
 * sources, which pushes per-frame polyline-render cost up enough to
 * net-negate the extract savings. Plus the max-spike got worse, not
 * better (a pathological connected-component case). 0.5 is the sweet
 * spot for this codebase.
 *
 * Exported so tests can read the value when verifying coordinate
 * upscale. Changing this affects every Contour clip; pick a different
 * value only after re-running the perf diagnose.
 */
export const EDGE_SCALE = 0.5;

/** Synchronous edge extraction from an ImageBitmap. Used by both the
 *  public `preload()` (warm the cache ahead of render) and `render()`
 *  (extract on cache miss for video bucket transitions).
 *
 *  Half-resolution: the bitmap is rasterised onto a 0.5×-sized
 *  OffscreenCanvas, Sobel runs on the smaller pixel grid, and the
 *  resulting edge-point coordinates are scaled back up before being
 *  cached. Downstream `render()` consumes them in full-resolution
 *  coordinates, identical to the pre-half-res world.
 *
 *  Upscale is done **in-place** on the existing point-tuples returned
 *  by `extractContours` (they're freshly allocated per extract, no
 *  aliasing concern), and the path-array is filtered without `.map()`
 *  — avoiding ~5000 heap allocations per extract on a 1080p frame.
 */
function extractFromBitmap(bm: ImageBitmap): ContourPath[] {
  const w = Math.max(1, Math.round(bm.width * EDGE_SCALE));
  const h = Math.max(1, Math.round(bm.height * EDGE_SCALE));
  const off = new OffscreenCanvas(w, h);
  const offCtx = off.getContext('2d');
  if (!offCtx) throw new Error('OffscreenCanvas 2d context unavailable');
  // Nearest-neighbor downscale. Browsers default to bilinear which
  // costs ~3–5 ms extra on a 4× downscale of a 1080p frame — Sobel
  // doesn't need sub-pixel accuracy in the input, so we trade visual
  // smoothness of the intermediate for ~3–5 ms / extract.
  (offCtx as unknown as { imageSmoothingEnabled: boolean }).imageSmoothingEnabled =
    false;
  offCtx.drawImage(bm as unknown as CanvasImageSource, 0, 0, w, h);
  const img = (offCtx as unknown as CanvasRenderingContext2D).getImageData(
    0,
    0,
    w,
    h
  );
  const allPaths = extractContours(img, CONTOUR_THRESHOLD);
  const upscale = 1 / EDGE_SCALE;
  const out: ContourPath[] = [];
  for (const p of allPaths) {
    if (p.points.length < MIN_PATH_POINTS) continue;
    // In-place scale — extractContours returns freshly-allocated point
    // tuples; mutating them here avoids a second pass and a fresh
    // points-array allocation per path.
    for (const pt of p.points) {
      pt[0] *= upscale;
      pt[1] *= upscale;
    }
    out.push(p);
  }
  return out;
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
    const currentBitmapKey =
      rc.imageBitmapKey ?? getBitmapKey(rc.imageBitmap);
    const currentBeat = rc.beatIndex;
    const last = lastExtractByClip.get(rc.clipId);

    // Beat-Trigger: re-extract only when this clip enters a new beat,
    // not on every bitmap-key bucket transition. Architect intent: the
    // visual edge-refresh becomes musically synchronous and the spike
    // is "hidden" inside the user's perception of a beat.
    const needsExtract = !last || last.beatIndex !== currentBeat;

    let paths: ContourPath[] | undefined;
    if (needsExtract) {
      // Cache miss → extract synchronously. Blocks the RAF for 50-200 ms
      // (the cost of getImageData + Canny on the half-res frame).
      // Inflight guard collapses concurrent miss attempts on the same
      // clip during the same call stack — paranoia, since extraction
      // is synchronous.
      if (inflight.has(rc.clipId)) {
        paths = last ? cache.get(last.bitmapKey) : undefined;
        if (!paths || paths.length === 0) return;
      } else {
        inflight.add(rc.clipId);
        try {
          paths = extractFromBitmap(rc.imageBitmap);
          cache.set(currentBitmapKey, paths);
          lastExtractByClip.set(rc.clipId, {
            beatIndex: currentBeat,
            bitmapKey: currentBitmapKey
          });
          evictIfFull();
        } catch {
          return;
        } finally {
          inflight.delete(rc.clipId);
        }
      }
    } else {
      // Same beat as last extract — reuse those paths regardless of
      // whether the current bitmap-key matches (stale edges OK by
      // design within a beat window).
      paths = cache.get(last!.bitmapKey);
      if (!paths) {
        // FIFO eviction dropped the cached entry; fall through to a
        // fresh extract so we don't render edge-less.
        try {
          paths = extractFromBitmap(rc.imageBitmap);
          cache.set(currentBitmapKey, paths);
          lastExtractByClip.set(rc.clipId, {
            beatIndex: currentBeat,
            bitmapKey: currentBitmapKey
          });
          evictIfFull();
        } catch {
          return;
        }
      }
    }
    if (!paths || paths.length === 0) return;

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
