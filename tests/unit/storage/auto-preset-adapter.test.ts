import { describe, it, expect, vi } from 'vitest';
import { fetchAutoPreset } from '@/lib/storage/auto-preset-adapter';
import type { ParamSchema } from '@/lib/renderer/types';

const schema: ParamSchema = {
  intensity: { kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, label: 'I' }
};

describe('fetchAutoPreset', () => {
  it('posts the imageUrl and fxId, returns validated params', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ params: { intensity: 0.8 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    const out = await fetchAutoPreset({
      imageUrl: 'https://x/a.jpg',
      fxId: 'pulse',
      paramSchema: schema
    });
    expect(out.intensity).toBe(0.8);
    expect(spy).toHaveBeenCalledWith('/api/analyze-image', expect.objectContaining({ method: 'POST' }));
  });

  it('throws with code on 4xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'UNKNOWN_FX' }), { status: 404 })
    );
    await expect(
      fetchAutoPreset({ imageUrl: 'x', fxId: 'nope', paramSchema: schema })
    ).rejects.toThrow(/UNKNOWN_FX/);
  });

  it('re-validates server response against schema (clamps misbehaving server)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ params: { intensity: 99 } }), { status: 200 })
    );
    const out = await fetchAutoPreset({
      imageUrl: 'x',
      fxId: 'pulse',
      paramSchema: schema
    });
    expect(out.intensity).toBe(1);
  });
});
