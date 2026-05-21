import { isClient } from '@/lib/utils/is-client';

/**
 * Plan 5.9b — `HTMLVideoElement` pool with lazy load + seek-frame helpers.
 *
 * Owns one `<video>` element per video MediaRef id. Seeks prefer
 * `requestVideoFrameCallback` when the browser implements it (Chrome /
 * Edge / Firefox 130+) — that callback fires exactly when the requested
 * frame is painted (10-30 ms vs the `seeked`-event 50-100 ms fallback).
 *
 * All elements are `muted: true` so audio NEVER comes from the video
 * track itself — the AudioEngine is the single source of truth for
 * playback audio. Eliminates the "two audio clocks drifting" problem.
 *
 * SSR-safe: factory returns `null` when `window` is unavailable.
 */
export interface VideoEngine {
  load(mediaId: string, url: string): Promise<void>;
  unload(mediaId: string): void;
  /** Seeks one element. Resolves once the new frame is painted. */
  seekTo(mediaId: string, timeSec: number): Promise<void>;
  /** Seeks every loaded element. Resolves when all are painted. */
  seekAllTo(timeSec: number): Promise<void>;
  play(): void;
  pause(): void;
  getElement(mediaId: string): HTMLVideoElement | null;
  /** Loaded mediaIds — useful for the lazy-load reconciler in
   *  `useVideoEngine`. */
  loadedIds(): string[];
  destroy(): void;
}

/** Skip seeks where the element is already on the requested frame. The
 *  threshold matches a typical browser's seek tolerance — anything below
 *  10 ms is single-frame precision territory and the seek wouldn't do
 *  anything visible. */
const SEEK_EPS = 0.01;

type VideoElementWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

function seekElement(el: HTMLVideoElement, timeSec: number): Promise<void> {
  if (Math.abs(el.currentTime - timeSec) < SEEK_EPS) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const elAny = el as VideoElementWithFrameCallback;
    // `seeked` always fires after the seek operation completes, but BEFORE
    // the new frame is composited — using it alone makes `drawImage` pick
    // up the previous frame ("stuck on first frame" symptom in the offline
    // export). Defer one rAF tick (or 16 ms fallback) so the decoder has
    // time to deliver the frame before drawImage reads from the element.
    const onSeeked = (): void => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => finish());
      } else {
        setTimeout(finish, 16);
      }
    };
    const finish = (): void => {
      if (done) return;
      done = true;
      el.removeEventListener('seeked', onSeeked);
      resolve();
    };
    // rVFC: paint-accurate, fires AFTER the new frame is composited.
    // For offline export the orchestrator attaches the element to the
    // DOM (off-screen but visible to the compositor) so rVFC fires —
    // see `lib/export/offline-render.ts`. The `seeked` listener is
    // kept as a defensive fallback for both detached usage and
    // Firefox/Safari without rVFC.
    if (typeof elAny.requestVideoFrameCallback === 'function') {
      elAny.requestVideoFrameCallback(() => finish());
    }
    el.addEventListener('seeked', onSeeked, { once: true });
    el.currentTime = timeSec;
  });
}

export function createVideoEngine(): VideoEngine | null {
  if (!isClient()) return null;

  const elements = new Map<string, HTMLVideoElement>();

  return {
    async load(mediaId, url) {
      if (elements.has(mediaId)) return;
      const el = document.createElement('video');
      // `crossOrigin` MUST be set before `src` — the browser starts the
      // fetch the instant `src` is assigned, and the `Origin` header is
      // only added when crossOrigin is already configured. Setting it
      // afterwards yields a no-cors opaque response that taints any
      // OffscreenCanvas the frame is drawn into, which silently breaks
      // the WebCodecs `new VideoFrame(canvas)` step in the offline
      // export (live preview is unaffected because HTMLCanvasElement
      // only enforces taint on pixel-read operations).
      el.crossOrigin = 'anonymous'; // R2 GET must allow this Origin
      el.preload = 'auto';
      el.muted = true;
      el.playsInline = true;
      el.src = url;
      await new Promise<void>((resolve, reject) => {
        el.onloadeddata = () => resolve();
        el.onerror = () => {
          // Surface the MediaError detail so a failed load shows up with
          // an actionable message in the console (code 4 typically means
          // CORS or unsupported codec).
          const err = el.error;
          const detail = err
            ? `code=${err.code} (${err.message || 'no message'})`
            : 'no MediaError';
          reject(new Error(`Video load failed: ${url} — ${detail}`));
        };
        el.load();
      });
      // Guard against a double-load race — only the first inflight wins.
      if (!elements.has(mediaId)) elements.set(mediaId, el);
    },

    unload(mediaId) {
      const el = elements.get(mediaId);
      if (!el) return;
      el.pause();
      el.src = '';
      elements.delete(mediaId);
    },

    async seekTo(mediaId, timeSec) {
      const el = elements.get(mediaId);
      if (el) await seekElement(el, timeSec);
    },

    async seekAllTo(timeSec) {
      await Promise.all(
        [...elements.values()].map((el) => seekElement(el, timeSec))
      );
    },

    play() {
      elements.forEach((el) => {
        // Autoplay can be blocked on first user-gesture-less attempt; the
        // preview is silent and the user can just hit play again. We
        // swallow rather than throw so a failing video doesn't tear down
        // the rest of the engine.
        el.play().catch(() => { /* autoplay-blocked is OK */ });
      });
    },

    pause() {
      elements.forEach((el) => el.pause());
    },

    getElement(mediaId) {
      return elements.get(mediaId) ?? null;
    },

    loadedIds() {
      return [...elements.keys()];
    },

    destroy() {
      elements.forEach((el) => {
        el.pause();
        el.src = '';
      });
      elements.clear();
    }
  };
}
