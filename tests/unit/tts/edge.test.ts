import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getVoicesMock } = vi.hoisted(() => ({
  getVoicesMock: vi.fn()
}));

vi.mock('msedge-tts', () => ({
  MsEdgeTTS: class {
    getVoices = getVoicesMock;
    setMetadata = vi.fn();
    toStream = vi.fn();
    close = vi.fn();
  },
  OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'audio-24khz-48kbitrate-mono-mp3' }
}));

import { listEdgeVoices, _resetEdgeVoiceCacheForTests } from '@/lib/tts/edge';

beforeEach(() => {
  getVoicesMock.mockReset();
  _resetEdgeVoiceCacheForTests();
});

describe('lib/tts/edge.listEdgeVoices', () => {
  it('normalizes Microsoft FriendlyName + Gender + Locale', async () => {
    getVoicesMock.mockResolvedValueOnce([
      {
        Name: 'Microsoft Server Speech Text to Speech Voice (de-DE, KillianNeural)',
        ShortName: 'de-DE-KillianNeural',
        Gender: 'Male',
        Locale: 'de-DE',
        SuggestedCodec: 'audio-24khz-48kbitrate-mono-mp3',
        FriendlyName: 'Microsoft Killian Online (Natural) - German (Germany)',
        Status: 'GA'
      },
      {
        Name: 'Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)',
        ShortName: 'en-US-JennyNeural',
        Gender: 'Female',
        Locale: 'en-US',
        SuggestedCodec: 'audio-24khz-48kbitrate-mono-mp3',
        FriendlyName: 'Microsoft Jenny Online (Natural) - English (United States)',
        Status: 'GA'
      }
    ]);
    const voices = await listEdgeVoices();
    expect(voices).toEqual([
      { id: 'de-DE-KillianNeural', name: 'Killian', locale: 'de-DE', gender: 'Male' },
      { id: 'en-US-JennyNeural', name: 'Jenny', locale: 'en-US', gender: 'Female' }
    ]);
  });

  it('caches the catalog — second call does not refetch within TTL', async () => {
    getVoicesMock.mockResolvedValueOnce([
      {
        Name: 'X',
        ShortName: 'x-X-AnaNeural',
        Gender: 'Female',
        Locale: 'x-X',
        SuggestedCodec: '',
        FriendlyName: 'Microsoft Ana Online (Natural) - X (X)',
        Status: 'GA'
      }
    ]);
    await listEdgeVoices();
    await listEdgeVoices();
    await listEdgeVoices();
    expect(getVoicesMock).toHaveBeenCalledTimes(1);
  });

  it('coerces unknown Gender to "Unknown"', async () => {
    getVoicesMock.mockResolvedValueOnce([
      {
        Name: 'X',
        ShortName: 'x-X-Voice',
        Gender: 'NonBinary',
        Locale: 'x-X',
        SuggestedCodec: '',
        FriendlyName: 'Microsoft Voice Online (Natural) - X (X)',
        Status: 'GA'
      }
    ]);
    const voices = await listEdgeVoices();
    expect(voices[0]!.gender).toBe('Unknown');
  });
});
