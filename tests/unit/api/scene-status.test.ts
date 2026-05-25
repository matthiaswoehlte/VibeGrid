// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SceneRecord, StoryRecord } from '@/lib/sceneflow/types';

const patchSceneRenderMock = vi.fn();
const setNeutralVideoUrlAndClaimLipsyncMock = vi.fn();
const loadSceneByIdMock = vi.fn();
const falUrlToR2Mock = vi.fn();
const getJobStatusMock = vi.fn();
const getVideoJobResultMock = vi.fn();
const submitLipSyncJobMock = vi.fn();
const submitMuseTalkJobMock = vi.fn();

vi.mock('@/lib/sceneflow/scenes-db', () => ({
  patchSceneRender: (...a: unknown[]) => patchSceneRenderMock(...a),
  setNeutralVideoUrlAndClaimLipsync: (...a: unknown[]) =>
    setNeutralVideoUrlAndClaimLipsyncMock(...a),
  loadSceneById: (...a: unknown[]) => loadSceneByIdMock(...a)
}));
vi.mock('@/lib/sceneflow/fal-to-r2', () => ({
  uploadAssetToR2: vi.fn(),
  falUrlToR2: (...a: unknown[]) => falUrlToR2Mock(...a)
}));
vi.mock('@/lib/sceneflow/tts', () => ({ synthesizeForCharacter: vi.fn() }));
vi.mock('@/lib/fal/client', () => ({
  generateImage: vi.fn(),
  submitVideoJob: vi.fn(),
  submitLipSyncJob: (...a: unknown[]) => submitLipSyncJobMock(...a),
  submitMuseTalkJob: (...a: unknown[]) => submitMuseTalkJobMock(...a),
  getJobStatus: (...a: unknown[]) => getJobStatusMock(...a),
  getVideoJobResult: (...a: unknown[]) => getVideoJobResultMock(...a),
  storyFormatToImageSize: () => 'landscape_16_9'
}));

beforeEach(() => {
  patchSceneRenderMock.mockReset();
  setNeutralVideoUrlAndClaimLipsyncMock.mockReset();
  loadSceneByIdMock.mockReset();
  falUrlToR2Mock.mockReset();
  getJobStatusMock.mockReset();
  getVideoJobResultMock.mockReset();
  submitLipSyncJobMock.mockReset();
  submitMuseTalkJobMock.mockReset();
});

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
    tts_text: 'hi',
    speaking_character_id: 'c-1',
    transition: 'last-frame',
    start_frame_mode: 'auto',
    start_frame_url: null,
    image_url: 'https://cdn/img.jpg',
    video_url: null,
    audio_url: 'https://cdn/a.mp3',
    neutral_video_url: null,
    end_frame_url: null,
    status: 'generating',
    error_message: null,
    fal_request_ids: null,
    created_at: '',
    updated_at: '',
    ...overrides
  };
}

const story: StoryRecord = {
  id: 'st-1',
  user_id: 'u-1',
  title: 't',
  format: '16:9',
  visual_style: null,
  status: 'generating',
  characters: ['c-1'],
  story_text: null,
  image_model: 'fal-ai/flux/dev',
  video_model: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
  lipsync_model: 'fal-ai/sync-lipsync/v3',
  credit_budget: null,
  sync_audio_url: null,
  sync_audio_bpm: null,
  snap_mode: 'beat',
  created_at: '',
  updated_at: ''
};

describe('advanceSceneRender — Fix N1 auto-enqueue lipsync', () => {
  it('Dialog: neutral_video COMPLETED → mirror to R2 + auto-enqueue lipsync (claimed)', async () => {
    const sc = scene({ fal_request_ids: { neutral_video: 'req-neutral' } });
    getJobStatusMock.mockResolvedValueOnce('COMPLETED');
    getVideoJobResultMock.mockResolvedValueOnce('https://fal.media/nv.mp4');
    falUrlToR2Mock.mockResolvedValueOnce('https://cdn/sc-1/neutral-video.mp4');
    setNeutralVideoUrlAndClaimLipsyncMock.mockResolvedValueOnce(true);
    loadSceneByIdMock.mockResolvedValueOnce({
      ...sc,
      neutral_video_url: 'https://cdn/sc-1/neutral-video.mp4'
    });
    submitLipSyncJobMock.mockResolvedValueOnce('req-lipsync');
    patchSceneRenderMock.mockResolvedValue(true);

    const { advanceSceneRender } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const out = await advanceSceneRender({ scene: sc, story });

    expect(setNeutralVideoUrlAndClaimLipsyncMock).toHaveBeenCalledWith({
      sceneId: 'sc-1',
      neutralVideoUrl: 'https://cdn/sc-1/neutral-video.mp4'
    });
    expect(submitLipSyncJobMock).toHaveBeenCalledWith({
      videoUrl: 'https://cdn/sc-1/neutral-video.mp4',
      audioUrl: 'https://cdn/a.mp3'
    });
    expect(patchSceneRenderMock).toHaveBeenCalledWith(
      'sc-1',
      expect.objectContaining({
        fal_request_ids: expect.objectContaining({ lipsync: 'req-lipsync' })
      })
    );
    expect(out.neutralVideoUrl).toBe('https://cdn/sc-1/neutral-video.mp4');
  });

  it('Idempotency: if another poller already claimed lipsync slot, no second submit', async () => {
    const sc = scene({ fal_request_ids: { neutral_video: 'req-neutral' } });
    getJobStatusMock.mockResolvedValueOnce('COMPLETED');
    getVideoJobResultMock.mockResolvedValueOnce('https://fal.media/nv.mp4');
    falUrlToR2Mock.mockResolvedValueOnce('https://cdn/sc-1/neutral-video.mp4');
    setNeutralVideoUrlAndClaimLipsyncMock.mockResolvedValueOnce(false);
    patchSceneRenderMock.mockResolvedValue(true);

    const { advanceSceneRender } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    await advanceSceneRender({ scene: sc, story });
    expect(submitLipSyncJobMock).not.toHaveBeenCalled();
  });

  it('IN_PROGRESS short-circuits without R2 upload or submit', async () => {
    const sc = scene({ fal_request_ids: { neutral_video: 'req-neutral' } });
    getJobStatusMock.mockResolvedValueOnce('IN_PROGRESS');

    const { advanceSceneRender } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const out = await advanceSceneRender({ scene: sc, story });
    expect(falUrlToR2Mock).not.toHaveBeenCalled();
    expect(submitLipSyncJobMock).not.toHaveBeenCalled();
    expect(out.step).toBe('neutral_video');
  });
});

describe('advanceSceneRender — Action scene final video', () => {
  it('Action COMPLETED → mirror video to R2 + status=done', async () => {
    const sc = scene({
      type: 'action',
      audio_type: 'none',
      tts_text: null,
      speaking_character_id: null,
      fal_request_ids: { video: 'req-kling' }
    });
    getJobStatusMock.mockResolvedValueOnce('COMPLETED');
    getVideoJobResultMock.mockResolvedValueOnce('https://fal.media/v.mp4');
    falUrlToR2Mock.mockResolvedValueOnce('https://cdn/sc-1/video.mp4');
    patchSceneRenderMock.mockResolvedValue(true);

    const { advanceSceneRender } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const out = await advanceSceneRender({ scene: sc, story });
    expect(patchSceneRenderMock).toHaveBeenCalledWith(
      'sc-1',
      { video_url: 'https://cdn/sc-1/video.mp4', status: 'done' },
      { onlyIfNull: true }
    );
    expect(out.videoUrl).toBe('https://cdn/sc-1/video.mp4');
    expect(out.step).toBe('done');
  });
});
