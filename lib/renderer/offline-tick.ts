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
   *  draw for that frame. Pass-through to RendererDeps.getVideoElement. */
  getVideoElement?: (mediaId: string) => HTMLVideoElement | null;
}

export interface OfflineRenderer {
  /** Renders one frame at the given playback time. Synchronous — runs the
   *  same `tick()` machinery the live renderer uses, just with `time` bound
   *  to whatever the orchestrator passes. */
  renderAt(timeSec: number): void;
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
    getFlowMode: () => deps.flowMode
  });

  return {
    renderAt(timeSec: number): void {
      currentTime = timeSec;
      renderer.tick();
    }
  };
}
