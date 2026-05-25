import { describe, it, expect, vi, beforeEach } from 'vitest';

const synthesizeEdgeMock = vi.fn();
const synthesizeElevenLabsMock = vi.fn();

vi.mock('@/lib/tts/edge', () => ({
  synthesizeEdge: (...args: unknown[]) => synthesizeEdgeMock(...args)
}));
vi.mock('@/lib/tts/elevenlabs', () => ({
  synthesizeElevenLabs: (...args: unknown[]) => synthesizeElevenLabsMock(...args)
}));

beforeEach(() => {
  synthesizeEdgeMock.mockReset();
  synthesizeElevenLabsMock.mockReset();
});

describe('synthesizeForCharacter — provider dispatch', () => {
  it('voice_provider === "edge" calls synthesizeEdge', async () => {
    synthesizeEdgeMock.mockResolvedValueOnce(Buffer.from([1, 2, 3]));
    const { synthesizeForCharacter } = await import('@/lib/sceneflow/tts');
    const buf = await synthesizeForCharacter(
      { voice_provider: 'edge', voice_id: 'de-DE-KillianNeural' },
      'Hallo Welt'
    );
    expect(buf.length).toBe(3);
    expect(synthesizeEdgeMock).toHaveBeenCalledWith({
      voiceId: 'de-DE-KillianNeural',
      text: 'Hallo Welt'
    });
    expect(synthesizeElevenLabsMock).not.toHaveBeenCalled();
  });

  it('voice_provider === "elevenlabs" calls synthesizeElevenLabs', async () => {
    synthesizeElevenLabsMock.mockResolvedValueOnce(Buffer.from([9, 9]));
    const { synthesizeForCharacter } = await import('@/lib/sceneflow/tts');
    const buf = await synthesizeForCharacter(
      { voice_provider: 'elevenlabs', voice_id: '21m00Tcm4TlvDq8ikWAM' },
      'Hello'
    );
    expect(buf.length).toBe(2);
    expect(synthesizeElevenLabsMock).toHaveBeenCalledWith({
      voiceId: '21m00Tcm4TlvDq8ikWAM',
      text: 'Hello'
    });
    expect(synthesizeEdgeMock).not.toHaveBeenCalled();
  });

  it('voice_provider === "azure" throws klartext error (no crash)', async () => {
    const { synthesizeForCharacter } = await import('@/lib/sceneflow/tts');
    await expect(
      synthesizeForCharacter(
        { voice_provider: 'azure', voice_id: 'de-DE-KatjaNeural' },
        'Hallo'
      )
    ).rejects.toThrow(/Azure TTS nicht implementiert/);
    expect(synthesizeEdgeMock).not.toHaveBeenCalled();
    expect(synthesizeElevenLabsMock).not.toHaveBeenCalled();
  });

  it('voice_id === null throws before reaching any provider', async () => {
    const { synthesizeForCharacter } = await import('@/lib/sceneflow/tts');
    await expect(
      synthesizeForCharacter({ voice_provider: 'edge', voice_id: null }, 'x')
    ).rejects.toThrow(/no voice_id/);
    expect(synthesizeEdgeMock).not.toHaveBeenCalled();
  });
});
