// @vitest-environment node
//
// The upload route uses Request.formData() with multipart bodies which
// jsdom does not implement correctly. Node's native undici does, and
// we're testing a server route here.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const putToR2Mock = vi.fn(async () => undefined);
const revalidatePathMock = vi.fn();

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
  putToR2: (...args: unknown[]) => putToR2Mock(...args)
}));

vi.mock('next/cache', () => ({
  revalidatePath: (p: string) => revalidatePathMock(p)
}));

import { POST } from '@/app/api/admin/sounds/upload/route';
import type { SoundManifest } from '@/lib/sounds/types';

const EMPTY: SoundManifest = {
  version: 0,
  updatedAt: '2026-05-28T00:00:00Z',
  categories: []
};

function makeForm(opts: {
  file?: File | string | null;
  category?: string;
  label?: string;
  duration?: number | string;
  tags?: string;
  license?: string;
  bpm?: string;
}): FormData {
  const fd = new FormData();
  if (opts.file !== undefined) {
    if (opts.file instanceof File) fd.append('file', opts.file);
    else if (typeof opts.file === 'string') fd.append('file', opts.file);
  }
  if (opts.category !== undefined) fd.append('category', opts.category);
  if (opts.label !== undefined) fd.append('label', opts.label);
  if (opts.duration !== undefined) fd.append('duration', String(opts.duration));
  if (opts.tags !== undefined) fd.append('tags', opts.tags);
  if (opts.license !== undefined) fd.append('license', opts.license);
  if (opts.bpm !== undefined) fd.append('bpm', opts.bpm);
  return fd;
}

function reqWithForm(fd: FormData, isAdmin = true): Request {
  return new Request('http://x', {
    method: 'POST',
    body: fd,
    headers: isAdmin ? {} : { 'x-test-admin': '0' }
  });
}

const VALID_MP3 = new File(['fake-mp3-bytes'], 'heavy-braam.mp3', {
  type: 'audio/mpeg'
});

beforeEach(() => {
  putToR2Mock.mockReset();
  revalidatePathMock.mockReset();
  vi.unstubAllGlobals();
});

describe('POST /api/admin/sounds/upload — atomic upload', () => {
  it('rejects non-admin callers with 403', async () => {
    const res = await POST(
      reqWithForm(
        makeForm({ file: VALID_MP3, category: 'braams', label: 'Heavy', duration: 2.4 }),
        false
      )
    );
    expect(res.status).toBe(403);
    expect(putToR2Mock).not.toHaveBeenCalled();
  });

  it('rejects non-MP3 MIME with 400 (server-side defense in depth)', async () => {
    const wav = new File(['x'], 'foo.wav', { type: 'audio/wav' });
    const res = await POST(
      reqWithForm(makeForm({ file: wav, category: 'braams', label: 'Heavy', duration: 2 }))
    );
    expect(res.status).toBe(400);
    expect(putToR2Mock).not.toHaveBeenCalled();
  });

  it('rejects files > 10 MB with 400', async () => {
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'big.mp3', {
      type: 'audio/mpeg'
    });
    const res = await POST(
      reqWithForm(makeForm({ file: big, category: 'braams', label: 'Big', duration: 1 }))
    );
    expect(res.status).toBe(400);
    expect(putToR2Mock).not.toHaveBeenCalled();
  });

  it('rejects missing label / category / duration with 400', async () => {
    const res = await POST(
      reqWithForm(makeForm({ file: VALID_MP3, category: '', label: '', duration: 2 }))
    );
    expect(res.status).toBe(400);
  });

  it('on success: writes MP3 + writes manifest + revalidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => EMPTY })
    );

    const res = await POST(
      reqWithForm(
        makeForm({
          file: VALID_MP3,
          category: 'braams',
          label: 'Heavy Braam',
          duration: 2.4,
          tags: JSON.stringify(['dark', 'cinematic']),
          license: 'CC0'
        })
      )
    );
    expect(res.status).toBe(200);
    expect(putToR2Mock).toHaveBeenCalledTimes(2);
    const firstCall = putToR2Mock.mock.calls[0] as [
      string,
      Uint8Array,
      string,
      { cacheControl?: string }
    ];
    expect(firstCall[0]).toMatch(/^library\/sfx\/braams\/heavy-braam-[a-f0-9]{8}\.mp3$/);
    expect(firstCall[2]).toBe('audio/mpeg');
    expect(firstCall[3].cacheControl).toContain('immutable');

    const secondCall = putToR2Mock.mock.calls[1] as [string, Uint8Array, string, { cacheControl?: string }];
    expect(secondCall[0]).toBe('library/manifest.json');
    const writtenManifest = JSON.parse(
      new TextDecoder().decode(secondCall[1])
    ) as SoundManifest;
    expect(writtenManifest.version).toBe(1);
    expect(writtenManifest.categories[0].id).toBe('braams');
    const entry = writtenManifest.categories[0].sounds[0];
    expect(entry.label).toBe('Heavy Braam');
    expect(entry.url).toMatch(/^sfx\/braams\/heavy-braam-[a-f0-9]{8}\.mp3$/);
    expect(entry.tags).toEqual(['dark', 'cinematic']);
    expect(entry.license).toBe('CC0');

    expect(revalidatePathMock).toHaveBeenCalledWith('/api/sounds/manifest');
  });

  it('two uploads with the same label get different UUID-suffixed ids (W9)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => EMPTY })
    );

    const res1 = await POST(
      reqWithForm(
        makeForm({ file: VALID_MP3, category: 'braams', label: 'Heavy', duration: 2 })
      )
    );
    const body1 = (await res1.json()) as {
      entry: { id: string };
    };
    const res2 = await POST(
      reqWithForm(
        makeForm({ file: VALID_MP3, category: 'braams', label: 'Heavy', duration: 2 })
      )
    );
    const body2 = (await res2.json()) as { entry: { id: string } };

    expect(body1.entry.id).not.toBe(body2.entry.id);
    expect(body1.entry.id.startsWith('heavy-')).toBe(true);
    expect(body2.entry.id.startsWith('heavy-')).toBe(true);
  });

  it('auto-creates a missing category in the manifest (W11)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => EMPTY })
    );

    await POST(
      reqWithForm(
        makeForm({
          file: VALID_MP3,
          category: 'whoosh',
          label: 'Fast Whoosh',
          duration: 0.8
        })
      )
    );
    const written = JSON.parse(
      new TextDecoder().decode(
        (putToR2Mock.mock.calls[1] as [string, Uint8Array])[1]
      )
    ) as SoundManifest;
    expect(written.categories.map((c) => c.id)).toContain('whoosh');
    expect(written.categories.find((c) => c.id === 'whoosh')?.label).toBe('Whoosh');
  });
});
