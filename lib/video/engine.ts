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
    const elAny = el as VideoElementWithFrameCallback;
    if (typeof elAny.requestVideoFrameCallback === 'function') {
      // Chromium + Firefox 130+: paint-accurate, finishes when the new
      // frame is actually drawn. Significantly faster than the `seeked`
      // event in real-world tests.
      elAny.requestVideoFrameCallback(() => resolve());
    } else {
      const onSeeked = () => {
        el.removeEventListener('seeked', onSeeked);
        resolve();
      };
      el.addEventListener('seeked', onSeeked, { once: true });
    }
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
      el.src = url;
      el.preload = 'auto';
      el.muted = true;
      el.playsInline = true;
      el.crossOrigin = 'anonymous'; // R2 GET must allow this Origin
      await new Promise<void>((resolve, reject) => {
        el.onloadeddata = () => resolve();
        el.onerror = () => {
          // Report what the browser actually saw — the underlying
          // MediaError code (1=ABORTED, 2=NETWORK, 3=DECODE,
          // 4=SRC_NOT_SUPPORTED) tells us if it's CORS / wrong codec /
          // bad URL. CORS failures usually surface as code 4 because
          // the response is opaque to the decoder.
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
      // eslint-disable-next-line no-console
      console.info(`[VideoEngine] play() called — ${elements.size} loaded element(s)`);
      elements.forEach((el, id) => {
        el.play()
          .then(() => {
            // eslint-disable-next-line no-console
            console.info(`[VideoEngine] play OK for ${id} — paused=${el.paused} readyState=${el.readyState}`);
          })
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.warn(`[VideoEngine] play() rejected for ${id}:`, err);
          });
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
