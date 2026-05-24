import { describe, it, expect, vi } from 'vitest';

describe('fal client stub', () => {
  it('generateImage throws "not implemented until Plan 8c"', async () => {
    const { generateImage } = await import('@/lib/fal/client');
    await expect(
      generateImage({ prompt: 'x', model: 'fal-ai/flux/dev' })
    ).rejects.toThrow(/not implemented until Plan 8c/);
  });

  it('throws at import time when FAL_KEY is missing', async () => {
    const orig = process.env.FAL_KEY;
    delete process.env.FAL_KEY;
    vi.resetModules();
    await expect(import('@/lib/fal/client')).rejects.toThrow(/FAL_KEY/);
    process.env.FAL_KEY = orig;
  });
});
