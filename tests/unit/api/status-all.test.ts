// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SceneRecord, StoryRecord } from '@/lib/sceneflow/types';

const getSessionMock = vi.fn();
const loadStoryMock = vi.fn();
const listScenesMock = vi.fn();
const advanceSceneRenderMock = vi.fn();

vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession: (...a: unknown[]) => getSessionMock(...a) } }
}));
vi.mock('@/lib/sceneflow/stories-db', () => ({
  loadStory: (...a: unknown[]) => loadStoryMock(...a)
}));
vi.mock('@/lib/sceneflow/scenes-db', () => ({
  listScenes: (...a: unknown[]) => listScenesMock(...a)
}));
vi.mock('@/lib/sceneflow/render-pipeline', () => ({
  advanceSceneRender: (...a: unknown[]) => advanceSceneRenderMock(...a)
}));

beforeEach(() => {
  getSessionMock.mockReset();
  loadStoryMock.mockReset();
  listScenesMock.mockReset();
  advanceSceneRenderMock.mockReset();
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

describe('GET /api/sceneflow/stories/[id]/status-all — Fix N2 batch endpoint', () => {
  it('returns all non-done scenes (skips status=done)', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u-1' } });
    loadStoryMock.mockResolvedValue(story);
    listScenesMock.mockResolvedValue([
      scene({ id: 'sc-pending', status: 'pending' }),
      scene({
        id: 'sc-done',
        status: 'done',
        image_url: 'i',
        video_url: 'v'
      }),
      scene({
        id: 'sc-generating',
        status: 'generating',
        image_url: 'i',
        fal_request_ids: { video: 'q1' }
      })
    ]);
    advanceSceneRenderMock.mockImplementation(
      async ({ scene: s }: { scene: SceneRecord }) => ({
        sceneId: s.id,
        status: s.status,
        imageUrl: s.image_url,
        audioUrl: s.audio_url,
        neutralVideoUrl: s.neutral_video_url,
        videoUrl: s.video_url,
        step: 'image'
      })
    );

    const { GET } = await import(
      '@/app/api/sceneflow/stories/[id]/status-all/route'
    );
    const res = await GET(new Request('http://x'), { params: { id: 'st-1' } });
    const body = (await res.json()) as { scenes: Array<{ sceneId: string }> };
    expect(body.scenes.map((s) => s.sceneId).sort()).toEqual([
      'sc-generating',
      'sc-pending'
    ]);
    expect(advanceSceneRenderMock).toHaveBeenCalledTimes(2);
  });

  it('returns 401 without a session', async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import(
      '@/app/api/sceneflow/stories/[id]/status-all/route'
    );
    const res = await GET(new Request('http://x'), { params: { id: 'st-1' } });
    expect(res.status).toBe(401);
  });

  it('continues past per-scene errors (Promise.allSettled)', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u-1' } });
    loadStoryMock.mockResolvedValue(story);
    listScenesMock.mockResolvedValue([
      scene({ id: 'sc-a' }),
      scene({ id: 'sc-b' })
    ]);
    advanceSceneRenderMock
      .mockImplementationOnce(async () => {
        throw new Error('fal blew up');
      })
      .mockImplementationOnce(async ({ scene: s }: { scene: SceneRecord }) => ({
        sceneId: s.id,
        status: s.status,
        imageUrl: s.image_url,
        audioUrl: s.audio_url,
        neutralVideoUrl: s.neutral_video_url,
        videoUrl: s.video_url,
        step: 'image'
      }));

    const { GET } = await import(
      '@/app/api/sceneflow/stories/[id]/status-all/route'
    );
    const res = await GET(new Request('http://x'), { params: { id: 'st-1' } });
    const body = (await res.json()) as {
      scenes: Array<{ sceneId: string; error?: string; status: string }>;
    };
    expect(body.scenes).toHaveLength(2);
    expect(body.scenes[0]!.error).toBe('fal blew up');
    expect(body.scenes[0]!.status).toBe('error');
    expect(body.scenes[1]!.sceneId).toBe('sc-b');
  });
});
