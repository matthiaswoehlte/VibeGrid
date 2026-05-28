import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadSoundManifest,
  _resetSoundManifestCacheForTests,
  _SOUND_MANIFEST_CACHE_KEY
} from '@/lib/sounds/manifest-loader';
import type { SoundManifest } from '@/lib/sounds/types';

const SAMPLE_V1: SoundManifest = {
  version: 1,
  updatedAt: '2026-05-28T00:00:00.000Z',
  categories: [
    {
      id: 'braams',
      label: 'Braams',
      sounds: [
        {
          id: 'braam-01',
          label: 'Heavy Braam',
          url: 'https://r2.example/library/sfx/braams/braam-01.mp3',
          duration: 2.4
        }
      ]
    }
  ]
};

const SAMPLE_V2: SoundManifest = { ...SAMPLE_V1, version: 2 };

function mockFetchJson(value: SoundManifest, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => value
    })
  );
}

function mockFetchReject(error = new Error('network')): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
}

describe('loadSoundManifest', () => {
  beforeEach(() => {
    _resetSoundManifestCacheForTests();
    vi.unstubAllGlobals();
  });

  it('fetches and returns the manifest on success + caches it in localStorage', async () => {
    mockFetchJson(SAMPLE_V1);
    const result = await loadSoundManifest();
    expect(result).toEqual(SAMPLE_V1);
    const raw = localStorage.getItem(_SOUND_MANIFEST_CACHE_KEY);
    expect(raw).not.toBeNull();
    const cached = JSON.parse(raw!) as { version: number; data: SoundManifest };
    expect(cached.version).toBe(1);
    expect(cached.data).toEqual(SAMPLE_V1);
  });

  it('on cache hit + matching version → does not re-write localStorage', async () => {
    // Seed cache with V1.
    localStorage.setItem(
      _SOUND_MANIFEST_CACHE_KEY,
      JSON.stringify({ version: 1, data: SAMPLE_V1 })
    );
    const setSpy = vi.spyOn(Storage.prototype, 'setItem');
    mockFetchJson(SAMPLE_V1);
    const result = await loadSoundManifest();
    expect(result).toEqual(SAMPLE_V1);
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it('on cache hit + bumped version → overwrites localStorage', async () => {
    localStorage.setItem(
      _SOUND_MANIFEST_CACHE_KEY,
      JSON.stringify({ version: 1, data: SAMPLE_V1 })
    );
    mockFetchJson(SAMPLE_V2);
    const result = await loadSoundManifest();
    expect(result).toEqual(SAMPLE_V2);
    const cached = JSON.parse(
      localStorage.getItem(_SOUND_MANIFEST_CACHE_KEY)!
    ) as { version: number };
    expect(cached.version).toBe(2);
  });

  it('on BFF fail with cache available → returns cached', async () => {
    localStorage.setItem(
      _SOUND_MANIFEST_CACHE_KEY,
      JSON.stringify({ version: 1, data: SAMPLE_V1 })
    );
    mockFetchJson(SAMPLE_V1, 502);
    const result = await loadSoundManifest();
    expect(result).toEqual(SAMPLE_V1);
  });

  it('on BFF fail without cache → returns null', async () => {
    mockFetchJson(SAMPLE_V1, 502);
    const result = await loadSoundManifest();
    expect(result).toBeNull();
  });

  it('on network throw + cache available → returns cached', async () => {
    localStorage.setItem(
      _SOUND_MANIFEST_CACHE_KEY,
      JSON.stringify({ version: 1, data: SAMPLE_V1 })
    );
    mockFetchReject();
    const result = await loadSoundManifest();
    expect(result).toEqual(SAMPLE_V1);
  });

  it('corrupted cache JSON → treated as cache-miss, no throw', async () => {
    localStorage.setItem(_SOUND_MANIFEST_CACHE_KEY, '{not valid json');
    mockFetchJson(SAMPLE_V1);
    const result = await loadSoundManifest();
    expect(result).toEqual(SAMPLE_V1);
  });
});
