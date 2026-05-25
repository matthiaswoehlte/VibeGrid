import { describe, it, expect } from 'vitest';
import { estimatePhase1Cost, estimatePhase2Cost } from '@/lib/credits/estimator';
import type {
  CharacterRecord,
  SceneRecord,
  StoryRecord
} from '@/lib/sceneflow/types';

function scene(overrides: Partial<SceneRecord> = {}): SceneRecord {
  return {
    id: 'sc',
    story_id: 'st',
    scene_order: 1,
    type: 'action',
    image_prompt: 'x',
    motion_prompt: null,
    camera_control: null,
    duration: 5,
    audio_type: 'none',
    tts_text: null,
    speaking_character_id: null,
    transition: 'cut',
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

function story(overrides: Partial<StoryRecord> = {}): StoryRecord {
  return {
    id: 'st',
    user_id: 'u',
    title: 't',
    format: '16:9',
    visual_style: null,
    status: 'draft',
    characters: [],
    story_text: null,
    image_model: 'fal-ai/flux/dev',
    video_model: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    lipsync_model: 'fal-ai/sync-lipsync/v3',
    credit_budget: null,
    sync_audio_url: null,
    sync_audio_bpm: null,
    snap_mode: 'beat',
    created_at: '',
    updated_at: '',
    ...overrides
  };
}

function character(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: 'c',
    user_id: 'u',
    name: 'A',
    type: 'person',
    reference_image_url: null,
    voice_provider: 'elevenlabs',
    voice_id: 'v',
    voice_test_text: null,
    image_prompt: null,
    created_at: '',
    updated_at: '',
    ...overrides
  };
}

describe('estimatePhase1Cost', () => {
  it('2 dialog (ElevenLabs) + 1 action → image*3 + tts*2, with 10% pad', () => {
    const scenes = [
      scene({
        id: 's1',
        type: 'dialog',
        audio_type: 'lipsync',
        speaking_character_id: 'c'
      }),
      scene({
        id: 's2',
        type: 'dialog',
        audio_type: 'lipsync',
        speaking_character_id: 'c'
      }),
      scene({ id: 's3', type: 'action', audio_type: 'none' })
    ];
    // raw = 3*3 (images) + 2*2 (eleven tts) = 13; pad → ceil(13*1.1)=15
    expect(estimatePhase1Cost(scenes, story(), [character()])).toBe(15);
  });

  it('Edge TTS is free (counts only image cost)', () => {
    const scenes = [
      scene({
        id: 's1',
        type: 'dialog',
        audio_type: 'voiceover',
        speaking_character_id: 'c'
      })
    ];
    // raw = 3 (image) + 0 (edge) = 3; pad → 4
    expect(
      estimatePhase1Cost(scenes, story(), [
        character({ voice_provider: 'edge' })
      ])
    ).toBe(4);
  });

  it('endcards are free in Phase 1 (no FLUX call)', () => {
    const scenes = [scene({ type: 'endcard' })];
    expect(estimatePhase1Cost(scenes, story(), [])).toBe(0);
  });

  it('character missing from list → no audio cost charged', () => {
    const scenes = [
      scene({
        type: 'dialog',
        audio_type: 'lipsync',
        speaking_character_id: 'missing'
      })
    ];
    expect(estimatePhase1Cost(scenes, story(), [])).toBe(
      Math.ceil(3 * 1.1) // just the image
    );
  });
});

describe('estimatePhase2Cost', () => {
  it('action 5s → 90 (pad 99)', () => {
    expect(
      estimatePhase2Cost([scene({ type: 'action', duration: 5 })], story())
    ).toBe(99);
  });

  it('dialog 5s sync-lipsync → 90+40=130 → pad 143', () => {
    expect(
      estimatePhase2Cost(
        [scene({ type: 'dialog', duration: 5 })],
        story({ lipsync_model: 'fal-ai/sync-lipsync/v3' })
      )
    ).toBe(143);
  });

  it('dialog 5s musetalk → 90+55=145 → pad 160', () => {
    expect(
      estimatePhase2Cost(
        [scene({ type: 'dialog', duration: 5 })],
        story({ lipsync_model: 'fal-ai/musetalk' })
      )
    ).toBe(160);
  });

  it('action 8s → kling_video_10s bracket (155) → pad 171', () => {
    expect(
      estimatePhase2Cost([scene({ type: 'action', duration: 8 })], story())
    ).toBe(171);
  });

  it('endcard → 0', () => {
    expect(estimatePhase2Cost([scene({ type: 'endcard' })], story())).toBe(0);
  });
});
