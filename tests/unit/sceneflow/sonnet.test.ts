import { describe, it, expect, vi, beforeEach } from 'vitest';

const { messagesCreate } = vi.hoisted(() => ({ messagesCreate: vi.fn() }));
vi.mock('@/lib/ai/anthropic', () => ({
  getAnthropicClient: () => ({ messages: { create: messagesCreate } })
}));
vi.mock('@/lib/ai/env', () => ({
  getAnthropicConfig: () => ({ apiKey: 'test', model: 'claude-sonnet-4-6' })
}));

import { generateScenesViaSonnet, coerceSonnetScenes } from '@/lib/sceneflow/sonnet';

beforeEach(() => messagesCreate.mockReset());

const stubResponse = (scenes: unknown[]) => ({
  content: [
    {
      type: 'tool_use',
      name: 'submit_scenes',
      input: { scenes }
    }
  ],
  usage: { input_tokens: 100, output_tokens: 200 }
});

describe('sonnet.generateScenesViaSonnet', () => {
  it('extracts tool_use input correctly + sets tool_choice', async () => {
    messagesCreate.mockResolvedValueOnce(
      stubResponse([
        {
          scene_order: 1,
          type: 'action',
          image_prompt: 'a',
          motion_prompt: 'm',
          camera_control: { zoom: 0, panX: 0, panY: 0, motionIntensity: 5 },
          duration: 5,
          audio_type: 'none',
          transition: 'last-frame',
          start_frame_mode: 'auto'
        }
      ])
    );
    const res = await generateScenesViaSonnet({
      storyText: 'A short story',
      story: {
        id: 's',
        user_id: 'u',
        title: 't',
        format: '16:9',
        visual_style: null,
        status: 'draft',
        characters: [],
        story_text: 'A short story',
        image_model: 'fal-ai/flux/dev',
        video_model: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
        lipsync_model: 'fal-ai/sync-lipsync/v3',
        credit_budget: null,
        created_at: '',
        updated_at: ''
      },
      characters: []
    });
    expect(res.scenes).toHaveLength(1);
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: 'tool', name: 'submit_scenes' }
      })
    );
  });

  it('throws when Sonnet does not call submit_scenes (text-only response)', async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Sorry, cannot help' }],
      usage: { input_tokens: 50, output_tokens: 10 }
    });
    await expect(
      generateScenesViaSonnet({
        storyText: 'x',
        story: {
          id: 's',
          user_id: 'u',
          title: 't',
          format: '16:9',
          visual_style: null,
          status: 'draft',
          characters: [],
          story_text: 'x',
          image_model: 'fal-ai/flux/dev',
          video_model: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
          lipsync_model: 'fal-ai/sync-lipsync/v3',
          credit_budget: null,
          created_at: '',
          updated_at: ''
        },
        characters: []
      })
    ).rejects.toThrow(/did not call submit_scenes/);
  });
});

describe('sonnet.coerceSonnetScenes', () => {
  it('null-out speaking_character_id when not in character list', () => {
    const scenes = coerceSonnetScenes(
      [
        {
          scene_order: 1,
          type: 'dialog',
          image_prompt: 'a',
          motion_prompt: 'm',
          camera_control: { zoom: 0, panX: 0, panY: 0, motionIntensity: 5 },
          duration: 5,
          audio_type: 'voiceover',
          tts_text: 'hi',
          speaking_character_id: 'hallucinated-uuid',
          transition: 'last-frame',
          start_frame_mode: 'auto'
        }
      ],
      [{ id: 'real-c-1' }]
    );
    expect(scenes[0]!.speaking_character_id).toBe(null);
  });

  it('clamps duration to [1, 8]', () => {
    const scenes = coerceSonnetScenes(
      [
        {
          scene_order: 1,
          type: 'action',
          image_prompt: 'a',
          motion_prompt: 'm',
          camera_control: null,
          duration: 99,
          audio_type: 'none',
          transition: 'last-frame',
          start_frame_mode: 'auto'
        }
      ],
      []
    );
    expect(scenes[0]!.duration).toBe(8);
  });

  it('clamps camera_control values', () => {
    const scenes = coerceSonnetScenes(
      [
        {
          scene_order: 1,
          type: 'action',
          image_prompt: 'a',
          motion_prompt: 'm',
          camera_control: { zoom: 99, panX: -99, panY: 0, motionIntensity: 50 },
          duration: 5,
          audio_type: 'none',
          transition: 'last-frame',
          start_frame_mode: 'auto'
        }
      ],
      []
    );
    expect(scenes[0]!.camera_control).toEqual({
      zoom: 5,
      panX: -5,
      panY: 0,
      motionIntensity: 10
    });
  });

  it('renumbers scene_order to 1,2,3 even if Sonnet gives gaps', () => {
    const scenes = coerceSonnetScenes(
      [
        {
          scene_order: 5,
          type: 'action',
          image_prompt: 'a',
          motion_prompt: '',
          camera_control: null,
          duration: 5,
          audio_type: 'none',
          transition: 'cut',
          start_frame_mode: 'auto'
        },
        {
          scene_order: 99,
          type: 'endcard',
          image_prompt: '',
          motion_prompt: '',
          camera_control: null,
          duration: 3,
          audio_type: 'none',
          transition: 'crossfade',
          start_frame_mode: 'from-previous'
        }
      ],
      []
    );
    expect(scenes.map((s) => s.scene_order)).toEqual([1, 2]);
  });

  it('forces tts_text=null + speaking_character_id=null when audio_type=none', () => {
    const scenes = coerceSonnetScenes(
      [
        {
          scene_order: 1,
          type: 'action',
          image_prompt: 'a',
          motion_prompt: '',
          camera_control: null,
          duration: 5,
          audio_type: 'none',
          tts_text: 'leftover',
          speaking_character_id: 'real-c-1',
          transition: 'cut',
          start_frame_mode: 'auto'
        }
      ],
      [{ id: 'real-c-1' }]
    );
    expect(scenes[0]!.tts_text).toBe(null);
    expect(scenes[0]!.speaking_character_id).toBe(null);
  });
});
