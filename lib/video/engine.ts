import { isClient } from '@/lib/utils/is-client';
import { videoBytesCache, type ProgressCallback } from './bytes-cache';

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
  /** `onProgress` is invoked while the bytes-cache streams the MP4 in.
   *  It fires once with `received === total` when the bytes are already
   *  cached (re-load, second call). */
  load(mediaId: string, url: string, onProgress?: ProgressCallback): Promise<void>;
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
    // OFFLINE EXPORT path (live preview never calls seekElement — it just
    // plays the video). Three-layered wait so drawImage / new VideoFrame
    // reads the actually-decoded frame at the new currentTime:
    //
    // 1. rVFC: paint-accurate, fires AFTER a new frame is composited.
    //    Fastest path on Chrome — but requires the compositor to paint
    //    the element. The export pool's DOM-attach CSS (1×1 px, no
    //    opacity hack) makes that reliable on modern Chromium.
    // 2. `seeked` event + `readyState ≥ 2` poll: fallback for browsers
    //    where rVFC doesn't fire (Firefox/Safari) or when the
    //    compositor still skips (older fix had opacity:0.001 → modern
    //    Chrome silently dropped paint scheduling → seeked+rAF
    //    resolved at readyState=1 with no decoded frame → drawImage
    //    read stale frame 0 → the "videos frozen on first frame in
    //    MP4" smoke bug). Now we explicitly poll until the decoder
    //    delivers HAVE_CURRENT_DATA.
    // 3. Hard timeout (500 ms): never hang the export. If the decoder
    //    really can't deliver, we let drawImage read whatever it can
    //    (probably stale) and move on — at least the export finishes.
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (): void => {
      if (done) return;
      done = true;
      if (pollTimer !== null) clearTimeout(pollTimer);
      el.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const POLL_INTERVAL_MS = 10;
    const POLL_TIMEOUT_MS = 500;
    let pollStart = 0;
    const pollDecoder = (): void => {
      if (done) return;
      // HAVE_CURRENT_DATA (2) = the frame at currentTime is decoded
      // and readable. drawImage / new VideoFrame work at this point.
      // Below 2 we'd race the decoder.
      if (el.readyState >= 2) {
        finish();
        return;
      }
      if (
        typeof performance !== 'undefined'
          ? performance.now() - pollStart > POLL_TIMEOUT_MS
          : Date.now() - pollStart > POLL_TIMEOUT_MS
      ) {
        // Decoder gave up; resolve anyway so the export finishes.
        finish();
        return;
      }
      pollTimer = setTimeout(pollDecoder, POLL_INTERVAL_MS);
    };
    const onSeeked = (): void => {
      pollStart =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      pollDecoder();
    };
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
  // blob:-URLs minted from cached bytes — kept so we can revoke them on
  // unload (a leaked blob URL pins the entire MP4 in memory).
  const blobUrls = new Map<string, string>();

  return {
    async load(mediaId, url, onProgress) {
      if (elements.has(mediaId)) {
        // Already loaded — caller expects a final progress notification
        // so the UI can clear any in-flight bar.
        onProgress?.(1, 1);
        return;
      }
      // Stream bytes through the shared cache (deduped with the offline
      // decoder pool's fetch). Then point the <video> at a blob URL so
      // the browser plays from in-memory bytes — no second network hit.
      const buffer = await videoBytesCache.fetch(url, onProgress);
      const blobUrl = URL.createObjectURL(new Blob([buffer], { type: 'video/mp4' }));
      const el = document.createElement('video');
      el.crossOrigin = 'anonymous'; // harmless on blob: but kept for parity
      el.preload = 'auto';
      el.muted = true;
      el.playsInline = true;
      el.src = blobUrl;
      try {
        await new Promise<void>((resolve, reject) => {
          el.onloadeddata = () => resolve();
          el.onerror = () => {
            const err = el.error;
            const detail = err
              ? `code=${err.code} (${err.message || 'no message'})`
              : 'no MediaError';
            reject(new Error(`Video load failed: ${url} — ${detail}`));
          };
          el.load();
        });
      } catch (err) {
        URL.revokeObjectURL(blobUrl);
        throw err;
      }
      // Guard against a double-load race — only the first inflight wins.
      if (!elements.has(mediaId)) {
        elements.set(mediaId, el);
        blobUrls.set(mediaId, blobUrl);
      } else {
        URL.revokeObjectURL(blobUrl);
      }
    },

    unload(mediaId) {
      const el = elements.get(mediaId);
      if (!el) return;
      el.pause();
      el.src = '';
      const blobUrl = blobUrls.get(mediaId);
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrls.delete(mediaId);
      }
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
      blobUrls.forEach((u) => URL.revokeObjectURL(u));
      blobUrls.clear();
    }
  };
}
