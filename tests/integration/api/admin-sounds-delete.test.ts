import { describe, it, expect, vi, beforeEach } from 'vitest';

const putToR2Mock = vi.fn(async (..._args: unknown[]) => undefined);
const deleteFromR2Mock = vi.fn(async (..._args: unknown[]) => undefined);
const revalidatePathMock = vi.fn();
const callOrder: string[] = [];

vi.mock('@/lib/auth/admin-guard', () => ({
  requireAdminApi: (req: Request) => {
    if (req.headers.get('x-test-admin') === '0') {
      return {
        response: new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403
        })
      };
    }
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
  putToR2: (...args: unknown[]) => {
    callOrder.push('putToR2');
    return putToR2Mock(...args);
  },
  deleteFromR2: (...args: unknown[]) => {
    callOrder.push('deleteFromR2');
    return deleteFromR2Mock(...args);
  }
}));

vi.mock('next/cache', () => ({
  revalidatePath: (p: string) => revalidatePathMock(p)
}));

import { DELETE } from '@/app/api/admin/sounds/[id]/route';
import type { SoundManifest } from '@/lib/sounds/types';

const SEEDED: SoundManifest = {
  version: 7,
  updatedAt: '2026-05-28T00:00:00Z',
  categories: [
    {
      id: 'braams',
      label: 'Braams',
      sounds: [
        { id: 'heavy-01', label: 'Heavy', url: 'sfx/braams/heavy-01.mp3', duration: 2.4 },
        { id: 'rise-02', label: 'Rise', url: 'sfx/braams/rise-02.mp3', duration: 3.1 }
      ]
    }
  ]
};

beforeEach(() => {
  putToR2Mock.mockReset();
  deleteFromR2Mock.mockReset();
  revalidatePathMock.mockReset();
  callOrder.length = 0;
  vi.unstubAllGlobals();
});

describe('DELETE /api/admin/sounds/[id]', () => {
  it('rejects non-admin callers with 403', async () => {
    const res = await DELETE(
      new Request('http://x', {
        method: 'DELETE',
        headers: { 'x-test-admin': '0' }
      }),
      { params: { id: 'heavy-01' } }
    );
    expect(res.status).toBe(403);
    expect(putToR2Mock).not.toHaveBeenCalled();
    expect(deleteFromR2Mock).not.toHaveBeenCalled();
  });

  it('404 when the entry is not in the manifest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => SEEDED })
    );
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), {
      params: { id: 'ghost-99' }
    });
    expect(res.status).toBe(404);
  });

  it('manifest-first ordering: write manifest BEFORE R2 delete (W6)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => SEEDED })
    );
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), {
      params: { id: 'heavy-01' }
    });
    expect(res.status).toBe(200);
    expect(callOrder).toEqual(['putToR2', 'deleteFromR2']);

    const manifestPut = putToR2Mock.mock.calls[0] as [
      string,
      Uint8Array,
      string,
      { cacheControl?: string }
    ];
    expect(manifestPut[0]).toBe('library/manifest.json');
    const written = JSON.parse(
      new TextDecoder().decode(manifestPut[1])
    ) as SoundManifest;
    expect(written.version).toBe(8);
    const sounds = written.categories[0].sounds;
    expect(sounds.map((s) => s.id)).toEqual(['rise-02']);

    expect(deleteFromR2Mock).toHaveBeenCalledWith(
      'library/sfx/braams/heavy-01.mp3'
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/api/sounds/manifest');
  });

  it('on R2 delete fail → still returns 200 (orphan-tolerant)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => SEEDED })
    );
    deleteFromR2Mock.mockRejectedValueOnce(new Error('r2 down'));
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), {
      params: { id: 'heavy-01' }
    });
    expect(res.status).toBe(200);
    expect(putToR2Mock).toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalled();
  });
});
