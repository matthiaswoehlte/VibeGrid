import { isClient } from '@/lib/utils/is-client';
import { beatPhase } from '@/lib/audio/grid';
import { lastFiredBeatGuard } from '@/lib/audio/clip-utils';
import { activeImageClip, activeFxClipsByKind } from '@/lib/timeline/selectors';
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
  rafCallback?: (cb: FrameRequestCallback) => number;
  cancelRafCallback?: (id: number) => void;
}

export interface Renderer {
  start(): void;
  stop(): void;
  /** Run one frame synchronously — used by tests. */
  tick(): void;
}

const RENDER_ORDER: FxKind[] = ['Contour', 'Sweep', 'Particle', 'Pulse'];

/**
 * Map FX plugin `kind` (PascalCase) to the corresponding key in `activeFxClipsByKind`'s
 * Record (lowercase, sometimes pluralized). Cannot rely on `kind.toLowerCase()` —
 * 'Particle'.toLowerCase() === 'particle' but the timeline slice key is 'particles'.
 */
const KIND_TO_TRACK_KIND: Record<FxKind, TrackFxKind> = {
  Contour: 'contour',
  Pulse: 'pulse',
  Sweep: 'sweep',
  Particle: 'particles'
};

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
    const time = deps.getCurrentTime();
    const grid = deps.getBeatGrid();
    const beats = ((time - grid.offsetMs / 1000) * grid.bpm) / 60;
    const w = deps.canvas.width || 800;
    const h = deps.canvas.height || 450;

    ctx!.clearRect(0, 0, w, h);

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

    const timeline = deps.getTimelineState();
    const imageClip = activeImageClip(timeline, beats);
    const imageBitmap = imageClip?.mediaId ? deps.getImageBitmap(imageClip.mediaId) : undefined;

    if (imageClip && imageBitmap) {
      ctx!.drawImage(imageBitmap, 0, 0, w, h);
    }

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

        if (plugin.kind !== 'Pulse' && !imageBitmap) continue;

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
          imageBitmap
        };

        plugin.render(rc, clip.params ?? plugin.getDefaultParams());
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
