import { describe, it, expect, vi, beforeEach } from 'vitest';

const adminOk = vi.fn();
const adminFail = vi.fn();
const putToR2Mock = vi.fn(async (..._args: unknown[]) => undefined);
const revalidatePathMock = vi.fn();

vi.mock('@/lib/auth/admin-guard', () => ({
  requireAdminApi: (req: Request) => {
    if (req.headers.get('x-test-admin') === '0') {
      adminFail();
      return {
        response: new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { 'content-type': 'application/json' }
        })
      };
    }
    adminOk();
    return { userId: 'admin-1' };
  }
}));

vi.mock('@/lib/storage/env', () => ({
  getR2Config: () => ({
    accountId: 'a',
    accessKeyId: 'k',
    secretAccessKey: 's',
    bucket: 'b',
    endpoint: 'https://r2.example',
    publicUrl: 'https://pub.example'
  })
}));

vi.mock('@/lib/storage/r2-client', () => ({
  putToR2: (...args: unknown[]) => putToR2Mock(...args)
}));

vi.mock('next/cache', () => ({
  revalidatePath: (p: string) => revalidatePathMock(p)
}));

import { GET, PUT } from '@/app/api/admin/sounds/manifest/route';
import type { SoundManifest } from '@/lib/sounds/types';

const STORED: SoundManifest = {
  version: 5,
  updatedAt: '2026-05-28T00:00:00Z',
  categories: [
    {
      id: 'braams',
      label: 'Braams',
      sounds: [
        { id: 'heavy-01', label: 'Heavy', url: 'sfx/braams/heavy-01.mp3', duration: 2.4 }
      ]
    }
  ]
};

beforeEach(() => {
  adminOk.mockReset();
  adminFail.mockReset();
  putToR2Mock.mockReset();
  revalidatePathMock.mockReset();
  vi.unstubAllGlobals();
});

describe('GET /api/admin/sounds/manifest', () => {
  it('returns the raw R2 manifest unchanged when it exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => STORED })
    );
    const res = await GET(new Request('http://x'));
    expect(adminOk).toHaveBeenCalled();
    expect(res.status).toBe(200);
    const body = (await res.json()) as SoundManifest;
    expect(body.version).toBe(5);
    expect(body.categories[0].sounds[0].url).toBe('sfx/braams/heavy-01.mp3');
  });

  it('returns an empty skeleton (version 0) when R2 has no manifest yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    );
    const res = await GET(new Request('http://x'));
    const body = (await res.json()) as SoundManifest;
    expect(body.version).toBe(0);
    expect(body.categories).toEqual([]);
  });

  it('rejects non-admin callers with 403 (guard exercised)', async () => {
    const res = await GET(
      new Request('http://x', { headers: { 'x-test-admin': '0' } })
    );
    expect(res.status).toBe(403);
    expect(adminFail).toHaveBeenCalled();
  });
});

describe('PUT /api/admin/sounds/manifest', () => {
  it('increments version + sets updatedAt + writes to R2 + revalidates the BFF path', async () => {
    const payload: SoundManifest = { ...STORED, version: 5 };
    const before = new Date().toISOString();
    const res = await PUT(
      new Request('http://x', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: number };
    expect(body.version).toBe(6);

    expect(putToR2Mock).toHaveBeenCalledTimes(1);
    const [key, bytes, contentType, opts] = putToR2Mock.mock.calls[0] as unknown as [
      string,
      Uint8Array,
      string,
      { cacheControl?: string }
    ];
    expect(key).toBe('library/manifest.json');
    expect(contentType).toBe('application/json');
    expect(opts.cacheControl).toContain('max-age=3600');
    const written = JSON.parse(new TextDecoder().decode(bytes)) as SoundManifest;
    expect(written.version).toBe(6);
    expect(written.updatedAt >= before).toBe(true);

    expect(revalidatePathMock).toHaveBeenCalledWith('/api/sounds/manifest');
  });

  it('returns 400 on invalid JSON body', async () => {
    const res = await PUT(
      new Request('http://x', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{not valid'
      })
    );
    expect(res.status).toBe(400);
    expect(putToR2Mock).not.toHaveBeenCalled();
  });

  it('rejects non-admin callers with 403 (guard exercised)', async () => {
    const res = await PUT(
      new Request('http://x', {
        method: 'PUT',
        headers: { 'x-test-admin': '0', 'content-type': 'application/json' },
        body: JSON.stringify(STORED)
      })
    );
    expect(res.status).toBe(403);
    expect(putToR2Mock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
