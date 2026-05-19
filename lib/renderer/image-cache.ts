// TODO v0.2: add LRU eviction (cap: 8 bitmaps).
// v0.1 ships an unbounded cache — typical session loads 3-5 images,
// so unbounded growth is acceptable. Multi-image sessions in v0.2 need a cap.

export interface ImageBitmapCache {
  get(mediaId: string): ImageBitmap | undefined;
  load(mediaId: string, url: string): Promise<ImageBitmap>;
  evict(mediaId: string): void;
  clear(): void;
}

interface InflightEntry {
  promise: Promise<ImageBitmap>;
  cancelled: boolean;
}

export function createImageBitmapCache(): ImageBitmapCache {
  const cache = new Map<string, ImageBitmap>();
  const inflight = new Map<string, InflightEntry>();

  function evictById(mediaId: string): void {
    const bitmap = cache.get(mediaId);
    if (bitmap) {
      bitmap.close();
      cache.delete(mediaId);
    }
    const entry = inflight.get(mediaId);
    if (entry) {
      entry.cancelled = true;
      // The load() chain checks `cancelled` after createImageBitmap resolves
      // and closes the bitmap there. We do NOT delete `inflight` here — the
      // load() finally clause handles that.
    }
  }

  return {
    get(mediaId) {
      return cache.get(mediaId);
    },
    async load(mediaId, url) {
      const cached = cache.get(mediaId);
      if (cached) return cached;
      const existing = inflight.get(mediaId);
      if (existing) return existing.promise;

      const entry: InflightEntry = { promise: undefined as unknown as Promise<ImageBitmap>, cancelled: false };
      entry.promise = (async () => {
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          const bitmap = await createImageBitmap(blob);
          if (entry.cancelled) {
            bitmap.close();
            throw new Error(`Load of ${mediaId} cancelled by evict`);
          }
          cache.set(mediaId, bitmap);
          return bitmap;
        } finally {
          inflight.delete(mediaId);
        }
      })();
      inflight.set(mediaId, entry);
      return entry.promise;
    },
    evict: evictById,
    clear() {
      for (const bitmap of cache.values()) bitmap.close();
      cache.clear();
      // Mark inflight loads cancelled AND remove them from the map. Without
      // the inflight.clear(), a subsequent load() for the same mediaId would
      // re-use the cancelled promise (which rejects with "cancelled by evict")
      // — visible in React Strict Mode where useEffect double-mounts:
      // mount → clear() → mount → load() returns the dead promise.
      for (const entry of inflight.values()) entry.cancelled = true;
      inflight.clear();
    }
  };
}
