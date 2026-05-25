// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SceneRecord, StoryRecord } from '@/lib/sceneflow/types';

const getSessionMock = vi.fn();
const loadStoryMock = vi.fn();
const listScenesMock = vi.fn();
const listCharactersByIdsMock = vi.fn();
const getBalanceMock = vi.fn();
const getStorySpendMock = vi.fn();
const reserveCreditsMock = vi.fn();
const deductCreditsMock = vi.fn();
const runTtsForScenesMock = vi.fn();
const generateAndStoreImagesMock = vi.fn();
const enqueueVideoJobsMock = vi.fn();
const readBalanceMock = vi.fn();
const validateScenesForGenerationMock = vi.fn();

vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession: (...a: unknown[]) => getSessionMock(...a) } }
}));
vi.mock('@/lib/sceneflow/stories-db', () => ({
  loadStory: (...a: unknown[]) => loadStoryMock(...a)
}));
vi.mock('@/lib/sceneflow/scenes-db', () => ({
  listScenes: (...a: unknown[]) => listScenesMock(...a)
}));
vi.mock('@/lib/sceneflow/characters-db', () => ({
  listCharactersByIds: (...a: unknown[]) => listCharactersByIdsMock(...a)
}));
vi.mock('@/lib/sceneflow/render-pipeline', () => ({
  runTtsForScenes: (...a: unknown[]) => runTtsForScenesMock(...a),
  generateAndStoreImages: (...a: unknown[]) => generateAndStoreImagesMock(...a),
  enqueueVideoJobs: (...a: unknown[]) => enqueueVideoJobsMock(...a)
}));
vi.mock('@/lib/sceneflow/validation', () => ({
  validateScenesForGeneration: (...a: unknown[]) =>
    validateScenesForGenerationMock(...a),
  hasBlockers: (warnings: { level: string }[]) =>
    warnings.some((w) => w.level === 'block')
}));

// Construct a custom InsufficientCreditsError that's still instanceof the real one.
class FakeInsufficientCreditsError extends Error {
  constructor() {
    super('Insufficient credits');
    this.name = 'InsufficientCreditsError';
  }
}
vi.mock('@/lib/credits/credits', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/credits/credits')
  >('@/lib/credits/credits');
  return {
    ...actual,
    getBalance: (...a: unknown[]) => getBalanceMock(...a),
    readBalance: (...a: unknown[]) => readBalanceMock(...a),
    getStorySpend: (...a: unknown[]) => getStorySpendMock(...a),
    reserveCredits: (...a: unknown[]) => reserveCreditsMock(...a),
    deductCredits: (...a: unknown[]) => deductCreditsMock(...a)
  };
});

beforeEach(() => {
  getSessionMock.mockReset();
  loadStoryMock.mockReset();
  listScenesMock.mockReset();
  listCharactersByIdsMock.mockReset();
  getBalanceMock.mockReset();
  getStorySpendMock.mockReset();
  reserveCreditsMock.mockReset();
  deductCreditsMock.mockReset();
  runTtsForScenesMock.mockReset();
  generateAndStoreImagesMock.mockReset();
  enqueueVideoJobsMock.mockReset();
  readBalanceMock.mockReset();
  validateScenesForGenerationMock.mockReset();
  getSessionMock.mockResolvedValue({ user: { id: 'u-1' } });
  validateScenesForGenerationMock.mockReturnValue([]);
  getStorySpendMock.mockResolvedValue(0);
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
    image_url: 'https://cdn/img.jpg', // Phase-1 done so generate-videos accepts
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
  status: 'draft',
  characters: [],
  story_text: null,
  image_model: 'fal-ai/flux/dev',
  video_model: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
  lipsync_model: 'fal-ai/sync-lipsync/v3',
  credit_budget: null,
  created_at: '',
  updated_at: ''
};

describe('Hard-Stop — POST generate-images-and-voices', () => {
  it('402 when balance < estimate + SAFETY_BUFFER', async () => {
    loadStoryMock.mockResolvedValue(story);
    listScenesMock.mockResolvedValue([scene({ image_url: null })]);
    listCharactersByIdsMock.mockResolvedValue([]);
    getBalanceMock.mockResolvedValueOnce(50); // below 3 + 100 = 103? Yes, 50 < 103.

    const { POST } = await import(
      '@/app/api/sceneflow/stories/[id]/generate-images-and-voices/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { id: 'st-1' }
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/sufficient credits/i);
    expect(body.error).toMatch(/\$1\.00 safety buffer/);
    // estimate text mentioned + current balance mentioned
    expect(body.error).toMatch(/balance is 50 credits/);
  });

  it('402 when story.credit_budget would be exceeded', async () => {
    const scn = scene({ image_url: null });
    loadStoryMock.mockResolvedValue({ ...story, credit_budget: 1 });
    listScenesMock.mockResolvedValue([scn]);
    listCharactersByIdsMock.mockResolvedValue([]);
    getBalanceMock.mockResolvedValueOnce(10000);
    getStorySpendMock.mockResolvedValueOnce(0);

    const { POST } = await import(
      '@/app/api/sceneflow/stories/[id]/generate-images-and-voices/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { id: 'st-1' }
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/story budget/i);
  });
});

describe('Hard-Stop — POST generate-videos', () => {
  it('402 when balance below Phase-2 estimate + buffer', async () => {
    loadStoryMock.mockResolvedValue(story);
    listScenesMock.mockResolvedValue([scene()]);
    getBalanceMock.mockResolvedValueOnce(0); // way below 99 + 100

    const { POST } = await import(
      '@/app/api/sceneflow/stories/[id]/generate-videos/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { id: 'st-1' }
    });
    expect(res.status).toBe(402);
    expect(enqueueVideoJobsMock).not.toHaveBeenCalled();
  });

  it('402 with mid-loop reserve failure surfaces fresh balance', async () => {
    loadStoryMock.mockResolvedValue(story);
    listScenesMock.mockResolvedValue([
      scene({ id: 'sc-a' }),
      scene({ id: 'sc-b' })
    ]);
    getBalanceMock.mockResolvedValueOnce(10000); // pre-flight passes
    // enqueueVideoJobs returns one ok + one Insufficient-Credits error
    enqueueVideoJobsMock.mockResolvedValueOnce([
      { sceneId: 'sc-a', ok: true, requestId: 'r-a', step: 'video' },
      { sceneId: 'sc-b', ok: false, error: 'Insufficient credits for user u-1' }
    ]);

    const { POST } = await import(
      '@/app/api/sceneflow/stories/[id]/generate-videos/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { id: 'st-1' }
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/mid-run/i);
    expect(body.error).toMatch(/1 scene\(s\)/);
  });
});

describe('Hard-Stop — POST retry-image (single 3¢ call)', () => {
  it('402 when balance < 3 + buffer', async () => {
    const loadSceneByIdMock = vi.fn();
    vi.doMock('@/lib/sceneflow/scenes-db', () => ({
      loadSceneById: (...a: unknown[]) => loadSceneByIdMock(...a),
      patchSceneRender: vi.fn()
    }));
    loadSceneByIdMock.mockResolvedValue(scene());
    loadStoryMock.mockResolvedValue(story);
    getBalanceMock.mockResolvedValueOnce(50); // below 3 + 100 = 103

    vi.resetModules();
    // Re-import the route in this isolated module graph
    const { POST } = await import(
      '@/app/api/sceneflow/scenes/[sceneId]/retry-image/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { sceneId: 'sc-1' }
    });
    expect(res.status).toBe(402);
    vi.doUnmock('@/lib/sceneflow/scenes-db');
  });
});
