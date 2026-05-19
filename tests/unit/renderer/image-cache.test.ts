import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createImageBitmapCache } from '@/lib/renderer/image-cache';

describe('imageBitmapCache', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      blob: async () => new Blob(['fake'])
    } as Response);
  });

  it('load+get caches a bitmap by mediaId', async () => {
    const cache = createImageBitmapCache();
    expect(cache.get('m1')).toBeUndefined();
    await cache.load('m1', 'http://example.com/img.png');
    expect(cache.get('m1')).toBeDefined();
  });

  it('coalesces concurrent loads for the same mediaId', async () => {
    const cache = createImageBitmapCache();
    const [a, b] = await Promise.all([
      cache.load('m1', 'http://example.com/img.png'),
      cache.load('m1', 'http://example.com/img.png')
    ]);
    expect(a).toBe(b);
    expect(fetchSpy.mock.calls.length).toBe(1);
  });

  it('evict removes the cached bitmap and calls close()', async () => {
    const cache = createImageBitmapCache();
    await cache.load('m1', 'http://example.com/img.png');
    const bitmap = cache.get('m1');
    cache.evict('m1');
    expect(cache.get('m1')).toBeUndefined();
    expect((bitmap as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalled();
  });

  it('clear evicts everything', async () => {
    const cache = createImageBitmapCache();
    await cache.load('m1', 'http://example.com/img.png');
    await cache.load('m2', 'http://example.com/img2.png');
    cache.clear();
    expect(cache.get('m1')).toBeUndefined();
    expect(cache.get('m2')).toBeUndefined();
  });
});

describe('imageBitmapCache — evict-race guard', () => {
  it('closes bitmap and skips cache if evict fires before load resolves', async () => {
    const cache = createImageBitmapCache();
    let resolveFetch: () => void = () => undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((res) => {
          resolveFetch = () =>
            res({
              blob: async () => new Blob(['fake'])
            } as Response);
        })
    );
    const bitmapClose = vi.fn();
    vi.spyOn(globalThis, 'createImageBitmap').mockResolvedValue({
      width: 1,
      height: 1,
      close: bitmapClose
    } as unknown as ImageBitmap);

    const loadPromise = cache.load('m1', 'https://x/a.jpg');
    cache.evict('m1'); // race: evict before fetch resolves
    resolveFetch();
    await loadPromise.catch(() => undefined);
    expect(bitmapClose).toHaveBeenCalledTimes(1);
    expect(cache.get('m1')).toBeUndefined();
  });

  it('evict on non-existent id is a safe no-op', () => {
    const cache = createImageBitmapCache();
    expect(() => cache.evict('never-loaded')).not.toThrow();
  });
});
