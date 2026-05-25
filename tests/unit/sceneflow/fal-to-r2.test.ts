import { describe, it, expect, vi, beforeEach } from 'vitest';

const putToR2Mock = vi.fn();
const getR2ConfigMock = vi.fn();

vi.mock('@/lib/storage/r2-client', () => ({
  putToR2: (...args: unknown[]) => putToR2Mock(...args)
}));
vi.mock('@/lib/storage/env', () => ({
  getR2Config: () => getR2ConfigMock()
}));

beforeEach(() => {
  putToR2Mock.mockReset();
  getR2ConfigMock.mockReset();
  getR2ConfigMock.mockReturnValue({
    publicUrl: 'https://cdn.example.com',
    bucket: 'vg',
    accountId: 'x',
    accessKeyId: 'x',
    secretAccessKey: 'x',
    endpoint: 'https://r2.example'
  });
});

describe('sceneflowR2Key — naming schema', () => {
  it('image → sceneflow/{userId}/{storyId}/{sceneId}/image.jpg', async () => {
    const { sceneflowR2Key } = await import('@/lib/sceneflow/fal-to-r2');
    expect(
      sceneflowR2Key({
        userId: 'u1',
        storyId: 's1',
        sceneId: 'sc1',
        kind: 'image'
      })
    ).toBe('sceneflow/u1/s1/sc1/image.jpg');
  });

  it('neutral-video → ...neutral-video.mp4, video → ...video.mp4, audio → ...audio.mp3', async () => {
    const { sceneflowR2Key } = await import('@/lib/sceneflow/fal-to-r2');
    expect(
      sceneflowR2Key({
        userId: 'u',
        storyId: 's',
        sceneId: 'sc',
        kind: 'neutral-video'
      })
    ).toBe('sceneflow/u/s/sc/neutral-video.mp4');
    expect(
      sceneflowR2Key({
        userId: 'u',
        storyId: 's',
        sceneId: 'sc',
        kind: 'video'
      })
    ).toBe('sceneflow/u/s/sc/video.mp4');
    expect(
      sceneflowR2Key({
        userId: 'u',
        storyId: 's',
        sceneId: 'sc',
        kind: 'audio'
      })
    ).toBe('sceneflow/u/s/sc/audio.mp3');
  });

  it('rejects unsafe path segments', async () => {
    const { sceneflowR2Key } = await import('@/lib/sceneflow/fal-to-r2');
    expect(() =>
      sceneflowR2Key({
        userId: '../etc',
        storyId: 's',
        sceneId: 'sc',
        kind: 'image'
      })
    ).toThrow(/unsafe/);
  });
});

describe('falUrlToR2 — transfer fal URL to R2', () => {
  it('fetches the fal URL and PUTs it to R2 under the correct key', async () => {
    const sample = new Uint8Array([1, 2, 3, 4]);
    global.fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => sample.buffer
    })) as unknown as typeof fetch;

    putToR2Mock.mockResolvedValueOnce(undefined);

    const { falUrlToR2 } = await import('@/lib/sceneflow/fal-to-r2');
    const url = await falUrlToR2('https://fal.media/abc.jpg', {
      userId: 'u',
      storyId: 's',
      sceneId: 'sc',
      kind: 'image'
    });

    expect(url).toBe('https://cdn.example.com/sceneflow/u/s/sc/image.jpg');
    expect(putToR2Mock).toHaveBeenCalledWith(
      'sceneflow/u/s/sc/image.jpg',
      expect.any(Uint8Array),
      'image/jpeg'
    );
  });

  it('throws when the fal fetch fails', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0)
    })) as unknown as typeof fetch;
    const { falUrlToR2 } = await import('@/lib/sceneflow/fal-to-r2');
    await expect(
      falUrlToR2('https://fal.media/missing.jpg', {
        userId: 'u',
        storyId: 's',
        sceneId: 'sc',
        kind: 'image'
      })
    ).rejects.toThrow(/HTTP 404/);
  });
});
