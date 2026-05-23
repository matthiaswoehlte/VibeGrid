import { createRenderer } from './loop';
import type { TimelineState } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';

export interface OfflineRendererDeps {
  /** The render target. For the v0.1 offline pipeline this is an
   *  `OffscreenCanvas(1920, 1080)` allocated by the orchestrator; tests
   *  may pass a regular `HTMLCanvasElement` with a mocked 2D context. */
  canvas: HTMLCanvasElement | OffscreenCanvas;
  beatGrid: BeatGrid;
  timeline: TimelineState;
  getImageBitmap: (mediaId: string) => ImageBitmap | undefined;
  flowMode: boolean;
  /** Plan-5.9b — per-mediaId HTMLVideoElement source for video tracks.
   *  Returns null when the video isn't loaded yet; renderer skips the
   *  draw for that frame. Pass-through to RendererDeps.getVideoElement.
   *  Legacy fallback when the orchestrator doesn't pass a VideoFrame map. */
  getVideoElement?: (mediaId: string) => HTMLVideoElement | null;
}

export interface OfflineRenderer {
  /** Renders one frame at the given playback time. Synchronous — runs the
   *  same `tick()` machinery the live renderer uses, just with `time` bound
   *  to whatever the orchestrator passes.
   *
   *  Plan 5.10+: optional `videoFrames` map (mediaId → decoded VideoFrame
   *  from the VideoDecoderPool). When provided, the renderer prefers
   *  these over the HTMLVideoElement source for video clips. The frames
   *  are pool-owned — drawn into the canvas synchronously, NOT closed
   *  by the renderer. */
  renderAt(timeSec: number, videoFrames?: Map<string, VideoFrame>): void;
}

/**
 * Plan-6-R Task 5: wraps `createRenderer()` with an explicit time source
 * the offline orchestrator can sweep across all output frames. The
 * underlying renderer is built ONCE and reused across every frame — the
 * plugin dispatch loop, alpha computation, and FX dispatching all stay
 * shared with the live preview path.
 *
 * `currentTime` is a closure variable updated per `renderAt()` call;
 * the renderer's `getCurrentTime` closure reads it via reference, so
 * we never have to mutate `deps` or rebuild the renderer.
 */
export function makeOfflineRenderer(deps: OfflineRendererDeps): OfflineRenderer {
  let currentTime = 0;
  let currentVideoFrames: Map<string, VideoFrame> | undefined;
  const renderer = createRenderer({
    // The renderer types canvas as HTMLCanvasElement; OffscreenCanvas has
    // the same .width/.height/.getContext('2d') surface we need, so the
    // cast is safe in practice.
    canvas: deps.canvas as HTMLCanvasElement,
    getCurrentTime: () => currentTime,
    getBeatGrid: () => deps.beatGrid,
    getTimelineState: () => deps.timeline,
    getImageBitmap: deps.getImageBitmap,
    getVideoElement: deps.getVideoElement,
    // Plan 5.10+ — preferred over getVideoElement when set. Pulls
    // decoded VideoFrames from the per-frame map prepared by the
    // offline orchestrator (VideoDecoderPool path).
    getVideoFrame: (mediaId: string) => currentVideoFrames?.get(mediaId) ?? null,
    getFlowMode: () => deps.flowMode
  });

  return {
    renderAt(timeSec: number, videoFrames?: Map<string, VideoFrame>): void {
      currentTime = timeSec;
      currentVideoFrames = videoFrames;
      renderer.tick();
    }
  };
}
