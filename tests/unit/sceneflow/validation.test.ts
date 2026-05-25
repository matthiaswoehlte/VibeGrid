import { describe, it, expect } from 'vitest';
import {
  validateScenesForGeneration,
  hasBlockers,
  warningsByScene
} from '@/lib/sceneflow/validation';
import type { CharacterRecord, SceneRecord, StoryRecord } from '@/lib/sceneflow/types';

function scene(overrides: Partial<SceneRecord> = {}): SceneRecord {
  return {
    id: 'sc-1',
    story_id: 'st-1',
    scene_order: 1,
    type: 'dialog',
    image_prompt: 'an image',
    motion_prompt: null,
    camera_control: null,
    duration: 5,
    audio_type: 'lipsync',
    tts_text: 'hello',
    speaking_character_id: 'c-1',
    transition: 'last-frame',
    start_frame_mode: 'auto',
    start_frame_url: null,
    image_url: null,
    video_url: null,
    audio_url: null,
    neutral_video_url: null,
    end_frame_url: null,
    status: 'pending',
    error_message: null,
    fal_request_ids: null,
    created_at: '',
    updated_at: '',
    ...overrides
  };
}

function character(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: 'c-1',
    user_id: 'u-1',
    name: 'Alice',
    type: 'person',
    reference_image_url: null,
    voice_provider: 'edge',
    voice_id: 'de-DE-Killian',
    voice_test_text: null,
    image_prompt: null,
    created_at: '',
    updated_at: '',
    ...overrides
  };
}

const story: Pick<StoryRecord, 'characters'> = { characters: ['c-1'] };

describe('validateScenesForGeneration — [Fix W5, N4]', () => {
  it('happy path with full data produces no warnings', () => {
    const w = validateScenesForGeneration({
      story,
      scenes: [scene()],
      characters: [character()]
    });
    expect(w).toEqual([]);
  });

  it('speaking_character_id not in story.characters → block', () => {
    const w = validateScenesForGeneration({
      story: { characters: ['other'] },
      scenes: [scene()],
      characters: [character()]
    });
    expect(w.find((x) => x.code === 'speaking-character-not-in-story')).toMatchObject({
      level: 'block'
    });
  });

  it('voice_id === null → block', () => {
    const w = validateScenesForGeneration({
      story,
      scenes: [scene()],
      characters: [character({ voice_id: null })]
    });
    expect(w.find((x) => x.code === 'no-voice-id')).toMatchObject({
      level: 'block'
    });
  });

  it('voice_provider === "azure" → block', () => {
    const w = validateScenesForGeneration({
      story,
      scenes: [scene()],
      characters: [character({ voice_provider: 'azure' })]
    });
    expect(w.find((x) => x.code === 'azure-tts-not-implemented')).toMatchObject({
      level: 'block'
    });
  });

  it('null speaking_character_id on dialog → block', () => {
    const w = validateScenesForGeneration({
      story,
      scenes: [scene({ speaking_character_id: null })],
      characters: [character()]
    });
    expect(w.find((x) => x.code === 'no-speaking-character')).toMatchObject({
      level: 'block'
    });
  });

  it('image_prompt missing on non-endcard → warn (🟡)', () => {
    const w = validateScenesForGeneration({
      story,
      scenes: [scene({ type: 'action', audio_type: 'none', image_prompt: null })],
      characters: [character()]
    });
    expect(w.find((x) => x.code === 'no-image-prompt')).toMatchObject({
      level: 'warn'
    });
  });

  it('tts_text missing on dialog → warn (🟡)', () => {
    const w = validateScenesForGeneration({
      story,
      scenes: [scene({ tts_text: null })],
      characters: [character()]
    });
    expect(w.find((x) => x.code === 'no-tts-text')).toMatchObject({
      level: 'warn'
    });
  });

  it('endcards do not require image_prompt', () => {
    const w = validateScenesForGeneration({
      story,
      scenes: [scene({ type: 'endcard', audio_type: 'none', image_prompt: null })],
      characters: []
    });
    expect(w).toEqual([]);
  });
});

describe('hasBlockers + warningsByScene helpers', () => {
  it('hasBlockers returns true when any warning is level: block', () => {
    expect(
      hasBlockers([
        { sceneId: 's', level: 'warn', code: 'x', message: 'y' },
        { sceneId: 's', level: 'block', code: 'z', message: 'q' }
      ])
    ).toBe(true);
    expect(
      hasBlockers([{ sceneId: 's', level: 'warn', code: 'x', message: 'y' }])
    ).toBe(false);
  });

  it('warningsByScene groups by scene id', () => {
    const m = warningsByScene([
      { sceneId: 'a', level: 'warn', code: '1', message: 'm1' },
      { sceneId: 'a', level: 'block', code: '2', message: 'm2' },
      { sceneId: 'b', level: 'warn', code: '3', message: 'm3' }
    ]);
    expect(m.get('a')?.length).toBe(2);
    expect(m.get('b')?.length).toBe(1);
  });
});
