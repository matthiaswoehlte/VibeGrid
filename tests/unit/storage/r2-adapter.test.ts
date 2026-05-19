import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createR2StorageAdapter } from '@/lib/storage/r2-adapter';
import type { MediaRef } from '@/lib/storage/types';

describe('R2StorageAdapter', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const mediaRef: MediaRef = {
      id: '11111111-2222-4333-8444-555555555555',
      kind: 'image',
      url: 'https://media.example.com/anonymous/default/image/x.jpg',
      filename: 'cover.jpg',
      uploadedAt: '2026-05-19T12:00:00.000Z'
    };
    // Build a fresh Response per call — Response bodies are one-shot, so a
    // single shared instance fails on the second upload (Body has already
    // been read).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async () =>
      new Response(JSON.stringify(mediaRef), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      })
    );
  });

  it('posts a multipart request to /api/upload with kind=image', async () => {
    const adapter = createR2StorageAdapter();
    const file = new File([new Uint8Array([1, 2, 3])], 'cover.jpg', { type: 'image/jpeg' });
    const result = await adapter.uploadImage(file);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/upload');
    expect((init as RequestInit).method).toBe('POST');
    const fd = (init as RequestInit).body as FormData;
    expect(fd.get('kind')).toBe('image');
    expect(typeof fd.get('id')).toBe('string');
    expect(fd.get('file')).toBeInstanceOf(File);
    expect(result.url).toMatch(/^https:/);
  });

  it('posts with kind=audio for uploadAudio', async () => {
    const adapter = createR2StorageAdapter();
    const file = new File([new Uint8Array([1, 2, 3])], 'song.mp3', { type: 'audio/mpeg' });
    await adapter.uploadAudio(file);
    const fd = (fetchSpy.mock.calls[0][1] as RequestInit).body as FormData;
    expect(fd.get('kind')).toBe('audio');
  });

  it('throws when the server returns 4xx', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'bad mime', code: 'UNSUPPORTED_MIME' }), {
        status: 400
      })
    );
    const adapter = createR2StorageAdapter();
    const file = new File([new Uint8Array([1])], 'x.txt', { type: 'text/plain' });
    await expect(adapter.uploadImage(file)).rejects.toThrow(/UNSUPPORTED_MIME|bad mime/);
  });

  it('generates a UUID v4 id per call', async () => {
    const UUID_V4_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const adapter = createR2StorageAdapter();
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' });
    await adapter.uploadImage(file);
    await adapter.uploadImage(file);
    const fd1 = (fetchSpy.mock.calls[0][1] as RequestInit).body as FormData;
    const fd2 = (fetchSpy.mock.calls[1][1] as RequestInit).body as FormData;
    const id1 = fd1.get('id') as string;
    const id2 = fd2.get('id') as string;
    // Assert both that the id is shaped as UUID v4 AND that two calls produce
    // distinct ids — the original test only checked uniqueness, which would
    // pass for any random string source (incl. a buggy one).
    expect(UUID_V4_RE.test(id1)).toBe(true);
    expect(UUID_V4_RE.test(id2)).toBe(true);
    expect(id1).not.toBe(id2);
  });
});
