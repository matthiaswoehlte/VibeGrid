import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  sonnetMock,
  scenesDbMock,
  storiesDbMock,
  charsDbMock,
  getSession,
  poolConnect,
  clientQuery,
  clientRelease
} = vi.hoisted(() => {
  const clientQuery = vi.fn().mockResolvedValue({});
  const clientRelease = vi.fn();
  return {
    sonnetMock: { generateScenesViaSonnet: vi.fn() },
    scenesDbMock: {
      deleteScenesByStory: vi.fn(),
      createScenes: vi.fn()
    },
    storiesDbMock: { loadStory: vi.fn() },
    charsDbMock: { listCharactersByIds: vi.fn() },
    getSession: vi.fn(),
    poolConnect: vi.fn(() =>
      Promise.resolve({ query: clientQuery, release: clientRelease })
    ),
    clientQuery,
    clientRelease
  };
});

vi.mock('@/lib/sceneflow/sonnet', () => sonnetMock);
vi.mock('@/lib/sceneflow/scenes-db', () => scenesDbMock);
vi.mock('@/lib/sceneflow/stories-db', () => storiesDbMock);
vi.mock('@/lib/sceneflow/characters-db', () => charsDbMock);
vi.mock('@/lib/db/pg', () => ({ pool: { connect: poolConnect } }));
vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession } }
}));

import { POST } from '@/app/api/sceneflow/stories/[id]/generate-scenes/route';

beforeEach(() => {
  vi.clearAllMocks();
  clientQuery.mockResolvedValue({});
});

describe('POST /api/sceneflow/stories/[id]/generate-scenes', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' }
      }),
      { params: { id: 'story-1' } }
    );
    expect(res.status).toBe(401);
  });

  it('happy path — Sonnet → coerce → TX(delete+insert)', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    storiesDbMock.loadStory.mockResolvedValue({
      id: 'story-1',
      user_id: 'u-1',
      title: 't',
      format: '16:9',
      visual_style: null,
      characters: ['c-1'],
      story_text: 'A story',
      status: 'draft',
      created_at: '',
      updated_at: ''
    });
    charsDbMock.listCharactersByIds.mockResolvedValue([
      { id: 'c-1', name: 'A', type: 'person' }
    ]);
    sonnetMock.generateScenesViaSonnet.mockResolvedValue({
      scenes: [{ scene_order: 1, type: 'action' }],
      usage: { input_tokens: 100, output_tokens: 50 }
    });
    scenesDbMock.createScenes.mockResolvedValue([
      { id: 'sc-1', scene_order: 1 }
    ]);
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ storyText: 'A story' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: { id: 'story-1' } }
    );
    expect(res.status).toBe(200);
    expect(scenesDbMock.deleteScenesByStory).toHaveBeenCalled();
    expect(scenesDbMock.createScenes).toHaveBeenCalled();
    // BEGIN + COMMIT both ran on client
    const calls = clientQuery.mock.calls.map((c) => c[0]);
    expect(calls).toContain('BEGIN');
    expect(calls).toContain('COMMIT');
    expect(clientRelease).toHaveBeenCalled();
  });

  it('Sonnet error → OLD SCENES STAY (no delete, no insert)', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    storiesDbMock.loadStory.mockResolvedValue({
      id: 'story-1',
      user_id: 'u-1',
      title: 't',
      format: '16:9',
      visual_style: null,
      characters: ['c-1'],
      story_text: 'A story',
      status: 'draft',
      created_at: '',
      updated_at: ''
    });
    charsDbMock.listCharactersByIds.mockResolvedValue([
      { id: 'c-1', name: 'Magda', type: 'person' }
    ]);
    sonnetMock.generateScenesViaSonnet.mockRejectedValue(new Error('Sonnet 500'));
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ storyText: 'A story' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: { id: 'story-1' } }
    );
    expect(res.status).toBe(502);
    expect(scenesDbMock.deleteScenesByStory).not.toHaveBeenCalled();
    expect(scenesDbMock.createScenes).not.toHaveBeenCalled();
    expect(poolConnect).not.toHaveBeenCalled();
  });

  it('rejects @Unknown character reference (server-side defense)', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    storiesDbMock.loadStory.mockResolvedValue({
      id: 'story-1',
      user_id: 'u-1',
      title: 't',
      format: '16:9',
      visual_style: null,
      characters: ['c-1'],
      story_text: '',
      status: 'draft',
      created_at: '',
      updated_at: ''
    });
    charsDbMock.listCharactersByIds.mockResolvedValue([
      { id: 'c-1', name: 'Magda', type: 'person' }
    ]);
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ storyText: '@Unknown walks in.' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: { id: 'story-1' } }
    );
    expect(res.status).toBe(400);
    expect(sonnetMock.generateScenesViaSonnet).not.toHaveBeenCalled();
  });
});
