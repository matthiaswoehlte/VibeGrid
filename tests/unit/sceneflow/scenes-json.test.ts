// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  serializeScenesToEnvelope,
  parseScenesEnvelope,
  portableToNewSceneInputs,
  ScenesImportError
} from '@/lib/sceneflow/scenes-json';
import type { CharacterRecord, SceneRecord } from '@/lib/sceneflow/types';

function scene(overrides: Partial<SceneRecord> = {}): SceneRecord {
  return {
    id: 'sc-1',
    story_id: 'st-1',
    scene_order: 1,
    type: 'action',
    image_prompt: 'cinematic shot',
    motion_prompt: 'push in',
    camera_control: { zoom: 2.5, panX: 0, panY: 0, motionIntensity: 3 },
    duration: 5,
    audio_type: 'none',
    tts_text: null,
    speaking_character_id: null,
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
    id: 'c-rider',
    user_id: 'u',
    name: 'Rider',
    type: 'person',
    reference_image_url: null,
    voice_provider: 'edge',
    voice_id: 'de-DE-K',
    voice_test_text: null,
    image_prompt: null,
    created_at: '',
    updated_at: '',
    ...overrides
  };
}

describe('serializeScenesToEnvelope', () => {
  it('builds the Anthropic envelope shape with content[0].input.scenes', () => {
    const env = serializeScenesToEnvelope({
      scenes: [scene()],
      characters: []
    });
    expect(env.type).toBe('message');
    expect(env.role).toBe('assistant');
    expect(env.stop_reason).toBe('tool_use');
    expect(env.content).toHaveLength(1);
    expect(env.content[0].type).toBe('tool_use');
    expect(env.content[0].name).toBe('submit_scenes');
    expect(env.content[0].input.scenes).toHaveLength(1);
  });

  it('maps speaking_character_id → name for portability', () => {
    const env = serializeScenesToEnvelope({
      scenes: [
        scene({
          type: 'dialog',
          audio_type: 'lipsync',
          tts_text: 'Hi',
          speaking_character_id: 'c-rider'
        })
      ],
      characters: [character()]
    });
    expect(env.content[0].input.scenes[0]!.speaking_character).toBe('Rider');
  });

  it('null speaking_character_id stays null in export', () => {
    const env = serializeScenesToEnvelope({
      scenes: [scene()],
      characters: []
    });
    expect(env.content[0].input.scenes[0]!.speaking_character).toBeNull();
  });

  it('unknown speaking_character_id (no matching character) → null in export', () => {
    const env = serializeScenesToEnvelope({
      scenes: [
        scene({
          type: 'dialog',
          audio_type: 'lipsync',
          tts_text: 'Hi',
          speaking_character_id: 'c-ghost'
        })
      ],
      characters: [character()] // 'c-rider' only
    });
    expect(env.content[0].input.scenes[0]!.speaking_character).toBeNull();
  });

  it('sorts scenes by scene_order', () => {
    const env = serializeScenesToEnvelope({
      scenes: [
        scene({ id: 'a', scene_order: 3 }),
        scene({ id: 'b', scene_order: 1 }),
        scene({ id: 'c', scene_order: 2 })
      ],
      characters: []
    });
    expect(env.content[0].input.scenes.map((s) => s.scene_order)).toEqual([
      1, 2, 3
    ]);
  });
});

describe('parseScenesEnvelope — tolerant input formats', () => {
  it('accepts the full Anthropic envelope', () => {
    const envelope = {
      id: 'msg_x',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          name: 'create_storyboard', // tool name doesn't matter
          input: {
            scenes: [
              {
                scene_order: 1,
                type: 'action',
                image_prompt: 'x',
                motion_prompt: 'y',
                camera_control: null,
                duration: 5,
                audio_type: 'none',
                tts_text: null,
                speaking_character: null,
                transition: 'cut',
                start_frame_mode: 'auto'
              }
            ]
          }
        }
      ]
    };
    const parsed = parseScenesEnvelope({
      envelope,
      storyCharacterNames: []
    });
    expect(parsed.scenes).toHaveLength(1);
    expect(parsed.unknownCharacterNames).toEqual([]);
  });

  it('accepts a { scenes: [...] } wrapper', () => {
    const parsed = parseScenesEnvelope({
      envelope: {
        scenes: [
          {
            scene_order: 1,
            type: 'endcard',
            image_prompt: '',
            motion_prompt: '',
            camera_control: null,
            duration: 4,
            audio_type: 'none',
            tts_text: null,
            speaking_character: null,
            transition: 'cut',
            start_frame_mode: 'auto'
          }
        ]
      },
      storyCharacterNames: []
    });
    expect(parsed.scenes).toHaveLength(1);
    expect(parsed.scenes[0]!.type).toBe('endcard');
  });

  it('accepts a bare scenes array', () => {
    const parsed = parseScenesEnvelope({
      envelope: [
        {
          scene_order: 1,
          type: 'action',
          image_prompt: 'x',
          motion_prompt: '',
          camera_control: null,
          duration: 5,
          audio_type: 'none',
          tts_text: null,
          speaking_character: null,
          transition: 'cut',
          start_frame_mode: 'auto'
        }
      ],
      storyCharacterNames: []
    });
    expect(parsed.scenes).toHaveLength(1);
  });

  it('throws ScenesImportError on garbage input', () => {
    expect(() =>
      parseScenesEnvelope({
        envelope: { foo: 'bar' },
        storyCharacterNames: []
      })
    ).toThrow(ScenesImportError);
  });

  it('flags unknown speaking_character names', () => {
    const parsed = parseScenesEnvelope({
      envelope: {
        scenes: [
          {
            scene_order: 1,
            type: 'dialog',
            image_prompt: 'x',
            motion_prompt: '',
            camera_control: null,
            duration: 5,
            audio_type: 'lipsync',
            tts_text: 'Hi',
            speaking_character: 'Ghost',
            transition: 'last-frame',
            start_frame_mode: 'auto'
          }
        ]
      },
      storyCharacterNames: ['Rider']
    });
    expect(parsed.unknownCharacterNames).toEqual(['Ghost']);
  });

  it('clamps duration to [1, 8]', () => {
    const parsed = parseScenesEnvelope({
      envelope: {
        scenes: [
          {
            scene_order: 1,
            type: 'action',
            image_prompt: 'x',
            motion_prompt: '',
            camera_control: null,
            duration: 999,
            audio_type: 'none',
            tts_text: null,
            speaking_character: null,
            transition: 'cut',
            start_frame_mode: 'auto'
          }
        ]
      },
      storyCharacterNames: []
    });
    expect(parsed.scenes[0]!.duration).toBe(8);
  });
});

describe('portableToNewSceneInputs', () => {
  it('maps speaking_character name → speaking_character_id UUID', () => {
    const portable = parseScenesEnvelope({
      envelope: {
        scenes: [
          {
            scene_order: 1,
            type: 'dialog',
            image_prompt: 'x',
            motion_prompt: '',
            camera_control: null,
            duration: 5,
            audio_type: 'lipsync',
            tts_text: 'Hi',
            speaking_character: 'Rider',
            transition: 'last-frame',
            start_frame_mode: 'auto'
          }
        ]
      },
      storyCharacterNames: ['Rider']
    }).scenes;
    const inputs = portableToNewSceneInputs(portable, [character()]);
    expect(inputs[0]!.speaking_character_id).toBe('c-rider');
  });

  it('unknown name → speaking_character_id null', () => {
    const portable = parseScenesEnvelope({
      envelope: {
        scenes: [
          {
            scene_order: 1,
            type: 'dialog',
            image_prompt: 'x',
            motion_prompt: '',
            camera_control: null,
            duration: 5,
            audio_type: 'lipsync',
            tts_text: 'Hi',
            speaking_character: 'Ghost',
            transition: 'last-frame',
            start_frame_mode: 'auto'
          }
        ]
      },
      storyCharacterNames: []
    }).scenes;
    const inputs = portableToNewSceneInputs(portable, [character()]);
    expect(inputs[0]!.speaking_character_id).toBeNull();
  });

  it('audio_type none forces tts_text + speaking_character_id to null', () => {
    const portable = parseScenesEnvelope({
      envelope: {
        scenes: [
          {
            scene_order: 1,
            type: 'action',
            image_prompt: 'x',
            motion_prompt: '',
            camera_control: null,
            duration: 5,
            audio_type: 'none',
            tts_text: 'leftover',
            speaking_character: 'Rider',
            transition: 'cut',
            start_frame_mode: 'auto'
          }
        ]
      },
      storyCharacterNames: ['Rider']
    }).scenes;
    const inputs = portableToNewSceneInputs(portable, [character()]);
    expect(inputs[0]!.tts_text).toBeNull();
    expect(inputs[0]!.speaking_character_id).toBeNull();
  });

  it('renumbers scene_order to 1..N even if input has gaps', () => {
    const portable = parseScenesEnvelope({
      envelope: {
        scenes: [
          {
            scene_order: 7,
            type: 'action',
            image_prompt: 'a',
            motion_prompt: '',
            camera_control: null,
            duration: 5,
            audio_type: 'none',
            tts_text: null,
            speaking_character: null,
            transition: 'cut',
            start_frame_mode: 'auto'
          },
          {
            scene_order: 11,
            type: 'endcard',
            image_prompt: 'b',
            motion_prompt: '',
            camera_control: null,
            duration: 4,
            audio_type: 'none',
            tts_text: null,
            speaking_character: null,
            transition: 'cut',
            start_frame_mode: 'auto'
          }
        ]
      },
      storyCharacterNames: []
    }).scenes;
    const inputs = portableToNewSceneInputs(portable, []);
    expect(inputs.map((s) => s.scene_order)).toEqual([1, 2]);
  });
});

describe('demo file — ignition_storyboard.json', () => {
  it('parses the full 8-scene ignition demo and resolves Rider', async () => {
    const { readFileSync } = await import('node:fs');
    const raw = JSON.parse(
      readFileSync(
        'docs/Tests/Demoszene/ignition_storyboard.json',
        'utf8'
      )
    );
    const parsed = parseScenesEnvelope({
      envelope: raw,
      storyCharacterNames: ['Rider']
    });
    expect(parsed.scenes).toHaveLength(8);
    expect(parsed.unknownCharacterNames).toEqual([]);
    // Scene 5 is the dialog with Rider
    const dialog = parsed.scenes.find((s) => s.type === 'dialog');
    expect(dialog?.speaking_character).toBe('Rider');
    expect(dialog?.tts_text).toBe('Das war erst der Anfang.');
    // Endcard at the end
    expect(parsed.scenes[parsed.scenes.length - 1]!.type).toBe('endcard');

    // Convert to NewSceneInput[] with the character mapping
    const inputs = portableToNewSceneInputs(parsed.scenes, [
      {
        id: 'rider-uuid',
        user_id: 'u',
        name: 'Rider',
        type: 'person',
        reference_image_url: null,
        voice_provider: 'edge',
        voice_id: 'de-DE-K',
        voice_test_text: null,
        image_prompt: null,
        created_at: '',
        updated_at: ''
      }
    ]);
    const dialogInput = inputs.find((s) => s.type === 'dialog');
    expect(dialogInput?.speaking_character_id).toBe('rider-uuid');
  });
});

describe('roundtrip — export → parse → import-shape', () => {
  it('a dialog scene round-trips through name-based serialization', () => {
    const original = scene({
      type: 'dialog',
      audio_type: 'lipsync',
      tts_text: 'Das war erst der Anfang.',
      speaking_character_id: 'c-rider',
      duration: 6,
      camera_control: { zoom: 1.5, panX: 0, panY: 0, motionIntensity: 2 }
    });
    const env = serializeScenesToEnvelope({
      scenes: [original],
      characters: [character()]
    });
    const parsed = parseScenesEnvelope({
      envelope: env,
      storyCharacterNames: ['Rider']
    });
    expect(parsed.unknownCharacterNames).toEqual([]);
    const inputs = portableToNewSceneInputs(parsed.scenes, [character()]);
    expect(inputs[0]).toMatchObject({
      type: 'dialog',
      audio_type: 'lipsync',
      tts_text: 'Das war erst der Anfang.',
      speaking_character_id: 'c-rider',
      duration: 6
    });
  });
});
