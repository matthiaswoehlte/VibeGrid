import { isClient } from '@/lib/utils/is-client';
import { beatPhase } from '@/lib/audio/grid';
import { lastFiredBeatGuard } from '@/lib/audio/clip-utils';
import { activeImageClip, activeImageClips, activeFxClipsByKind } from '@/lib/timeline/selectors';
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

// Image transforms apply BEFORE overlay FX. Order: Contour (edge detection) →
// ZoomPulse (image scale punch) → Sweep → Particle → Pulse (flash overlay).
const RENDER_ORDER: FxKind[] = ['Contour', 'ZoomPulse', 'Sweep', 'Particle', 'Pulse'];

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
  Particle: 'particles'
};

/**
 * Draw an image to the canvas with `object-fit: contain` semantics —
 * maintains aspect ratio, fits the entire image inside the canvas (may
 * leave letterbox bars when aspect ratios differ). Without this, a 4000-
 * wide source would be drawn at its native size and clip everything.
 */
function drawImageContain(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  w: number,
  h: number
): void {
  const scale = Math.min(w / bitmap.width, h / bitmap.height);
  const sw = bitmap.width * scale;
  const sh = bitmap.height * scale;
  const sx = (w - sw) / 2;
  const sy = (h - sh) / 2;
  ctx.drawImage(bitmap, sx, sy, sw, sh);
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
  // Diagnostic: prove the hotfix bundle reached the browser. Logs ONCE per
  // flip. If you toggle the TopBar button and see nothing here, the bundle
  // is stale — hard-refresh (Ctrl+Shift+R) or restart `npm run dev`.
  let lastLoggedFlow: boolean | null = null;
  // FPS counter — buckets every frame, reports once per second. 60 fps is
  // smooth, < 50 is "I notice it stuttering," < 30 is "playhead jumps."
  let fpsFrames = 0;
  let fpsWindowStart = 0;
  // Trace: was the ZoomPulse plugin invoked at all this frame, and what did
  // it see for rc.flowMode? Logs ONCE per (clipId × flowMode) pair so we
  // don't spam.
  const tracedZoomPulse = new Set<string>();

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
    if (flowMode !== lastLoggedFlow) {
      // eslint-disable-next-line no-console
      console.log(`[renderer] flowMode = ${flowMode}`);
      lastLoggedFlow = flowMode;
      // Clear the per-flip trace set so we get a fresh ZoomPulse log per mode.
      tracedZoomPulse.clear();
    }

    // FPS counter — 1 Hz report. performance.now is monotonic across tabs.
    fpsFrames++;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (fpsWindowStart === 0) fpsWindowStart = now;
    if (now - fpsWindowStart >= 1000) {
      const fps = Math.round((fpsFrames * 1000) / (now - fpsWindowStart));
      // eslint-disable-next-line no-console
      console.log(`[renderer] fps = ${fps}`);
      fpsFrames = 0;
      fpsWindowStart = now;
    }

    const timeline = deps.getTimelineState();
    // Draw EVERY active image clip — overlapping image clips crossfade via
    // computeClipAlpha. FX that need a bitmap (Contour, ZoomPulse) still use
    // the first active clip's bitmap (`imageBitmap` below).
    const imageClipsActive = activeImageClips(timeline, beats);
    for (const ic of imageClipsActive) {
      const bitmap = ic.mediaId ? deps.getImageBitmap(ic.mediaId) : undefined;
      if (!bitmap) continue;
      const alpha = computeClipAlpha(timeline, ic, beats);
      const usesAlpha = alpha < 1;
      if (usesAlpha) {
        ctx!.save();
        ctx!.globalAlpha *= alpha;
      }
      drawImageContain(ctx!, bitmap, w, h);
      if (usesAlpha) ctx!.restore();
    }

    // FX path still needs a single bitmap reference. Use the first active.
    const imageClip = activeImageClip(timeline, beats);
    const imageBitmap = imageClip?.mediaId ? deps.getImageBitmap(imageClip.mediaId) : undefined;

    const fxByKind = activeFxClipsByKind(timeline, beats);
    const trackMuteMap = new Map(timeline.tracks.map((t) => [t.id, t.muted]));

    for (const kind of RENDER_ORDER) {
      const sliceKind = KIND_TO_TRACK_KIND[kind];
      const clips = fxByKind[sliceKind] ?? [];
      for (const clip of clips) {
        if (trackMuteMap.get(clip.trackId)) continue;

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
          flowMode,
          imageBitmap
        };

        // Trace: did a ZoomPulse plugin actually get invoked, and what did
        // it see for rc.flowMode? If we see this log with flowMode=true but
        // the zoom is still happening on screen, the plugin module itself
        // is stale (HMR didn't pick up the hotfix).
        if (plugin.kind === 'ZoomPulse') {
          const key = `${clip.id}:${flowMode}`;
          if (!tracedZoomPulse.has(key)) {
            // eslint-disable-next-line no-console
            console.log(
              `[renderer] ZoomPulse invoked for clip=${clip.id} flowMode=${flowMode}`
            );
            tracedZoomPulse.add(key);
          }
        }

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
