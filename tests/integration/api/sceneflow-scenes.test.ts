import { describe, it, expect, vi, beforeEach } from 'vitest';

const { scenesDbMock, storiesDbMock, getSession } = vi.hoisted(() => ({
  scenesDbMock: {
    listScenes: vi.fn(),
    createScenes: vi.fn(),
    updateScene: vi.fn(),
    deleteScene: vi.fn(),
    swapSceneOrder: vi.fn()
  },
  storiesDbMock: {
    loadStory: vi.fn()
  },
  getSession: vi.fn()
}));
vi.mock('@/lib/sceneflow/scenes-db', () => scenesDbMock);
vi.mock('@/lib/sceneflow/stories-db', () => storiesDbMock);
vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession } }
}));

import {
  GET as getScenes,
  POST as postScenes
} from '@/app/api/sceneflow/stories/[id]/scenes/route';
import {
  PATCH as patchScene,
  DELETE as delScene
} from '@/app/api/sceneflow/scenes/[sceneId]/route';
import { POST as postReorder } from '@/app/api/sceneflow/stories/[id]/scenes/reorder/route';

beforeEach(() => {
  Object.values(scenesDbMock).forEach((m) => m.mockReset());
  Object.values(storiesDbMock).forEach((m) => m.mockReset());
  getSession.mockReset();
});

describe('GET /api/sceneflow/stories/[id]/scenes', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await getScenes(new Request('http://x'), { params: { id: 'story-1' } });
    expect(res.status).toBe(401);
  });

  it('200 + lists scenes for owner', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    scenesDbMock.listScenes.mockResolvedValue([]);
    const res = await getScenes(new Request('http://x'), { params: { id: 'story-1' } });
    expect(res.status).toBe(200);
    expect(scenesDbMock.listScenes).toHaveBeenCalledWith('u-1', 'story-1');
  });
});

describe('PATCH /api/sceneflow/scenes/[sceneId]', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await patchScene(
      new Request('http://x', {
        method: 'PATCH',
        body: '{}',
        headers: { 'content-type': 'application/json' }
      }),
      { params: { sceneId: 'sc-1' } }
    );
    expect(res.status).toBe(401);
  });

  it('404 when updateScene returns false (foreign user / missing)', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    scenesDbMock.updateScene.mockResolvedValue(false);
    const res = await patchScene(
      new Request('http://x', {
        method: 'PATCH',
        body: JSON.stringify({ duration: 5 }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: { sceneId: 'sc-x' } }
    );
    expect(res.status).toBe(404);
  });

  it('200 + updateScene called with user + scene id', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    scenesDbMock.updateScene.mockResolvedValue(true);
    const res = await patchScene(
      new Request('http://x', {
        method: 'PATCH',
        body: JSON.stringify({ image_prompt: 'edit' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: { sceneId: 'sc-1' } }
    );
    expect(res.status).toBe(200);
    expect(scenesDbMock.updateScene).toHaveBeenCalledWith({
      userId: 'u-1',
      sceneId: 'sc-1',
      patch: { image_prompt: 'edit' }
    });
  });
});

describe('DELETE /api/sceneflow/scenes/[sceneId]', () => {
  it('404 when missing / cross-user', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    scenesDbMock.deleteScene.mockResolvedValue(false);
    const res = await delScene(new Request('http://x'), { params: { sceneId: 'sc-x' } });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/sceneflow/stories/[id]/scenes/reorder', () => {
  it('400 when aId === bId', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    const res = await postReorder(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ aId: 'sc-1', bId: 'sc-1' }),
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(400);
  });

  it('200 + swapSceneOrder called once', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    scenesDbMock.swapSceneOrder.mockResolvedValue(true);
    const res = await postReorder(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ aId: 'sc-1', bId: 'sc-2' }),
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(200);
    expect(scenesDbMock.swapSceneOrder).toHaveBeenCalledWith({
      userId: 'u-1',
      aId: 'sc-1',
      bId: 'sc-2'
    });
  });
});
