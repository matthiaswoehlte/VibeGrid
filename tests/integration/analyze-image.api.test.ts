// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

const messagesCreate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ intensity: 0.7, color: '#ff00aa' })
      }
    ]
  })
);

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: messagesCreate }
  }))
}));

process.env.ANTHROPIC_API_KEY = 'sk-test';

import { POST } from '@/app/api/analyze-image/route';
import { _resetAnthropicClientForTests } from '@/lib/ai/anthropic';
import { _resetAnthropicConfigForTests } from '@/lib/ai/env';
import { _resetBuiltInPluginsForTests } from '@/lib/fx';

function req(body: unknown): Request {
  return new Request('http://localhost/api/analyze-image', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  });
}

describe('POST /api/analyze-image', () => {
  beforeEach(() => {
    messagesCreate.mockClear();
    _resetAnthropicClientForTests();
    _resetAnthropicConfigForTests();
    // Reset the plugin registry so the route's own registerBuiltInPlugins()
    // actually re-registers (otherwise the `registered` flag may be true
    // while the registry is empty from a prior renderer test).
    _resetBuiltInPluginsForTests();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' }
      })
    );
  });

  it('happy path returns validated params for the pulse plugin', async () => {
    const res = await POST(req({ imageUrl: 'https://x/img.jpg', fxId: 'pulse' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fxId).toBe('pulse');
    expect(body.params.intensity).toBeCloseTo(0.7);
    expect(body.params.color).toBe('#ff00aa');
    expect(messagesCreate).toHaveBeenCalledTimes(1);
  });

  it('malformed Claude response → 502', async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not json' }]
    });
    const res = await POST(req({ imageUrl: 'https://x/img.jpg', fxId: 'pulse' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('AI_ERROR');
  });

  it('image fetch failure → 502', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 }));
    const res = await POST(req({ imageUrl: 'https://x/missing.jpg', fxId: 'pulse' }));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('IMAGE_FETCH_FAILED');
  });

  it('missing env var → 503', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    _resetAnthropicConfigForTests();
    _resetAnthropicClientForTests();
    const res = await POST(req({ imageUrl: 'https://x/img.jpg', fxId: 'pulse' }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('AI_NOT_CONFIGURED');
  });

  it('unknown fxId → 404', async () => {
    const res = await POST(req({ imageUrl: 'https://x/img.jpg', fxId: 'nonexistent' }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('UNKNOWN_FX');
  });
});
