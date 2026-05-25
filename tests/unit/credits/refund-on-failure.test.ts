// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SceneRecord, StoryRecord } from '@/lib/sceneflow/types';

const patchSceneRenderMock = vi.fn();
const loadSceneByIdMock = vi.fn();
const setNeutralVideoUrlAndClaimLipsyncMock = vi.fn();
const getJobStatusMock = vi.fn();
const getVideoJobResultMock = vi.fn();
const falUrlToR2Mock = vi.fn();
const submitLipSyncJobMock = vi.fn();

vi.mock('@/lib/sceneflow/scenes-db', () => ({
  patchSceneRender: (...a: unknown[]) => patchSceneRenderMock(...a),
  loadSceneById: (...a: unknown[]) => loadSceneByIdMock(...a),
  setNeutralVideoUrlAndClaimLipsync: (...a: unknown[]) =>
    setNeutralVideoUrlAndClaimLipsyncMock(...a)
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
  submitMuseTalkJob: vi.fn(),
  getJobStatus: (...a: unknown[]) => getJobStatusMock(...a),
  getVideoJobResult: (...a: unknown[]) => getVideoJobResultMock(...a),
  storyFormatToImageSize: () => 'landscape_16_9'
}));

beforeEach(() => {
  patchSceneRenderMock.mockReset();
  loadSceneByIdMock.mockReset();
  setNeutralVideoUrlAndClaimLipsyncMock.mockReset();
  getJobStatusMock.mockReset();
  getVideoJobResultMock.mockReset();
  falUrlToR2Mock.mockReset();
  submitLipSyncJobMock.mockReset();
});

function scene(overrides: Partial<SceneRecord> = {}): SceneRecord {
  return {
    id: 'sc-1',
    story_id: 'st-1',
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
    image_url: 'https://cdn/img.jpg',
    video_url: null,
    audio_url: null,
    neutral_video_url: null,
    end_frame_url: null,
    status: 'generating',
    error_message: null,
    fal_request_ids: { video: 'req-kling-1' },
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
  characters: [],
  story_text: null,
  image_model: 'fal-ai/flux/dev',
  video_model: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
  lipsync_model: 'fal-ai/sync-lipsync/v3',
  credit_budget: null,
  created_at: '',
  updated_at: ''
};

describe('advanceSceneRender — FAILED → refund signal', () => {
  it('fal status FAILED on action scene → status=error, creditEvent=refund', async () => {
    getJobStatusMock.mockResolvedValueOnce('FAILED');
    patchSceneRenderMock.mockResolvedValue(true);
    const { advanceSceneRender } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const out = await advanceSceneRender({ scene: scene(), story });
    expect(out.creditEvent).toBe('refund');
    expect(out.status).toBe('error');
    expect(patchSceneRenderMock).toHaveBeenCalledWith(
      'sc-1',
      expect.objectContaining({ status: 'error', error_message: expect.stringMatching(/failed/) })
    );
    // No R2 upload should have happened
    expect(falUrlToR2Mock).not.toHaveBeenCalled();
  });

  it('simulatedFalStatus="FAILED" injects the failed path (test seam)', async () => {
    patchSceneRenderMock.mockResolvedValue(true);
    const { advanceSceneRender } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const out = await advanceSceneRender({
      scene: scene(),
      story,
      simulatedFalStatus: 'FAILED'
    });
    expect(out.creditEvent).toBe('refund');
    // The real fal status check was bypassed
    expect(getJobStatusMock).not.toHaveBeenCalled();
  });

  it('COMPLETED but patchSceneRender.rowCount === 0 → no creditEvent (other poller won)', async () => {
    getJobStatusMock.mockResolvedValueOnce('COMPLETED');
    getVideoJobResultMock.mockResolvedValueOnce('https://fal.media/v.mp4');
    falUrlToR2Mock.mockResolvedValueOnce('https://cdn/sc-1/video.mp4');
    // patchSceneRender returns false → another poller already claimed
    patchSceneRenderMock.mockResolvedValueOnce(false);
    const { advanceSceneRender } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const out = await advanceSceneRender({ scene: scene(), story });
    expect(out.creditEvent).toBeUndefined();
  });

  it('COMPLETED + first claim → creditEvent=settle', async () => {
    getJobStatusMock.mockResolvedValueOnce('COMPLETED');
    getVideoJobResultMock.mockResolvedValueOnce('https://fal.media/v.mp4');
    falUrlToR2Mock.mockResolvedValueOnce('https://cdn/sc-1/video.mp4');
    patchSceneRenderMock.mockResolvedValueOnce(true);
    const { advanceSceneRender } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const out = await advanceSceneRender({ scene: scene(), story });
    expect(out.creditEvent).toBe('settle');
  });
});

describe('advanceSceneRender — Dialog FAILED branches', () => {
  it('dialog neutral_video FAILED → refund', async () => {
    getJobStatusMock.mockResolvedValueOnce('FAILED');
    patchSceneRenderMock.mockResolvedValue(true);
    const dialogScene = scene({
      type: 'dialog',
      audio_type: 'lipsync',
      audio_url: 'https://cdn/a.mp3',
      fal_request_ids: { neutral_video: 'req-neutral-1' }
    });
    const { advanceSceneRender } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const out = await advanceSceneRender({ scene: dialogScene, story });
    expect(out.creditEvent).toBe('refund');
    expect(setNeutralVideoUrlAndClaimLipsyncMock).not.toHaveBeenCalled();
  });

  it('dialog lipsync FAILED → refund (covers both kling+lipsync reserve)', async () => {
    getJobStatusMock.mockResolvedValueOnce('FAILED');
    patchSceneRenderMock.mockResolvedValue(true);
    const dialogScene = scene({
      type: 'dialog',
      audio_type: 'lipsync',
      audio_url: 'https://cdn/a.mp3',
      neutral_video_url: 'https://cdn/nv.mp4',
      fal_request_ids: {
        neutral_video: 'req-neutral-1',
        lipsync: 'req-lipsync-1'
      }
    });
    const { advanceSceneRender } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const out = await advanceSceneRender({ scene: dialogScene, story });
    expect(out.creditEvent).toBe('refund');
  });
});

describe('Code-side errors do NOT auto-refund', () => {
  it('falUrlToR2 throws → status=error but no creditEvent (user retries explicitly)', async () => {
    getJobStatusMock.mockResolvedValueOnce('COMPLETED');
    getVideoJobResultMock.mockResolvedValueOnce('https://fal.media/v.mp4');
    falUrlToR2Mock.mockRejectedValueOnce(new Error('R2 timeout'));
    patchSceneRenderMock.mockResolvedValue(true);
    const { advanceSceneRender } = await import(
      '@/lib/sceneflow/render-pipeline'
    );
    const out = await advanceSceneRender({ scene: scene(), story });
    expect(out.error).toMatch(/R2 timeout/);
    expect(out.creditEvent).toBeUndefined();
  });
});
