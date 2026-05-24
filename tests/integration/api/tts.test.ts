import { describe, it, expect, vi, beforeEach } from 'vitest';

const { edgeMock, elevenMock, getSession } = vi.hoisted(() => ({
  edgeMock: {
    listEdgeVoices: vi.fn(),
    synthesizeEdge: vi.fn(),
    _resetEdgeVoiceCacheForTests: vi.fn()
  },
  elevenMock: {
    listElevenLabsVoices: vi.fn(),
    synthesizeElevenLabs: vi.fn(),
    ElevenLabsNotConfigured: class ElevenLabsNotConfigured extends Error {
      constructor() {
        super('ELEVENLABS_API_KEY is not set');
        this.name = 'ElevenLabsNotConfigured';
      }
    },
    _resetElevenLabsCacheForTests: vi.fn()
  },
  getSession: vi.fn()
}));

vi.mock('@/lib/tts/edge', () => edgeMock);
vi.mock('@/lib/tts/elevenlabs', () => elevenMock);
vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession } }
}));

import { POST as postPreview } from '@/app/api/tts/preview/route';
import { GET as getVoices } from '@/app/api/tts/voices/[provider]/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/tts/preview', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await postPreview(
      new Request('http://x', { method: 'POST', body: '{}' })
    );
    expect(res.status).toBe(401);
  });

  it('400 on invalid provider', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    const res = await postPreview(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ provider: 'sonix', voiceId: 'x', text: 'hi' }),
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(400);
  });

  it('400 on empty text', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    const res = await postPreview(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ provider: 'edge', voiceId: 'de-DE-KillianNeural', text: '   ' }),
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(400);
  });

  it('edge happy path returns audio/mpeg', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    edgeMock.synthesizeEdge.mockResolvedValue(Buffer.from([0xff, 0xfb, 0x90, 0x00]));
    const res = await postPreview(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ provider: 'edge', voiceId: 'de-DE-KillianNeural', text: 'Hallo' }),
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
  });

  it('503 when ElevenLabs key is missing', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    elevenMock.synthesizeElevenLabs.mockRejectedValue(new elevenMock.ElevenLabsNotConfigured());
    const res = await postPreview(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ provider: 'elevenlabs', voiceId: 'voice-1', text: 'hi' }),
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(503);
  });
});

describe('GET /api/tts/voices/[provider]', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await getVoices(new Request('http://x'), {
      params: { provider: 'edge' }
    });
    expect(res.status).toBe(401);
  });

  it('400 for unknown provider', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    const res = await getVoices(new Request('http://x'), {
      params: { provider: 'mystery' }
    });
    expect(res.status).toBe(400);
  });

  it('edge → 200 + voices array', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    edgeMock.listEdgeVoices.mockResolvedValue([
      { id: 'de-DE-KillianNeural', name: 'Killian', locale: 'de-DE', gender: 'Male' }
    ]);
    const res = await getVoices(new Request('http://x'), {
      params: { provider: 'edge' }
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voices).toHaveLength(1);
  });

  it('elevenlabs 503 when key missing', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    elevenMock.listElevenLabsVoices.mockRejectedValue(new elevenMock.ElevenLabsNotConfigured());
    const res = await getVoices(new Request('http://x'), {
      params: { provider: 'elevenlabs' }
    });
    expect(res.status).toBe(503);
  });
});
