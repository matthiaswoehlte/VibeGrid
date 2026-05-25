import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SceneRecord, StoryRecord } from '@/lib/sceneflow/types';

const patchSceneRenderMock = vi.fn();
const uploadAssetToR2Mock = vi.fn();
const falUrlToR2Mock = vi.fn();
const synthesizeForCharacterMock = vi.fn();
const generateImageMock = vi.fn();
const submitVideoJobMock = vi.fn();
const submitLipSyncJobMock = vi.fn();
const submitMuseTalkJobMock = vi.fn();

vi.mock('@/lib/sceneflow/scenes-db', () => ({
  patchSceneRender: (...args: unknown[]) => patchSceneRenderMock(...args)
}));
vi.mock('@/lib/sceneflow/fal-to-r2', () => ({
  uploadAssetToR2: (...args: unknown[]) => uploadAssetToR2Mock(...args),
  falUrlToR2: (...args: unknown[]) => falUrlToR2Mock(...args)
}));
vi.mock('@/lib/sceneflow/tts', () => ({
  synthesizeForCharacter: (...args: unknown[]) => synthesizeForCharacterMock(...args)
}));
vi.mock('@/lib/fal/client', () => ({
  generateImage: (...args: unknown[]) => generateImageMock(...args),
  submitVideoJob: (...args: unknown[]) => submitVideoJobMock(...args),
  submitLipSyncJob: (...args: unknown[]) => submitLipSyncJobMock(...args),
  submitMuseTalkJob: (...args: unknown[]) => submitMuseTalkJobMock(...args),
  storyFormatToImageSize: (f: string) =>
    f === '16:9'
      ? 'landscape_16_9'
      : f === '9:16'
      ? 'portrait_16_9'
      : 'landscape_4_3'
}));

beforeEach(() => {
  patchSceneRenderMock.mockReset();
  uploadAssetToR2Mock.mockReset();
  falUrlToR2Mock.mockReset();
  synthesizeForCharacterMock.mockReset();
  generateImageMock.mockReset();
  submitVideoJobMock.mockReset();
  submitLipSyncJobMock.mockReset();
  submitMuseTalkJobMock.mockReset();
});

function scene(overrides: Partial<SceneRecord> = {}): SceneRecord {
  return {
    id: 'sc-1',
    story_id: 'st-1',
    scene_order: 1,
    type: 'action',
    image_prompt: 'an image',
    motion_prompt: 'a motion',
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
    id: 'st-1',
    user_id: 'u-1',
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
    created_at: '',
    updated_at: '',
    ...overrides
  };
}

describe('runWithConcurrency', () => {
  it('limits to N parallel and preserves result order', async () => {
    const { runWithConcurrency } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    let active = 0;
    let peakActive = 0;
    const worker = async (n: number): Promise<number> => {
      active++;
      peakActive = Math.max(peakActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    };
    const results = await runWithConcurrency([1, 2, 3, 4, 5, 6], 3, worker);
    expect(peakActive).toBeLessThanOrEqual(3);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([
      2, 4, 6, 8, 10, 12
    ]);
  });
});

describe('generateAndStoreImages — Action scene', () => {
  it('calls FLUX, mirrors to R2, patches image_url', async () => {
    generateImageMock.mockResolvedValueOnce({
      url: 'https://fal.media/img.jpg',
      seed: 1
    });
    falUrlToR2Mock.mockResolvedValueOnce('https://cdn/sc-1/image.jpg');
    patchSceneRenderMock.mockResolvedValue(true);

    const { generateAndStoreImages } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const out = await generateAndStoreImages({
      story: story(),
      scenes: [scene()]
    });
    expect(out).toEqual([
      { sceneId: 'sc-1', ok: true, imageUrl: 'https://cdn/sc-1/image.jpg' }
    ]);
    expect(generateImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'an image',
        imageSize: 'landscape_16_9',
        model: 'fal-ai/flux/dev'
      })
    );
    expect(patchSceneRenderMock).toHaveBeenCalledWith('sc-1', {
      image_url: 'https://cdn/sc-1/image.jpg'
    });
  });

  it('skips endcard scenes entirely', async () => {
    const { generateAndStoreImages } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const out = await generateAndStoreImages({
      story: story(),
      scenes: [scene({ type: 'endcard' })]
    });
    expect(out).toEqual([]);
    expect(generateImageMock).not.toHaveBeenCalled();
  });
});

describe('enqueueVideoJobs — per-type behaviour', () => {
  it('Action scene enqueues Kling video job, no LipSync submit', async () => {
    submitVideoJobMock.mockResolvedValueOnce('req-kling-1');
    patchSceneRenderMock.mockResolvedValue(true);
    const { enqueueVideoJobs } = await import('@/lib/sceneflow/render-pipeline');
    const out = await enqueueVideoJobs({
      story: story(),
      scenes: [scene({ image_url: 'https://cdn/img.jpg' })]
    });
    expect(out).toEqual([
      { sceneId: 'sc-1', ok: true, requestId: 'req-kling-1', step: 'video' }
    ]);
    expect(submitVideoJobMock).toHaveBeenCalledTimes(1);
    expect(submitLipSyncJobMock).not.toHaveBeenCalled();
    expect(patchSceneRenderMock).toHaveBeenCalledWith('sc-1', {
      status: 'generating',
      fal_request_ids: { video: 'req-kling-1' }
    });
  });

  it('Dialog scene enqueues NEUTRAL video first (lipsync deferred to status route)', async () => {
    submitVideoJobMock.mockResolvedValueOnce('req-neutral-1');
    patchSceneRenderMock.mockResolvedValue(true);
    const { enqueueVideoJobs } = await import('@/lib/sceneflow/render-pipeline');
    const out = await enqueueVideoJobs({
      story: story(),
      scenes: [
        scene({
          type: 'dialog',
          audio_type: 'lipsync',
          image_url: 'https://cdn/img.jpg',
          audio_url: 'https://cdn/a.mp3'
        })
      ]
    });
    expect(out[0]).toEqual({
      sceneId: 'sc-1',
      ok: true,
      requestId: 'req-neutral-1',
      step: 'neutral_video'
    });
    expect(submitVideoJobMock).toHaveBeenCalledTimes(1);
    expect(submitLipSyncJobMock).not.toHaveBeenCalled();
    expect(patchSceneRenderMock).toHaveBeenCalledWith('sc-1', {
      status: 'generating',
      fal_request_ids: { neutral_video: 'req-neutral-1' }
    });
  });

  it('Endcard scene short-circuits to status=done — no fal call', async () => {
    patchSceneRenderMock.mockResolvedValue(true);
    const { enqueueVideoJobs } = await import('@/lib/sceneflow/render-pipeline');
    const out = await enqueueVideoJobs({
      story: story(),
      scenes: [scene({ type: 'endcard', image_url: null })]
    });
    expect(out).toEqual([]);
    expect(submitVideoJobMock).not.toHaveBeenCalled();
    expect(patchSceneRenderMock).toHaveBeenCalledWith('sc-1', { status: 'done' });
  });

  it('Dialog with existing neutral_video_url is skipped (idempotent)', async () => {
    const { enqueueVideoJobs } = await import('@/lib/sceneflow/render-pipeline');
    const out = await enqueueVideoJobs({
      story: story(),
      scenes: [
        scene({
          type: 'dialog',
          image_url: 'https://cdn/img.jpg',
          audio_url: 'https://cdn/a.mp3',
          neutral_video_url: 'https://cdn/nv.mp4'
        })
      ]
    });
    expect(out).toEqual([]);
    expect(submitVideoJobMock).not.toHaveBeenCalled();
  });
});

describe('enqueueLipSyncForScene — model dispatch', () => {
  it('sync-lipsync model uses submitLipSyncJob', async () => {
    submitLipSyncJobMock.mockResolvedValueOnce('lipsync-1');
    const { enqueueLipSyncForScene } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const id = await enqueueLipSyncForScene({
      scene: scene({
        type: 'dialog',
        audio_url: 'https://cdn/a.mp3'
      }),
      neutralVideoUrl: 'https://cdn/nv.mp4',
      lipsyncModel: 'fal-ai/sync-lipsync/v3'
    });
    expect(id).toBe('lipsync-1');
    expect(submitLipSyncJobMock).toHaveBeenCalledTimes(1);
    expect(submitMuseTalkJobMock).not.toHaveBeenCalled();
  });

  it('musetalk model uses submitMuseTalkJob', async () => {
    submitMuseTalkJobMock.mockResolvedValueOnce('muse-1');
    const { enqueueLipSyncForScene } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const id = await enqueueLipSyncForScene({
      scene: scene({
        type: 'dialog',
        audio_url: 'https://cdn/a.mp3'
      }),
      neutralVideoUrl: 'https://cdn/nv.mp4',
      lipsyncModel: 'fal-ai/musetalk'
    });
    expect(id).toBe('muse-1');
    expect(submitMuseTalkJobMock).toHaveBeenCalledTimes(1);
    expect(submitLipSyncJobMock).not.toHaveBeenCalled();
  });
});

describe('retry plans — [Fix D5]', () => {
  it('retry-image only resets image_url, neutral_video_url stays', async () => {
    const { planRetryImage, applyRetryPlanPatch } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const sc = scene({
      type: 'dialog',
      image_url: 'https://cdn/old-img.jpg',
      neutral_video_url: 'https://cdn/nv.mp4',
      fal_request_ids: { image: 'old-img-req', neutral_video: 'nv-req' }
    });
    const plan = planRetryImage(sc);
    const patch = applyRetryPlanPatch(sc, plan);
    expect(plan.resetUrls).toEqual(['image_url']);
    expect(patch.image_url).toBeNull();
    expect(patch.neutral_video_url).toBeUndefined(); // not touched
    // neutral_video request_id preserved
    expect(patch.fal_request_ids).toEqual({ neutral_video: 'nv-req' });
  });

  it('retry-video with neutral_video_url present → only LipSync (no Kling)', async () => {
    const { planRetryVideo, applyRetryPlanPatch } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const sc = scene({
      type: 'dialog',
      neutral_video_url: 'https://cdn/nv.mp4',
      video_url: 'https://cdn/v.mp4',
      fal_request_ids: { neutral_video: 'nv-req', lipsync: 'ls-req' }
    });
    const plan = planRetryVideo(sc);
    const patch = applyRetryPlanPatch(sc, plan);
    expect(plan.resetUrls).toEqual(['video_url']);
    expect(plan.clearRequestKeys).toEqual(['lipsync']);
    expect(patch.fal_request_ids).toEqual({ neutral_video: 'nv-req' });
  });

  it('retry-video without neutral_video_url → both Kling + LipSync reset', async () => {
    const { planRetryVideo, applyRetryPlanPatch } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const sc = scene({
      type: 'action',
      video_url: 'https://cdn/v.mp4',
      fal_request_ids: { video: 'v-req' }
    });
    const plan = planRetryVideo(sc);
    const patch = applyRetryPlanPatch(sc, plan);
    expect(plan.resetUrls).toEqual(['video_url', 'neutral_video_url']);
    expect(patch.fal_request_ids).toBeNull();
  });
});

describe('runTtsForScenes', () => {
  it('skips audio_type === "none" scenes entirely', async () => {
    const { runTtsForScenes } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const out = await runTtsForScenes({
      userId: 'u-1',
      storyId: 'st-1',
      scenes: [scene()],
      characters: []
    });
    expect(out).toEqual([]);
    expect(synthesizeForCharacterMock).not.toHaveBeenCalled();
  });

  it('calls synthesize + uploadToR2 + patchSceneRender for a dialog scene', async () => {
    synthesizeForCharacterMock.mockResolvedValue(Buffer.from([1, 2]));
    uploadAssetToR2Mock.mockResolvedValueOnce('https://cdn/audio.mp3');
    patchSceneRenderMock.mockResolvedValue(true);
    const { runTtsForScenes } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const out = await runTtsForScenes({
      userId: 'u-1',
      storyId: 'st-1',
      scenes: [
        scene({
          type: 'dialog',
          audio_type: 'lipsync',
          tts_text: 'hello',
          speaking_character_id: 'c-1'
        })
      ],
      characters: [
        {
          id: 'c-1',
          user_id: 'u-1',
          name: 'A',
          type: 'person',
          reference_image_url: null,
          voice_provider: 'edge',
          voice_id: 'de-DE-K',
          voice_test_text: null,
          image_prompt: null,
          created_at: '',
          updated_at: ''
        }
      ]
    });
    expect(out).toEqual([
      { sceneId: 'sc-1', ok: true, url: 'https://cdn/audio.mp3' }
    ]);
    expect(synthesizeForCharacterMock).toHaveBeenCalled();
    expect(patchSceneRenderMock).toHaveBeenCalledWith('sc-1', {
      audio_url: 'https://cdn/audio.mp3'
    });
  });
});
