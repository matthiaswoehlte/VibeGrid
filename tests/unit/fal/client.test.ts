import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @fal-ai/client. Each test resets and configures fresh mocks.
const subscribeMock = vi.fn();
const submitMock = vi.fn();
const statusMock = vi.fn();
const resultMock = vi.fn();
const configMock = vi.fn();

vi.mock('@fal-ai/client', () => ({
  fal: {
    config: (cfg: unknown) => configMock(cfg),
    subscribe: (...args: unknown[]) => subscribeMock(...args),
    queue: {
      submit: (...args: unknown[]) => submitMock(...args),
      status: (...args: unknown[]) => statusMock(...args),
      result: (...args: unknown[]) => resultMock(...args)
    }
  }
}));

beforeEach(() => {
  subscribeMock.mockReset();
  submitMock.mockReset();
  statusMock.mockReset();
  resultMock.mockReset();
  configMock.mockReset();
});

describe('fal client — generateImage', () => {
  it('passes prompt + image_size + defaults to fal.subscribe and returns url', async () => {
    subscribeMock.mockResolvedValueOnce({
      data: { images: [{ url: 'https://fal.media/abc.jpg' }], seed: 1234 }
    });
    const { generateImage } = await import('@/lib/fal/client');
    const result = await generateImage({
      prompt: 'a cat in space',
      imageSize: 'landscape_16_9'
    });
    expect(result).toEqual({ url: 'https://fal.media/abc.jpg', seed: 1234 });
    expect(subscribeMock).toHaveBeenCalledWith(
      'fal-ai/flux/dev',
      expect.objectContaining({
        input: expect.objectContaining({
          prompt: 'a cat in space',
          image_size: 'landscape_16_9',
          num_inference_steps: 28,
          guidance_scale: 3.5
        })
      })
    );
  });

  it('throws when response has no image URL', async () => {
    subscribeMock.mockResolvedValueOnce({ data: { images: [] } });
    const { generateImage } = await import('@/lib/fal/client');
    await expect(
      generateImage({ prompt: 'x', imageSize: 'landscape_16_9' })
    ).rejects.toThrow(/no image URL/);
  });
});

describe('fal client — image-size mapping', () => {
  it('maps 16:9 → landscape_16_9, 9:16 → portrait_16_9, 4:3 → landscape_4_3', async () => {
    const { storyFormatToImageSize } = await import('@/lib/fal/client');
    expect(storyFormatToImageSize('16:9')).toBe('landscape_16_9');
    expect(storyFormatToImageSize('9:16')).toBe('portrait_16_9');
    expect(storyFormatToImageSize('4:3')).toBe('landscape_4_3');
  });
});

describe('fal client — submitVideoJob', () => {
  it('uses fal.queue.submit (not subscribe) and returns request_id', async () => {
    submitMock.mockResolvedValueOnce({ request_id: 'req-kling-1' });
    const { submitVideoJob } = await import('@/lib/fal/client');
    const id = await submitVideoJob({
      prompt: 'cinematic push-in',
      imageUrl: 'https://r2.example/img.jpg',
      duration: '5'
    });
    expect(id).toBe('req-kling-1');
    expect(submitMock).toHaveBeenCalledWith(
      'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
      expect.objectContaining({
        input: expect.objectContaining({
          prompt: 'cinematic push-in',
          image_url: 'https://r2.example/img.jpg',
          duration: '5'
        })
      })
    );
    expect(subscribeMock).not.toHaveBeenCalled();
  });
});

describe('fal client — submitLipSyncJob vs submitMuseTalkJob', () => {
  it('sync-lipsync uses video_url, MuseTalk uses source_video_url', async () => {
    submitMock.mockResolvedValueOnce({ request_id: 'sync-1' });
    submitMock.mockResolvedValueOnce({ request_id: 'muse-1' });
    const { submitLipSyncJob, submitMuseTalkJob } = await import(
      '@/lib/fal/client'
    );
    const syncId = await submitLipSyncJob({
      videoUrl: 'https://r2.example/neutral.mp4',
      audioUrl: 'https://r2.example/a.mp3'
    });
    const museId = await submitMuseTalkJob({
      sourceVideoUrl: 'https://r2.example/neutral.mp4',
      audioUrl: 'https://r2.example/a.mp3'
    });
    expect(syncId).toBe('sync-1');
    expect(museId).toBe('muse-1');

    const [endpoint1, options1] = submitMock.mock.calls[0]!;
    expect(endpoint1).toBe('fal-ai/sync-lipsync/v3');
    expect(options1).toEqual(
      expect.objectContaining({
        input: expect.objectContaining({
          video_url: 'https://r2.example/neutral.mp4',
          sync_mode: 'remap'
        })
      })
    );
    expect((options1 as { input: Record<string, unknown> }).input.source_video_url).toBeUndefined();

    const [endpoint2, options2] = submitMock.mock.calls[1]!;
    expect(endpoint2).toBe('fal-ai/musetalk');
    expect(options2).toEqual(
      expect.objectContaining({
        input: expect.objectContaining({
          source_video_url: 'https://r2.example/neutral.mp4'
        })
      })
    );
    expect((options2 as { input: Record<string, unknown> }).input.video_url).toBeUndefined();
  });
});

describe('fal client — status / result wrappers', () => {
  it('getJobStatus returns the status string', async () => {
    statusMock.mockResolvedValueOnce({ status: 'COMPLETED', logs: [] });
    const { getJobStatus } = await import('@/lib/fal/client');
    const s = await getJobStatus({
      endpointId: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
      requestId: 'r1'
    });
    expect(s).toBe('COMPLETED');
  });

  it('getVideoJobResult extracts video.url', async () => {
    resultMock.mockResolvedValueOnce({
      data: { video: { url: 'https://fal.media/v.mp4' } }
    });
    const { getVideoJobResult } = await import('@/lib/fal/client');
    const u = await getVideoJobResult({
      endpointId: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
      requestId: 'r1'
    });
    expect(u).toBe('https://fal.media/v.mp4');
  });

  it('getVideoJobResult throws when video.url is missing', async () => {
    resultMock.mockResolvedValueOnce({ data: { video: {} } });
    const { getVideoJobResult } = await import('@/lib/fal/client');
    await expect(
      getVideoJobResult({ endpointId: 'x', requestId: 'y' })
    ).rejects.toThrow(/no video URL/);
  });
});

describe('fal client — FAL_KEY guard (runs last to avoid module-cache pollution)', () => {
  it('throws at import time when FAL_KEY is missing', async () => {
    const orig = process.env.FAL_KEY;
    try {
      delete process.env.FAL_KEY;
      vi.resetModules();
      await expect(import('@/lib/fal/client')).rejects.toThrow(/FAL_KEY/);
    } finally {
      process.env.FAL_KEY = orig ?? 'test-fal-key-not-real';
    }
  });
});
