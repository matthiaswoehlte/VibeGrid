import { isClient } from '@/lib/utils/is-client';

/**
 * Module-level cache of fetched video MP4 bytes, keyed by URL.
 *
 * Solves the doubled-download problem: pre-bytes-cache, the live
 * preview's `<video src=url>` and the offline export's
 * `VideoDecoderPool.load(url)` each ran their own independent fetch
 * (R2's `Cache-Control: no-cache` forces revalidation but R2 answers
 * with 200, not 304, so the browser re-downloads the body even with
 * a populated HTTP cache). Net effect: every Export click incurred
 * a second full download of every video on the timeline.
 *
 * With this cache + blob URLs:
 *  - VideoEngine.load fetches via the cache (streaming, with progress
 *    callback), creates a blob URL from the bytes, sets that as
 *    `<video src>`. Browser plays from in-memory bytes — no further
 *    network access.
 *  - VideoDecoderPool.load also fetches via the cache. At Export
 *    click the cache is already populated (VideoEngine fired the
 *    fetch at page load), so `fetch` returns immediately with the
 *    cached ArrayBuffer.
 *
 * Memory cost: each fetched video's bytes stay resident for the
 * page's lifetime. ~50-200 MB per typical music-video clip; not
 * prohibitive for desktop. v0.2 / mobile candidate for LRU eviction.
 *
 * Concurrent dedup: two callers hitting `fetch(url)` simultaneously
 * receive the same Promise. Onprogress is wired through only for the
 * first caller (callers arriving while the fetch is in flight see a
 * single 100% notification on resolve).
 */

export type ProgressCallback = (received: number, total: number) => void;

export interface VideoBytesCache {
  /**
   * Fetch the bytes for `url`. Subsequent calls with the same URL
   * return the cached ArrayBuffer immediately (and fire `onProgress`
   * once with 100%). Concurrent in-flight calls share one Promise.
   * `signal` aborts only the first caller's fetch; if other callers
   * are waiting on the same in-flight promise, they will receive the
   * AbortError too.
   */
  fetch(
    url: string,
    onProgress?: ProgressCallback,
    signal?: AbortSignal
  ): Promise<ArrayBuffer>;
  /** Returns cached bytes for `url`, or null if not yet fetched. */
  get(url: string): ArrayBuffer | null;
  /** Total cache size in bytes (sum over all entries). */
  bytesUsed(): number;
  /** Drop all entries. Does NOT invalidate blob URLs created from
   *  cached bytes — those are owned by their consumers. */
  clear(): void;
}

function createCache(): VideoBytesCache {
  const cache = new Map<string, ArrayBuffer>();
  const inflight = new Map<string, Promise<ArrayBuffer>>();

  async function streamFetch(
    url: string,
    onProgress: ProgressCallback | undefined,
    signal: AbortSignal | undefined
  ): Promise<ArrayBuffer> {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(
        `VideoBytesCache: fetch failed (${response.status} ${response.statusText})`
      );
    }
    const total = Number(response.headers.get('content-length')) || 0;
    if (!response.body) {
      // Older environment without streams; fall back to full read.
      const buf = await response.arrayBuffer();
      onProgress?.(buf.byteLength, buf.byteLength);
      return buf;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        onProgress?.(received, total || received);
      }
    }
    // Concatenate chunks into one ArrayBuffer. Single allocation
    // avoids the GC pressure of many small Uint8Arrays surviving
    // after the read loop completes.
    const buffer = new ArrayBuffer(received);
    const view = new Uint8Array(buffer);
    let offset = 0;
    for (const chunk of chunks) {
      view.set(chunk, offset);
      offset += chunk.length;
    }
    // Final progress notification — handles servers that don't send
    // Content-Length (total tracks `received` in that case, only
    // settling to the true total at the end).
    onProgress?.(received, received);
    return buffer;
  }

  return {
    fetch(url, onProgress, signal) {
      const cached = cache.get(url);
      if (cached) {
        onProgress?.(cached.byteLength, cached.byteLength);
        return Promise.resolve(cached);
      }
      const existing = inflight.get(url);
      if (existing) {
        // Caller arrived after fetch started — they don't get
        // chunk-by-chunk progress, just the final result. (Onprogress
        // hookup for additional listeners is possible but complicates
        // the API; the first caller is typically VideoEngine and
        // that's where progress UI hangs off.)
        if (onProgress) {
          existing.then((buf) => onProgress(buf.byteLength, buf.byteLength)).catch(() => {});
        }
        return existing;
      }
      const promise = streamFetch(url, onProgress, signal).then(
        (buffer) => {
          cache.set(url, buffer);
          inflight.delete(url);
          return buffer;
        },
        (err: unknown) => {
          inflight.delete(url);
          throw err;
        }
      );
      inflight.set(url, promise);
      return promise;
    },
    get(url) {
      return cache.get(url) ?? null;
    },
    bytesUsed() {
      let total = 0;
      for (const b of cache.values()) total += b.byteLength;
      return total;
    },
    clear() {
      cache.clear();
      inflight.clear();
    }
  };
}

// Module-level singleton. Survives HMR within a session because the
// module is hot-reloaded only when its source changes — and the cache
// content is keyed on URL, so a re-evaluated module starts empty
// (and re-fetches on first call). For tests, callers should consume
// `createCache()` directly via dependency injection if isolation
// matters; the singleton below is for production code.
export const videoBytesCache: VideoBytesCache = isClient()
  ? createCache()
  : ({
      fetch: () => Promise.reject(new Error('VideoBytesCache: client only')),
      get: () => null,
      bytesUsed: () => 0,
      clear: () => {}
    } as VideoBytesCache);

/** Test-only — fresh cache instance, no globals. */
export function _createVideoBytesCacheForTests(): VideoBytesCache {
  return createCache();
}
