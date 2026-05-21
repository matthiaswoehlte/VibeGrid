import { isClient } from '@/lib/utils/is-client';
import { beatPhase } from '@/lib/audio/grid';
import { lastFiredBeatGuard } from '@/lib/audio/clip-utils';
import { activeClipOnTrack } from '@/lib/timeline/selectors';
import { resolveClipParams } from '@/lib/automation/resolve';
import { computeClipAlpha } from './blend';
import { getPlugin, listPluginsByKind } from './registry';
import { registerBuiltInPlugins } from '@/lib/fx';
import type { FxKind as TrackFxKind, TimelineState } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';
import type { FxKind, FxPlugin, RenderContext } from './types';

export interface RendererDeps {
  canvas: HTMLCanvasElement;
  getCurrentTime: () => number;
  getBeatGrid: () => BeatGrid;
  getTimelineState: () => TimelineState;
  getImageBitmap: (mediaId: string) => ImageBitmap | undefined;
  /** Plan-5.9b: optional video-frame source per video MediaRef id.
   *  Returns null when the video isn't loaded yet — the renderer skips
   *  the draw for that frame rather than throwing. */
  getVideoElement?: (mediaId: string) => HTMLVideoElement | null;
  /** Increments on each seek so the loop can clear lastFired state. */
  getSeekCounter?: () => number;
  /** Optional — when missing, the loop defaults to Beat Mode (false). The
   *  studio hook passes a store-getter so the toggle is read once per tick. */
  getFlowMode?: () => boolean;
  rafCallback?: (cb: FrameRequestCallback) => number;
  cancelRafCallback?: (id: number) => void;
}

export interface Renderer {
  start(): void;
  stop(): void;
  /** Run one frame synchronously — used by tests. */
  tick(): void;
}

// Plan 5.8a — render order (bottom-up):
// Dissolve manipulates the image directly (first overlay). Image-FX
// (Contour edges, ZoomPulse scale) come next. Sweep + Particle + Pulse
// are visual flashes. Sunray = directional light, sits above flashes.
// Text is always on top.
const RENDER_ORDER: FxKind[] = [
  'Dissolve',
  'Contour',
  'ZoomPulse',
  'Sweep',
  'Particle',
  'Pulse',
  'Sunray',
  'Text'
];

/**
 * Map FX plugin `kind` (PascalCase) to the corresponding key in `activeFxClipsByKind`'s
 * Record (lowercase, sometimes pluralized). Cannot rely on `kind.toLowerCase()` —
 * 'Particle'.toLowerCase() === 'particle' but the timeline slice key is 'particles'.
 */
const KIND_TO_TRACK_KIND: Record<FxKind, TrackFxKind> = {
  Contour: 'contour',
  ZoomPulse: 'zoom-pulse',
  Pulse: 'pulse',
  Sweep: 'sweep',
  Particle: 'particles',
  // Plan 5.8a — new kinds, lowercase TrackKind names match 1:1.
  Text: 'text',
  Dissolve: 'dissolve',
  Sunray: 'sunray'
};

// Plan 5.9b hotfix: turn the current video frame into an ImageBitmap so
// FX plugins that consume `rc.imageBitmap` (ZoomPulse, Contour) operate
// on the video the same way they do on still images.
//
// Strategy: a single module-scoped OffscreenCanvas at the source video's
// intrinsic size. Per tick we drawImage(videoEl) into it, then
// `transferToImageBitmap()` — synchronous, no Promise chain to thread
// through the RAF loop. The captured bitmap lives for ONE tick and is
// closed at the end of `tick()` so we don't leak ~8 MB of GPU memory
// per frame.
//
// Plugin behaviour:
//   - ZoomPulse: fresh bitmap each tick → animates the live video frame.
//   - Contour: ImageBitmap-keyed WeakMap → cache miss every tick, async
//     preload triggered but the bitmap is closed before the preload
//     finishes its `getImageData`. Net effect: Contour silently doesn't
//     render for video. Acceptable trade-off; per-frame edge extraction
//     would cost 50-200 ms per call (10x realtime). Future work.
let frameCaptureCanvas: OffscreenCanvas | null = null;

function captureVideoFrame(el: HTMLVideoElement): ImageBitmap | undefined {
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  const vw = el.videoWidth;
  const vh = el.videoHeight;
  if (!vw || !vh) return undefined;
  if (typeof el.readyState === 'number' && el.readyState < 2) return undefined;
  if (!frameCaptureCanvas) {
    frameCaptureCanvas = new OffscreenCanvas(vw, vh);
  } else if (frameCaptureCanvas.width !== vw || frameCaptureCanvas.height !== vh) {
    frameCaptureCanvas.width = vw;
    frameCaptureCanvas.height = vh;
  }
  const fctx = frameCaptureCanvas.getContext('2d');
  if (!fctx) return undefined;
  try {
    fctx.drawImage(el, 0, 0);
  } catch {
    return undefined;
  }
  if (typeof frameCaptureCanvas.transferToImageBitmap !== 'function') {
    return undefined;
  }
  return frameCaptureCanvas.transferToImageBitmap();
}

/**
 * Draw an image to the canvas with `object-fit: contain` semantics —
 * maintains aspect ratio, fits the entire image inside the canvas (may
 * leave letterbox bars when aspect ratios differ). Without this, a 4000-
 * wide source would be drawn at its native size and clip everything.
 */
/** Returns the intrinsic width/height of a Canvas image source. Handles
 *  ImageBitmap (.width/.height), HTMLVideoElement (.videoWidth/.videoHeight),
 *  and other CanvasImageSource shapes via duck-typing. Falls back to 0/0
 *  which causes the contain-fit math to bail. */
function intrinsicSize(src: CanvasImageSource): { width: number; height: number } {
  const anySrc = src as {
    width?: number;
    height?: number;
    videoWidth?: number;
    videoHeight?: number;
    naturalWidth?: number;
    naturalHeight?: number;
  };
  if (typeof anySrc.videoWidth === 'number' && typeof anySrc.videoHeight === 'number') {
    return { width: anySrc.videoWidth, height: anySrc.videoHeight };
  }
  if (typeof anySrc.naturalWidth === 'number' && typeof anySrc.naturalHeight === 'number') {
    return { width: anySrc.naturalWidth, height: anySrc.naturalHeight };
  }
  return { width: anySrc.width ?? 0, height: anySrc.height ?? 0 };
}

function drawImageContain(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  w: number,
  h: number
): void {
  const { width, height } = intrinsicSize(src);
  if (width <= 0 || height <= 0) return;
  const scale = Math.min(w / width, h / height);
  const sw = width * scale;
  const sh = height * scale;
  const sx = (w - sw) / 2;
  const sy = (h - sh) / 2;
  ctx.drawImage(src, sx, sy, sw, sh);
}

export function createRenderer(deps: RendererDeps): Renderer {
  if (!isClient()) {
    throw new Error('Renderer cannot be created outside the browser');
  }
  registerBuiltInPlugins();

  const ctx = deps.canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const lastFiredByClip = new Map<string, number | null>();
  let lastSeenSeek = deps.getSeekCounter?.() ?? 0;
  let rafId: number | null = null;

  function tick(): void {
    // Skip if the canvas has a zero-sized pixel buffer (happens during window
    // resize when the parent flex container collapses briefly). Drawing into
    // a 0×0 buffer is silent — the image would visually disappear until next
    // observer fire. Returning early keeps the previous frame on-screen.
    const w = deps.canvas.width;
    const h = deps.canvas.height;
    if (w === 0 || h === 0) return;

    // Guard against non-finite time (HTMLMediaElement.currentTime can be NaN
    // between src-assignment and the loadedmetadata event). NaN propagates
    // into plugin math like createRadialGradient(NaN, ...) which throws.
    const rawTime = deps.getCurrentTime();
    const time = Number.isFinite(rawTime) ? rawTime : 0;
    const grid = deps.getBeatGrid();
    const beats = ((time - grid.offsetMs / 1000) * grid.bpm) / 60;

    // OPAQUE clear — paint the background color instead of clearRect. Reason:
    // MediaRecorder captures the raw canvas buffer including alpha. With
    // clearRect (transparent), every FX that composites via globalAlpha < 1
    // blends against transparency in the recorded frame, so anything semi-
    // transparent (Pulse glow, Sweep orbs, Particles, Contour stroke, blend
    // crossfades) disappears in the export. drawImage stays visible because
    // it's opaque. Painting the page background once per frame keeps
    // on-screen rendering identical while giving the encoder a fully opaque
    // RGB buffer. Color matches CLAUDE.md `--bg`.
    ctx!.fillStyle = '#0c0d12';
    ctx!.fillRect(0, 0, w, h);

    // Watchlist Punkt 5: never render with negative beats. Canvas already cleared.
    if (beats < 0) return;

    // Seek detection — clear all per-clip lastFired state.
    const seekCounter = deps.getSeekCounter?.() ?? 0;
    if (seekCounter !== lastSeenSeek) {
      lastFiredByClip.clear();
      lastSeenSeek = seekCounter;
    }

    const phase = beatPhase(time, grid);
    const nearestBeatIndex = phase.phase > 0.5 ? phase.beatIndex + 1 : phase.beatIndex;
    // Read once per tick — flips mid-frame would tear the cross-clip frame.
    const flowMode = deps.getFlowMode?.() ?? false;

    const timeline = deps.getTimelineState();

    // Plan 5.9a — iterate `timeline.tracks` in array order (now the
    // authoritative render order). Per track ask `activeClipOnTrack` for
    // the single active clip. Multi-image-tracks crossfade via
    // computeClipAlpha exactly as before; the difference is the
    // back-to-front order is now driven by the user's track arrangement.
    //
    // Plan 5.9b — the same loop body handles `kind === 'video'` tracks.
    // The draw source is a HTMLVideoElement (via deps.getVideoElement)
    // instead of an ImageBitmap. drawImageContain accepts both as
    // CanvasImageSource.
    let firstImageBitmap: ImageBitmap | undefined;
    // Track whether we OWN the bitmap (created via `captureVideoFrame`)
    // vs whether it came from the media slice (owned by the store and
    // outlives the tick). We close at end of tick only when owned.
    let ownsFirstImageBitmap = false;
    for (const track of timeline.tracks) {
      const isImage = track.kind === 'image';
      const isVideo = track.kind === 'video';
      if (!isImage && !isVideo) continue;
      if (track.muted) continue;
      const ic = activeClipOnTrack(track.id, timeline.clips, beats);
      if (!ic || !ic.mediaId) continue;

      let source: CanvasImageSource | undefined;
      if (isImage) {
        const bm = deps.getImageBitmap(ic.mediaId);
        if (!bm) continue;
        source = bm;
        // FX plugins that need a bitmap (Contour edges, ZoomPulse
        // scale) take whichever was painted first.
        if (!firstImageBitmap) firstImageBitmap = bm;
      } else {
        const el = deps.getVideoElement?.(ic.mediaId);
        if (!el) continue;
        source = el;
        // Plan 5.9b hotfix: capture the current video frame as an
        // ImageBitmap so ZoomPulse / Contour can operate on it via
        // `rc.imageBitmap`, same as for image clips. Falls back to
        // undefined when OffscreenCanvas / transferToImageBitmap isn't
        // available (jsdom test env) — the existing skip-guard at
        // line 244 then bypasses the bitmap-consuming FX silently.
        if (!firstImageBitmap) {
          const snap = captureVideoFrame(el);
          if (snap) {
            firstImageBitmap = snap;
            ownsFirstImageBitmap = true;
          }
        }
      }

      const alpha = computeClipAlpha(timeline, ic, beats);
      const usesAlpha = alpha < 1;
      if (usesAlpha) {
        ctx!.save();
        ctx!.globalAlpha *= alpha;
      }
      drawImageContain(ctx!, source, w, h);
      if (usesAlpha) ctx!.restore();
    }

    // FX plugins that need a bitmap (Contour edges, ZoomPulse re-draw)
    // take whichever was painted first — same back-compat semantic as
    // the single-track world.
    const imageBitmap = firstImageBitmap;

    for (const kind of RENDER_ORDER) {
      const sliceKind = KIND_TO_TRACK_KIND[kind];
      // Plan 5.9a — multi-track per kind. Within a kind, render order is
      // the track-array order. Each track contributes at most one clip
      // (overlap rejection enforced at addClip time).
      const tracksOfKind = timeline.tracks.filter(
        (t) => t.kind === sliceKind && !t.muted
      );
      for (const track of tracksOfKind) {
        const clip = activeClipOnTrack(track.id, timeline.clips, beats);
        if (!clip) continue;

        const plugin: FxPlugin<unknown> | undefined =
          (clip.fxId ? getPlugin(clip.fxId) : undefined) ?? listPluginsByKind(kind)[0];
        if (!plugin) continue;

        // Contour reads rc.imageBitmap for Canny edges; ZoomPulse re-draws
        // the bitmap with a scale transform. Both require a bitmap. Pulse,
        // Sweep, Particle paint pure overlays and work on a black canvas.
        if ((plugin.kind === 'Contour' || plugin.kind === 'ZoomPulse') && !imageBitmap) continue;

        const guard = lastFiredBeatGuard(nearestBeatIndex, lastFiredByClip.get(clip.id) ?? null);
        const shouldFire = phase.isOnBeat && guard.shouldFire;
        if (phase.isOnBeat) lastFiredByClip.set(clip.id, guard.nextLastFired);

        // Plan-5.8a: clip-relative timing fields. startBeat is a timestamp
        // (needs offsetMs), lengthBeats is a duration (no offset term).
        const clipStartSec =
          (clip.startBeat * 60) / grid.bpm + grid.offsetMs / 1000;
        const clipDurationSec = (clip.lengthBeats * 60) / grid.bpm;

        const rc: RenderContext = {
          ctx: ctx!,
          width: w,
          height: h,
          time,
          beatPhase: phase.phase,
          beatIndex: phase.beatIndex,
          isOnBeat: shouldFire,
          trigger: clip.trigger ?? plugin.defaultTrigger,
          clipId: clip.id,
          clipStartSec,
          clipDurationSec,
          flowMode,
          imageBitmap
        };

        // Merge defaults with clip overrides. Without the spread, a clip with
        // partial params (e.g. only `{__blend: ...}` added by the lifecycle)
        // would lose access to every plugin default — Particles would render
        // with undefined spawnPerBeat, Pulse with undefined intensity, etc.
        const rawParams = {
          ...(plugin.getDefaultParams() as Record<string, unknown>),
          ...(clip.params ?? {})
        };
        const clipAlpha = computeClipAlpha(timeline, clip, beats);
        const usesAlpha = clipAlpha < 1;
        if (usesAlpha) {
          ctx!.save();
          ctx!.globalAlpha *= clipAlpha;
        }
        // Flow Mode passes a clip-relative beat so the resolver can stretch
        // the curve over `clip.lengthBeats`. Beat Mode keeps the absolute
        // beats it has always passed — preserves the existing semantics
        // (and any existing alignment users authored against the grid).
        const paramBeat = flowMode ? beats - clip.startBeat : beats;
        try {
          plugin.render(
            rc,
            resolveClipParams(rawParams, paramBeat, clip.lengthBeats, flowMode)
          );
        } catch (err) {
          // A plugin throwing inside RAF would tear down the whole render loop
          // (and trigger Next.js dev's unhandled-error overlay). Swallow per
          // plugin call so the rest of the frame still renders.
          // eslint-disable-next-line no-console
          console.warn(`[renderer] plugin "${plugin.id}" render() threw:`, err);
        } finally {
          if (usesAlpha) ctx!.restore();
        }
      }
    }

    // Plan 5.9b hotfix: release the per-tick video-frame ImageBitmap so
    // we don't leak ~8 MB per frame at 30-60 fps. Bitmaps from the
    // media slice (image clips) are owned by the store — never close
    // those. `close()` is a no-op if not supported.
    if (ownsFirstImageBitmap && firstImageBitmap && typeof firstImageBitmap.close === 'function') {
      firstImageBitmap.close();
    }
  }

  function start(): void {
    if (rafId !== null) return;
    const raf = deps.rafCallback ?? requestAnimationFrame;
    const loop = () => {
      tick();
      rafId = raf(loop);
    };
    rafId = raf(loop);
  }

  function stop(): void {
    if (rafId === null) return;
    const cancel = deps.cancelRafCallback ?? cancelAnimationFrame;
    cancel(rafId);
    rafId = null;
  }

  return { start, stop, tick };
}
