import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createImageBitmapCache } from '@/lib/renderer/image-cache';

describe('imageBitmapCache', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

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
