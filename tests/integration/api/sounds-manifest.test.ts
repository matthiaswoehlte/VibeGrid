import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the server-only env BEFORE importing the route handler.
vi.mock('@/lib/storage/env', () => ({
  getR2Config: () => ({
    accountId: 'a',
    accessKeyId: 'b',
    secretAccessKey: 'c',
    bucket: 'd',
    endpoint: 'e',
    publicUrl: 'https://r2.example'
  })
}));

import { GET } from '@/app/api/sounds/manifest/route';
import type { SoundManifest } from '@/lib/sounds/types';

const RAW: SoundManifest = {
  version: 7,
  updatedAt: '2026-05-28T00:00:00Z',
  categories: [
    {
      id: 'braams',
      label: 'Braams',
      sounds: [
        {
          id: 'heavy-01',
          label: 'Heavy Braam',
          url: 'sfx/braams/heavy-01.mp3',
          duration: 2.4
        }
      ]
    }
  ]
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/sounds/manifest', () => {
  it('patches every relative sound.url to an absolute R2 URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => RAW
      })
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as SoundManifest;
    expect(body.categories[0].sounds[0].url).toBe(
      'https://r2.example/library/sfx/braams/heavy-01.mp3'
    );
    expect(body.version).toBe(7);
  });

  it('preserves category metadata + manifest version through the rewrite', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => RAW })
    );
    const res = await GET();
    const body = (await res.json()) as SoundManifest;
    expect(body.updatedAt).toBe(RAW.updatedAt);
    expect(body.categories[0].id).toBe('braams');
    expect(body.categories[0].label).toBe('Braams');
  });

  it('returns 502 when R2 manifest fetch is not OK', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    );
    const res = await GET();
    expect(res.status).toBe(502);
  });

  it('returns 502 when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const res = await GET();
    expect(res.status).toBe(502);
  });
});
