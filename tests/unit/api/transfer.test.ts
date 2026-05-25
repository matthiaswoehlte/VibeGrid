// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SceneRecord, StoryRecord } from '@/lib/sceneflow/types';

const getSessionMock = vi.fn();
const loadStoryMock = vi.fn();
const listScenesMock = vi.fn();

vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession: (...a: unknown[]) => getSessionMock(...a) } }
}));
vi.mock('@/lib/sceneflow/stories-db', () => ({
  loadStory: (...a: unknown[]) => loadStoryMock(...a)
}));
vi.mock('@/lib/sceneflow/scenes-db', () => ({
  listScenes: (...a: unknown[]) => listScenesMock(...a)
}));

beforeEach(() => {
  getSessionMock.mockReset();
  loadStoryMock.mockReset();
  listScenesMock.mockReset();
  getSessionMock.mockResolvedValue({ user: { id: 'u-1' } });
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
    image_url: 'https://r2/img.jpg',
    video_url: 'https://r2/scene-1.mp4',
    audio_url: null,
    neutral_video_url: null,
    end_frame_url: null,
    status: 'done',
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
    title: 'M1',
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

describe('POST /api/sceneflow/stories/[id]/transfer', () => {
  it('401 when no session', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const { POST } = await import(
      '@/app/api/sceneflow/stories/[id]/transfer/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { id: 'st-1' }
    });
    expect(res.status).toBe(401);
  });

  it('404 when story not found', async () => {
    loadStoryMock.mockResolvedValueOnce(null);
    const { POST } = await import(
      '@/app/api/sceneflow/stories/[id]/transfer/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { id: 'st-1' }
    });
    expect(res.status).toBe(404);
  });

  it('400 when story has no scenes', async () => {
    loadStoryMock.mockResolvedValueOnce(story());
    listScenesMock.mockResolvedValueOnce([]);
    const { POST } = await import(
      '@/app/api/sceneflow/stories/[id]/transfer/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { id: 'st-1' }
    });
    expect(res.status).toBe(400);
  });

  it('syncAudio: null when sync_audio_url is null', async () => {
    loadStoryMock.mockResolvedValueOnce(story());
    listScenesMock.mockResolvedValueOnce([scene()]);
    const { POST } = await import(
      '@/app/api/sceneflow/stories/[id]/transfer/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { id: 'st-1' }
    });
    const body = (await res.json()) as { syncAudio: unknown };
    expect(body.syncAudio).toBeNull();
  });

  it('syncAudio: { url, bpm } when both story fields are set', async () => {
    loadStoryMock.mockResolvedValueOnce(
      story({
        sync_audio_url: 'https://r2/song.mp3',
        sync_audio_bpm: 128
      })
    );
    listScenesMock.mockResolvedValueOnce([scene()]);
    const { POST } = await import(
      '@/app/api/sceneflow/stories/[id]/transfer/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { id: 'st-1' }
    });
    const body = (await res.json()) as {
      syncAudio: { url: string; bpm: number };
    };
    expect(body.syncAudio).toEqual({
      url: 'https://r2/song.mp3',
      bpm: 128
    });
  });

  it('snapMode comes from story.snap_mode', async () => {
    loadStoryMock.mockResolvedValueOnce(story({ snap_mode: 'bar' }));
    listScenesMock.mockResolvedValueOnce([scene()]);
    const { POST } = await import(
      '@/app/api/sceneflow/stories/[id]/transfer/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { id: 'st-1' }
    });
    const body = (await res.json()) as { snapMode: string };
    expect(body.snapMode).toBe('bar');
  });

  it('clips sorted by scene_order, endcard with image gets default duration', async () => {
    loadStoryMock.mockResolvedValueOnce(story());
    listScenesMock.mockResolvedValueOnce([
      scene({ id: 's-3', scene_order: 3 }),
      scene({ id: 's-1', scene_order: 1 }),
      scene({
        id: 's-end',
        scene_order: 99,
        type: 'endcard',
        video_url: null,
        image_url: 'https://r2/endcard.jpg',
        duration: 3 // ignored — endcards use ENDCARD_DEFAULT_DURATION_SEC=5
      })
    ]);
    const { POST } = await import(
      '@/app/api/sceneflow/stories/[id]/transfer/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { id: 'st-1' }
    });
    const body = (await res.json()) as {
      clips: Array<{ sceneOrder: number; sceneType: string; durationSec: number; videoUrl: string | null; imageUrl: string | null }>;
    };
    expect(body.clips.map((c) => c.sceneOrder)).toEqual([1, 3, 99]);
    const endcard = body.clips.find((c) => c.sceneType === 'endcard')!;
    expect(endcard.videoUrl).toBeNull();
    expect(endcard.imageUrl).toBe('https://r2/endcard.jpg');
    expect(endcard.durationSec).toBe(5);
  });

  it('mediaId equals scene.id (deterministic across re-transfers)', async () => {
    loadStoryMock.mockResolvedValueOnce(story());
    listScenesMock.mockResolvedValueOnce([scene({ id: 'sc-uuid-x' })]);
    const { POST } = await import(
      '@/app/api/sceneflow/stories/[id]/transfer/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { id: 'st-1' }
    });
    const body = (await res.json()) as { clips: Array<{ mediaId: string }> };
    expect(body.clips[0]!.mediaId).toBe('sc-uuid-x');
  });

  it('non-endcard scenes without video_url are filtered out', async () => {
    loadStoryMock.mockResolvedValueOnce(story());
    listScenesMock.mockResolvedValueOnce([
      scene({ id: 's-rendered', scene_order: 1, video_url: 'https://r2/a.mp4' }),
      scene({ id: 's-pending', scene_order: 2, video_url: null })
    ]);
    const { POST } = await import(
      '@/app/api/sceneflow/stories/[id]/transfer/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { id: 'st-1' }
    });
    const body = (await res.json()) as { clips: Array<{ mediaId: string }> };
    expect(body.clips.map((c) => c.mediaId)).toEqual(['s-rendered']);
  });
});
