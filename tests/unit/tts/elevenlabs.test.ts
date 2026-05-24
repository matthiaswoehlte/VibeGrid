import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listElevenLabsVoices,
  synthesizeElevenLabs,
  ElevenLabsNotConfigured,
  _resetElevenLabsCacheForTests
} from '@/lib/tts/elevenlabs';

const originalFetch = global.fetch;
const originalKey = process.env.ELEVENLABS_API_KEY;

beforeEach(() => {
  _resetElevenLabsCacheForTests();
  process.env.ELEVENLABS_API_KEY = 'test-key';
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.ELEVENLABS_API_KEY = originalKey;
});

describe('lib/tts/elevenlabs.listElevenLabsVoices', () => {
  it('throws ElevenLabsNotConfigured when key is missing', async () => {
    process.env.ELEVENLABS_API_KEY = '';
    await expect(listElevenLabsVoices()).rejects.toBeInstanceOf(ElevenLabsNotConfigured);
  });

  it('normalizes voice payload + sends xi-api-key header', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        voices: [
          {
            voice_id: 'abc',
            name: 'Rachel',
            category: 'premade',
            description: 'Calm narrator',
            labels: { accent: 'american', gender: 'female' }
          }
        ]
      })
    })) as unknown as typeof fetch;
    const voices = await listElevenLabsVoices();
    expect(voices).toEqual([
      {
        id: 'abc',
        name: 'Rachel',
        category: 'premade',
        description: 'Calm narrator',
        labels: { accent: 'american', gender: 'female' }
      }
    ]);
    expect((global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![1]).toMatchObject({
      headers: { 'xi-api-key': 'test-key' }
    });
  });

  it('caches between calls', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ voices: [] })
    })) as unknown as typeof fetch;
    await listElevenLabsVoices();
    await listElevenLabsVoices();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws with status code when API rejects', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'unauthorized'
    })) as unknown as typeof fetch;
    await expect(listElevenLabsVoices()).rejects.toThrow(/401/);
  });
});

describe('lib/tts/elevenlabs.synthesizeElevenLabs', () => {
  it('POSTs voiceId + text and returns audio Buffer', async () => {
    const audioBytes = new Uint8Array([1, 2, 3, 4]);
    global.fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => audioBytes.buffer
    })) as unknown as typeof fetch;
    const buf = await synthesizeElevenLabs({ voiceId: 'voice-1', text: 'hi' });
    expect(buf).toEqual(Buffer.from(audioBytes));
    const call = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[0]).toMatch(/text-to-speech\/voice-1/);
    expect((call[1] as { body: string }).body).toContain('eleven_multilingual_v2');
  });
});
