import 'server-only';
import { synthesizeEdge } from '@/lib/tts/edge';
import { synthesizeElevenLabs } from '@/lib/tts/elevenlabs';
import type { CharacterRecord } from './types';

/**
 * Plan 8c — TTS dispatcher.
 *
 * Re-uses the Edge + ElevenLabs back-ends shipped with the post-8b voice
 * picker. Azure stays in the schema for a future paid-Azure-Speech path
 * but throws here in v0.1 with a klartext message so the scene-render
 * pipeline degrades cleanly instead of crashing.
 */
export async function synthesizeForCharacter(
  character: Pick<CharacterRecord, 'voice_provider' | 'voice_id'>,
  text: string
): Promise<Buffer> {
  if (character.voice_id === null) {
    throw new Error(
      'Character has no voice_id — assign a voice in the Character Manager before generating audio'
    );
  }
  switch (character.voice_provider) {
    case 'edge':
      return synthesizeEdge({ voiceId: character.voice_id, text });
    case 'elevenlabs':
      return synthesizeElevenLabs({ voiceId: character.voice_id, text });
    case 'azure':
      throw new Error(
        'Azure TTS nicht implementiert — bitte voice_provider auf edge oder elevenlabs setzen'
      );
    default:
      throw new Error(
        `Unbekannter voice_provider: ${String(character.voice_provider)}`
      );
  }
}
