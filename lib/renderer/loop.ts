import { isClient } from '@/lib/utils/is-client';
import { beatPhase, BEAT_WINDOW_MS } from '@/lib/audio/grid';
import { lastFiredBeatGuard } from '@/lib/audio/clip-utils';
import { activeClipOnTrack, getActiveFxClips } from '@/lib/timeline/selectors';
import { SUBDIVISION_MULTIPLIERS } from '@/lib/timeline/types';
import { qualityManager } from '@/lib/renderer/webgl/quality';
import { resolveClipParams, resolveParam } from '@/lib/automation/resolve';
import type { StaticOrAuto } from '@/lib/automation/types';
import { computeClipAlpha } from './blend';
import { getPlugin, listPluginsByKind } from './registry';
import { registerBuiltInPlugins } from '@/lib/fx';
import type { TimelineState } from '@/lib/timeline/types';
import {
  TRACK_KIND_TO_PLUGIN_KIND,
  type TrackFxKind
} from '@/lib/timeline/plugin-mapping';
import type { BeatGrid } from '@/lib/audio/types';
import type { FxPlugin, RenderContext } from './types';

export interface RendererDeps {
  canvas: HTMLCanvasElement;
  getCurrentTime: () => number;
  getBeatGrid: () => BeatGrid;
  getTimelineState: () => TimelineState;
  getImageBitmap: (mediaId: string) => ImageBitmap | undefined;
  /** Plan-5.9b: optional video-frame source per video MediaRef id.
   *  Returns null when the video isn't loaded yet — the renderer skips
   *  the draw for that frame rather than throwing.
   *  Legacy path used by live preview AND as fallback when no
   *  getVideoFrame is provided. */
  getVideoElement?: (mediaId: string) => HTMLVideoElement | null;
  /** Plan 5.10+: optional decoded-VideoFrame source per video MediaRef
   *  id (from VideoDecoderPool). Preferred over getVideoElement when
   *  set. The returned frame is owned by the pool — the renderer draws
   *  it synchronously and never closes it. Returns null when no frame
   *  is available at the current time. */
  getVideoFrame?: (mediaId: string) => VideoFrame | null;
  /** Increments on each seek so the loop can clear lastFired state. */
  getSeekCounter?: () => number;
  /** Optional — when missing, the loop defaults to Beat Mode (false). The
   *  studio hook passes a store-getter so the toggle is read once per tick. */
  getFlowMode?: () => boolean;
  /** Plan 5.9d — per-frame volume ramp for active audio clips. No-op
   *  when the engine has no clip with this id. Sample-accurate via
   *  `gain.linearRampToValueAtTime` (engine handles the anchor). */
  rampClipVolume?: (clipId: string, volume: number, targetTime: number) => void;
  /** Plan 5.9d — current AudioContext clock time, used to compute the
   *  ramp's target time without holding an AudioContext reference. */
  getAudioContextTime?: () => number;
  rafCallback?: (cb: FrameRequestCallback) => number;
  cancelRafCallback?: (id: number) => void;
}

export interface Renderer {
  start(): void;
  stop(): void;
  /** Run one frame synchronously — used by tests. */
  tick(): void;
}

// Plan 5.9c — render order moved to `@/lib/timeline/plugin-mapping`
// as `RENDER_ORDER_TRACK_KIND` (lowercase, clip-side). The renderer's
// outer iteration now consumes `getActiveFxClips` which pre-sorts
// clips by that order via `fxSortIndex`. Plugin dispatch reads
// `TRACK_KIND_TO_PLUGIN_KIND[clip.kind]` to resolve the PascalCase
// plugin-kind for `listPluginsByKind`. The old PascalCase
// RENDER_ORDER + KIND_TO_TRACK_KIND constants are gone.

/** Plan 5.9b hotfix: Contour bucket size for video clips. Edge paths
 *  are re-extracted only when the video crosses into a new bucket.
 *  At 500 ms a 30 fps video extracts ~2 times/sec (50-200 ms each) —
 *  CPU-tolerable, visually refreshed often enough that contours track
 *  the moving subject reasonably. */
const CONTOUR_VIDEO_BUCKET_SEC = 0.5;

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
// Pairs with `imageBitmapKey` on RenderContext — Contour caches edges
// by that string key (image: mediaId, video: `mediaId|500ms-bucket`)
// instead of by bitmap identity, so Contour can re-use extraction
// results across the per-tick bitmaps that ZoomPulse needs fresh.
let frameCaptureCanvas: OffscreenCanvas | null = null;

/** Materialise an ImageBitmap from a WebCodecs VideoFrame so FX plugins
 *  that consume `rc.imageBitmap` (Contour edges, ZoomPulse scale) get
 *  the same source shape as for image clips. The frame stays open
 *  (caller owns it via the VideoDecoderPool's sliding cache). */
function captureVideoFrameFrom(frame: VideoFrame): ImageBitmap | undefined {
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  const vw = frame.displayWidth;
  const vh = frame.displayHeight;
  if (!vw || !vh) return undefined;
  if (!frameCaptureCanvas) {
    frameCaptureCanvas = new OffscreenCanvas(vw, vh);
  } else if (frameCaptureCanvas.width !== vw || frameCaptureCanvas.height !== vh) {
    frameCaptureCanvas.width = vw;
    frameCaptureCanvas.height = vh;
  }
  const fctx = frameCaptureCanvas.getContext('2d');
  if (!fctx) return undefined;
  try {
    fctx.drawImage(frame as unknown as CanvasImageSource, 0, 0);
  } catch {
    return undefined;
  }
  if (typeof frameCaptureCanvas.transferToImageBitmap !== 'function') {
    return undefined;
  }
  return frameCaptureCanvas.transferToImageBitmap();
}

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
  // WebCodecs path — pulls the decoded frame directly out of the
  // video element's decoder pipeline, bypassing the compositor (which
  // skips painting near-invisible elements like the offline export
  // pool, leaving drawImage to read stale frame 0). When unavailable
  // (older browsers), fall back to plain drawImage(videoEl).
  let videoFrame: VideoFrame | null = null;
  try {
    if (typeof VideoFrame !== 'undefined') {
      videoFrame = new VideoFrame(el);
    }
    fctx.drawImage(
      (videoFrame ?? el) as unknown as CanvasImageSource,
      0,
      0
    );
  } catch {
    videoFrame?.close();
    return undefined;
  } finally {
    videoFrame?.close();
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
 *  WebCodecs VideoFrame (.displayWidth/.displayHeight), and other
 *  CanvasImageSource shapes via duck-typing. Falls back to 0/0 which
 *  causes the contain-fit math to bail. */
function intrinsicSize(src: CanvasImageSource): { width: number; height: number } {
  const anySrc = src as {
    width?: number;
    height?: number;
    videoWidth?: number;
    videoHeight?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    displayWidth?: number;
    displayHeight?: number;
  };
  // VideoFrame (WebCodecs): displayWidth/displayHeight is the post-crop
  // post-rotation render size; check this first so VideoFrame doesn't
  // accidentally match the wider HTMLVideoElement path below.
  if (typeof anySrc.displayWidth === 'number' && typeof anySrc.displayHeight === 'number') {
    return { width: anySrc.displayWidth, height: anySrc.displayHeight };
  }
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

/**
 * Plan 8e — `object-fit: contain` rect for FX plugins that re-draw the
 * frame on a transformed context (ZoomPunch, ScreenShake, RGBSplit,
 * GlitchSlice). Returns the destination rect (sx, sy, sw, sh) that
 * matches what `drawImageContain` would use, so FX produce a frame
 * geometrically identical to the main image pass — no stretch, no
 * letterbox mismatch.
 *
 * Caller guarantees `rc.imageBitmap` exists (Kategorie-A FX gate on it).
 */
export function containRect(rc: RenderContext): {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
} {
  const bm = rc.imageBitmap!;
  const scale = Math.min(rc.width / bm.width, rc.height / bm.height);
  const sw = bm.width * scale;
  const sh = bm.height * scale;
  const sx = (rc.width - sw) / 2;
  const sy = (rc.height - sh) / 2;
  return { sx, sy, sw, sh };
}

/**
 * Plan 8e — kinds whose `render()` requires `rc.imageBitmap`. The Plan-8d
 * world only had Contour + ZoomPulse on this list; Plan 8e adds the new
 * image-modifying FX (ZoomPunch, ScreenShake, RGBSplit, GlitchSlice). FX
 * outside this set work on a pure-overlay canvas and need no bitmap.
 */
const IMAGE_MODIFYING_KINDS: ReadonlySet<string> = new Set([
  'Contour',
  'ZoomPulse',
  'ZoomPunch',
  'ScreenShake',
  'RGBSplit',
  'GlitchSlice',
  // Plan 8f.1 — WebGL2 FX that re-samples `rc.imageBitmap` in GLSL.
  'ColorGradeShift',
  // Plan 8f.2 — RetroVHS, same re-sampling pattern.
  'RetroVHS'
]);

export function createRenderer(deps: RendererDeps): Renderer {
  if (!isClient()) {
    throw new Error('Renderer cannot be created outside the browser');
  }
  registerBuiltInPlugins();

  const ctx = deps.canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const lastFiredByClip = new Map<string, number | null>();
  // Plan 9c.1 — per-clip Subdivision-Guard. Separater Index-Space als
  // `lastFiredByClip` weil `subdivisionIndex` bei sub=N× N× pro Beat
  // advanced; gleicher Guard-Mechanismus.
  const lastFiredSubdivisionByClip = new Map<string, number | null>();
  let lastSeenSeek = deps.getSeekCounter?.() ?? 0;
  let rafId: number | null = null;

  function tick(): void {
    // Render dimensions adapted to whatever transform the context has.
    //
    // - LIVE preview (`useRenderer`): `ctx.setTransform(dpr, 0, 0, dpr,
    //   0, 0)` is applied after every DPR resize, so drawing operations
    //   are CSS-space scaled. Buffer is `cssSize × dpr`; we need the
    //   CSS size for plugin math (Plan 5.10 iPhone-SE smoke bug —
    //   without dividing we rendered 2× and only the top-left quadrant
    //   was visible).
    // - OFFLINE export (`makeOfflineRenderer`): a static
    //   `OffscreenCanvas(1920, 1080)` with NO setTransform — the
    //   context's transform is identity. Buffer == content size; we
    //   pass canvas.width/height verbatim. Pre-fix this branch worked
    //   by coincidence (DPR-divide was missing); the fix initially
    //   broke offline because it divided by `window.devicePixelRatio`
    //   (host DPR) regardless of context state, shrinking the video
    //   render to the top-left quarter of the 1920×1080 buffer.
    //
    // `ctx.getTransform().a` returns the effective X-scale factor of
    // the current transform. Identity → 1 → no division. Live DPR
    // setTransform → dpr → division as before. Tests in jsdom inherit
    // identity (no DPR setup) → same as offline.
    const xScale = ctx!.getTransform().a || 1;
    const w = deps.canvas.width / xScale;
    const h = deps.canvas.height / xScale;
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
      lastFiredSubdivisionByClip.clear();
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
    // Stable string key paired with `firstImageBitmap` so plugins that
    // cache derived data (Contour edge paths) can key by a string that
    // survives across per-frame bitmap allocations on video clips.
    let firstImageBitmapKey: string | undefined;
    // Track whether we OWN the bitmap (created via `captureVideoFrame`)
    // vs whether it came from the media slice (owned by the store and
    // outlives the tick). We close at end of tick only when owned.
    let ownsFirstImageBitmap = false;
    for (const track of timeline.tracks) {
      const isImage = track.kind === 'image';
      // Plan 8d — `main-video` is a SceneFlow-owned singleton track that
      // carries clips of `kind: 'video'`. The renderer treats it
      // identically to a regular `'video'` track. Without this, the
      // transfer pipeline drops video clips onto a track the renderer
      // skips, and the canvas stays black despite the video elements
      // being loaded by useVideoEngine (which only checks CLIP kind).
      const isVideo = track.kind === 'video' || track.kind === 'main-video';
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
        if (!firstImageBitmap) {
          firstImageBitmap = bm;
          firstImageBitmapKey = ic.mediaId;
        }
      } else {
        // Plan 5.10+ — VideoDecoderPool path takes priority when set.
        // Decoded VideoFrame from mp4box + WebCodecs, deterministic,
        // compositor-independent. Frame is pool-owned (sliding cache);
        // we draw it but DON'T close it.
        const decodedFrame = deps.getVideoFrame?.(ic.mediaId) ?? null;
        if (decodedFrame) {
          source = decodedFrame as unknown as CanvasImageSource;
          if (!firstImageBitmap) {
            // For Plugin consumption (Contour / ZoomPulse) we need an
            // ImageBitmap. Materialise one from the VideoFrame via an
            // OffscreenCanvas drawImage round-trip. Same ~500 ms bucket
            // key semantic as the HTMLVideoElement path.
            const snap = captureVideoFrameFrom(decodedFrame);
            if (snap) {
              firstImageBitmap = snap;
              ownsFirstImageBitmap = true;
              const bucket = Math.floor(
                (decodedFrame.timestamp / 1_000_000) / CONTOUR_VIDEO_BUCKET_SEC
              );
              firstImageBitmapKey = `${ic.mediaId}|${bucket}`;
            }
          }
        } else {
          // Legacy HTMLVideoElement path.
          const el = deps.getVideoElement?.(ic.mediaId);
          if (!el) continue;
          source = el;
          // Plan 5.9d — opt-in video audio. Default behaviour (param
          // absent or `false`) is muted, matching the pre-5.9d wire-up
          // in `lib/video/engine.ts`. Param is treated as static —
          // automating audioEnabled per beat isn't supported in v0.1
          // (see KNOWN_LIMITATIONS).
          const audioEnabledRaw = (ic.params as { audioEnabled?: unknown } | undefined)?.audioEnabled;
          el.muted = audioEnabledRaw !== true;
          if (!firstImageBitmap) {
            const snap = captureVideoFrame(el);
            if (snap) {
              firstImageBitmap = snap;
              ownsFirstImageBitmap = true;
              const t = typeof el.currentTime === 'number' ? el.currentTime : 0;
              const bucket = Math.floor(t / CONTOUR_VIDEO_BUCKET_SEC);
              firstImageBitmapKey = `${ic.mediaId}|${bucket}`;
            }
          }
        }
      }

      const alpha = computeClipAlpha(timeline, ic, beats);
      const usesAlpha = alpha < 1;
      if (usesAlpha) {
        ctx!.save();
        ctx!.globalAlpha *= alpha;
      }
      // For HTMLVideoElement sources (legacy live + fallback offline)
      // pull the current decoded frame via WebCodecs
      // `new VideoFrame(videoElement)` if available — bypasses the
      // compositor stall that drawImage(videoEl) hits. Pool-sourced
      // VideoFrames skip this step entirely (they're already decoded).
      let ephemeralVideoFrame: VideoFrame | null = null;
      let drawSource: CanvasImageSource = source;
      if (
        isVideo &&
        typeof VideoFrame !== 'undefined' &&
        source instanceof HTMLVideoElement
      ) {
        try {
          ephemeralVideoFrame = new VideoFrame(source);
          drawSource = ephemeralVideoFrame as unknown as CanvasImageSource;
        } catch {
          // VideoFrame constructor throws if the video element isn't
          // ready (no current frame to extract) — fall back to drawing
          // the element directly.
        }
      }
      drawImageContain(ctx!, drawSource, w, h);
      // Ephemeral VideoFrame (HTMLVideoElement path) must be released
      // or memory leaks (each ~8 MB). Pool-sourced VideoFrames are
      // owned by the pool and stay open in its sliding cache.
      ephemeralVideoFrame?.close();
      if (usesAlpha) ctx!.restore();
    }

    // FX plugins that need a bitmap (Contour edges, ZoomPulse re-draw)
    // take whichever was painted first — same back-compat semantic as
    // the single-track world.
    const imageBitmap = firstImageBitmap;

    // Plan 5.9c — single iteration over every active FX clip across
    // all 'fx' tracks, pre-sorted by `RENDER_ORDER_TRACK_KIND`. Each
    // fx track may carry multiple clips of mixed kinds (the per-FX
    // track-kind world is gone). Inner-loop body below is unchanged
    // from the previous outer iteration — same alpha logic, same
    // bitmap-skip gate, same try/catch around plugin.render.
    const activeFxClips = getActiveFxClips(timeline.tracks, timeline.clips, beats);

    for (const { clip } of activeFxClips) {
      // Plugin resolution: explicit fxId wins, else look up the
      // default plugin instance registered for this clip-kind's
      // PascalCase. `TRACK_KIND_TO_PLUGIN_KIND` is the inverse of the
      // map plugins register under in lib/fx/.
      const pluginKind = TRACK_KIND_TO_PLUGIN_KIND[clip.kind as TrackFxKind];
      const plugin: FxPlugin<unknown> | undefined =
        (clip.fxId ? getPlugin(clip.fxId) : undefined)
        ?? (pluginKind ? listPluginsByKind(pluginKind)[0] : undefined);
      if (!plugin) continue;

      // Image-modifying FX (Contour, ZoomPulse + Plan 8e additions) re-draw
      // the bitmap on a transformed context — all require `rc.imageBitmap`.
      // Pure-overlay FX (Pulse, Sweep, Particle, BeatFlash, Vignette, etc.)
      // work on whatever was painted underneath and skip this gate.
      if (IMAGE_MODIFYING_KINDS.has(plugin.kind) && !imageBitmap) continue;

      const guard = lastFiredBeatGuard(nearestBeatIndex, lastFiredByClip.get(clip.id) ?? null);
      const shouldFire = phase.isOnBeat && guard.shouldFire;
      if (phase.isOnBeat) lastFiredByClip.set(clip.id, guard.nextLastFired);

      // Plan-5.8a: clip-relative timing fields. startBeat is a timestamp
      // (needs offsetMs), lengthBeats is a duration (no offset term).
      const clipStartSec =
        (clip.startBeat * 60) / grid.bpm + grid.offsetMs / 1000;
      const clipDurationSec = (clip.lengthBeats * 60) / grid.bpm;

      // Plan 9c.1 — subdivision phase in BEATS-since-last-boundary.
      //
      // Pre-fix (initial Plan 9c spec): `(phase.phase * multiplier) % 1`
      // gave a dimensionless value in [0,1). When FX did
      // `env = 1 - subdividedBeatPhase / decay`, the absolute decay
      // duration shrank linearly with the multiplier — at sub=8× +
      // decay=0.08 the pulse was visible for ~0.6 frames at 60fps,
      // making the multiplier feel like a no-op visually.
      //
      // Post-fix: subdividedBeatPhase is "beats since last subdivision
      // boundary", same units as `decay`. Each subdivision triggers a
      // fresh envelope of the SAME absolute shape as sub=1×, just N×
      // more often per beat. At sub=1× the formula reduces to
      // `phase.phase % 1 === phase.phase` — identical to pre-9c.
      const subdivision = clip.triggerSubdivision ?? '1×';
      const multiplier = SUBDIVISION_MULTIPLIERS[subdivision];
      const subdivisionIntervalBeats = 1 / multiplier;
      const subdividedBeatPhase = phase.phase % subdivisionIntervalBeats;
      // Plan 9c.1 — monoton steigender Subdivision-Zähler. Bei sub=1×
      // identisch zu `phase.beatIndex`. FX die per-Beat-Random-Seeds
      // nutzen (GlitchSlice, RetroVHS) hängen sich hier ran, damit jede
      // Subdivision ein neues Pattern produziert statt das Beat-Pattern
      // zu wiederholen.
      const subdivisionIndex = Math.floor(beats * multiplier);

      // Plan 9c.1 — `isOnSubdivision`: Subdivision-Pendant zu
      // `phase.isOnBeat`. Bei sub=1× identisch (subdivisionIntervalMs
      // === msPerBeat). Window-Logik analog `beatPhase()`:
      // distMs ≤ BEAT_WINDOW_MS am Boundary in beide Richtungen.
      const msPerBeat = 60_000 / grid.bpm;
      const distToSubStartMs = subdividedBeatPhase * msPerBeat;
      const distToSubEndMs =
        (subdivisionIntervalBeats - subdividedBeatPhase) * msPerBeat;
      const isNearSubBoundary =
        Math.min(distToSubStartMs, distToSubEndMs) <= BEAT_WINDOW_MS;
      const nearestSubdivisionIndex = Math.round(beats * multiplier);
      const subGuard = lastFiredBeatGuard(
        nearestSubdivisionIndex,
        lastFiredSubdivisionByClip.get(clip.id) ?? null
      );
      const isOnSubdivision = isNearSubBoundary && subGuard.shouldFire;
      if (isNearSubBoundary) {
        lastFiredSubdivisionByClip.set(clip.id, subGuard.nextLastFired);
      }

      const rc: RenderContext = {
        ctx: ctx!,
        width: w,
        height: h,
        time,
        beatPhase: phase.phase,
        beatIndex: phase.beatIndex,
        isOnBeat: shouldFire,
        trigger: clip.trigger ?? plugin.defaultTrigger,
        subdividedBeatPhase,
        subdivision,
        subdivisionIndex,
        isOnSubdivision,
        clipId: clip.id,
        clipStartSec,
        clipDurationSec,
        flowMode,
        imageBitmap,
        imageBitmapKey: firstImageBitmapKey
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
      // Per-Clip Flow Mode: when an FX exposes `beatSync` (Plan 8g) and
      // the user has toggled it OFF, this ONE clip's automation gets
      // the Flow-Mode treatment — curve stretched over `clip.lengthBeats`,
      // evaluation clip-relative. Effect: user can author dramatic
      // multi-point curves in the editor (which uses clip-relative beats
      // on its X-axis) and they Just Work for that FX, without affecting
      // the rest of the timeline.
      //
      // Plan 9c: `beatSync` is now `kind: 'toggle'` (boolean). Pre-v7
      // snapshots are migrated number→boolean by `migrateV6toV7` so
      // typeof here is always `boolean` for any FX that declares
      // `beatSync` in its schema. The strict `=== false` keeps undefined
      // out of per-clip-flow (FX without a beatSync param).
      const rawBeatSync = rawParams.beatSync;
      const perClipFlow = rawBeatSync === false;
      const automationFlow = flowMode || perClipFlow;
      const paramBeat = automationFlow ? beats - clip.startBeat : beats;
      try {
        plugin.render(
          rc,
          resolveClipParams(
            rawParams,
            paramBeat,
            clip.lengthBeats,
            automationFlow
          )
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

    // Plan 5.9d — per-frame audio volume ramp. Walk every active
    // audio clip and push the resolved volume to the engine via
    // `rampClipVolume`. The engine anchors with setValueAtTime before
    // the linear ramp (Web Audio footgun — without anchor, the ramp
    // starts from t=0 = silence on the first call). Sample-accurate,
    // no zipper noise at 60 fps update rate.
    //
    // FlowMode is intentionally forced FALSE for audio: Flow Mode is
    // a FX-driven concept (stretches a curve over clip duration so
    // beat-triggers feel continuous). Audio volume is authored in
    // absolute timeline beats; stretching it would surprise the user
    // who placed a fade-in over the first 4 beats and instead heard
    // it stretched across the whole clip length. For static volume
    // the flowMode argument is irrelevant (resolveParam short-circuits)
    // — but forcing false here makes the semantics explicit for the
    // automation-curve path too.
    if (deps.rampClipVolume && deps.getAudioContextTime) {
      const FRAME_DURATION = 1 / 60;
      const target = deps.getAudioContextTime() + FRAME_DURATION;
      for (const clip of timeline.clips) {
        if (clip.kind !== 'audio') continue;
        if (beats < clip.startBeat) continue;
        if (beats >= clip.startBeat + clip.lengthBeats) continue;
        const rawVolume =
          (clip.params as { volume?: StaticOrAuto<number> } | undefined)?.volume ?? 1.0;
        const resolved = resolveParam(
          rawVolume,
          beats,
          clip.lengthBeats,
          false
        );
        deps.rampClipVolume(clip.id, resolved, target);
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
      // Plan 8f.1 — record live-preview frame timing for the WebGL
      // quality auto-scaler. setOffline(true) makes this a no-op during
      // offline export, so no double-counting.
      qualityManager.recordFrame(performance.now());
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
