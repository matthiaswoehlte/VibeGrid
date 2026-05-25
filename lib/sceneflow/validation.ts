import type { CharacterRecord, SceneRecord, StoryRecord } from './types';

/**
 * Plan 8c [Fix W5, N4] — pre-generation validation.
 *
 * Returns one or more warnings per scene. 🔴 = blocker (button disabled),
 * 🟡 = warning (user can proceed via confirm dialog).
 */
export type SceneWarningLevel = 'block' | 'warn';

export interface SceneWarning {
  sceneId: string;
  level: SceneWarningLevel;
  code: string;
  message: string;
}

export interface ValidateInput {
  story: Pick<StoryRecord, 'characters'>;
  scenes: SceneRecord[];
  characters: CharacterRecord[];
}

export function validateScenesForGeneration(input: ValidateInput): SceneWarning[] {
  const charMap = new Map(input.characters.map((c) => [c.id, c]));
  const storyCharSet = new Set(input.story.characters);
  const out: SceneWarning[] = [];

  for (const scene of input.scenes) {
    const isVoice = scene.audio_type === 'voiceover' || scene.audio_type === 'lipsync';

    if (isVoice) {
      if (scene.speaking_character_id === null) {
        out.push({
          sceneId: scene.id,
          level: 'block',
          code: 'no-speaking-character',
          message: 'Kein Charakter zugewiesen'
        });
      } else {
        const character = charMap.get(scene.speaking_character_id);
        if (!character || !storyCharSet.has(scene.speaking_character_id)) {
          out.push({
            sceneId: scene.id,
            level: 'block',
            code: 'speaking-character-not-in-story',
            message:
              'Sprechender Charakter nicht mehr in Story — bitte ersetzen'
          });
        } else if (character.voice_id === null) {
          out.push({
            sceneId: scene.id,
            level: 'block',
            code: 'no-voice-id',
            message:
              'Charakter hat keine Stimme — bitte im Character Manager ergänzen'
          });
        } else if (character.voice_provider === 'azure') {
          out.push({
            sceneId: scene.id,
            level: 'block',
            code: 'azure-tts-not-implemented',
            message:
              'Azure TTS nicht implementiert — bitte auf Edge oder ElevenLabs wechseln (v0.2)'
          });
        }
      }
      if (scene.tts_text === null || scene.tts_text === '') {
        out.push({
          sceneId: scene.id,
          level: 'warn',
          code: 'no-tts-text',
          message: 'Kein Sprechtext vorhanden'
        });
      }
    }

    if (scene.type !== 'endcard' && (scene.image_prompt === null || scene.image_prompt === '')) {
      out.push({
        sceneId: scene.id,
        level: 'warn',
        code: 'no-image-prompt',
        message: 'Kein Bild-Prompt — Sonnet-Generierung ausführen'
      });
    }
  }

  return out;
}

export function hasBlockers(warnings: SceneWarning[]): boolean {
  return warnings.some((w) => w.level === 'block');
}

export function warningsByScene(
  warnings: SceneWarning[]
): Map<string, SceneWarning[]> {
  const m = new Map<string, SceneWarning[]>();
  for (const w of warnings) {
    const arr = m.get(w.sceneId);
    if (arr) arr.push(w);
    else m.set(w.sceneId, [w]);
  }
  return m;
}
