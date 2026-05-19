// TODO v0.2: add LRU eviction (cap: 8 bitmaps).
// v0.1 ships an unbounded cache — typical session loads 3-5 images,
// so unbounded growth is acceptable. Multi-image sessions in v0.2 need a cap.

export interface ImageBitmapCache {
  get(mediaId: string): ImageBitmap | undefined;
  load(mediaId: string, url: string): Promise<ImageBitmap>;
  evict(mediaId: string): void;
  clear(): void;
}

export function createImageBitmapCache(): ImageBitmapCache {
  const cache = new Map<string, ImageBitmap>();
  const inflight = new Map<string, Promise<ImageBitmap>>();

  return {
    get(mediaId) {
      return cache.get(mediaId);
    },
    async load(mediaId, url) {
      const cached = cache.get(mediaId);
      if (cached) return cached;
      const existing = inflight.get(mediaId);
      if (existing) return existing;
      const promise = (async () => {
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          const bitmap = await createImageBitmap(blob);
          cache.set(mediaId, bitmap);
          return bitmap;
        } finally {
          inflight.delete(mediaId);
        }
      })();
      inflight.set(mediaId, promise);
      return promise;
    },
    evict(mediaId) {
      const bitmap = cache.get(mediaId);
      if (bitmap) {
        bitmap.close();
        cache.delete(mediaId);
      }
    },
    clear() {
      for (const bitmap of cache.values()) bitmap.close();
      cache.clear();
    }
  };
}
