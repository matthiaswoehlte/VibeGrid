import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock, getSession } = vi.hoisted(() => ({
  dbMock: {
    createStory: vi.fn(),
    listStories: vi.fn(),
    deleteStory: vi.fn(),
    updateStory: vi.fn(),
    loadStory: vi.fn()
  },
  getSession: vi.fn()
}));
vi.mock('@/lib/sceneflow/stories-db', () => dbMock);
vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession } }
}));

import { POST as postStory, GET as getStories } from '@/app/api/sceneflow/stories/route';
import {
  DELETE as delStory,
  PATCH as patchStory
} from '@/app/api/sceneflow/stories/[id]/route';

beforeEach(() => {
  Object.values(dbMock).forEach((m) => m.mockReset());
  getSession.mockReset();
});

describe('POST /api/sceneflow/stories', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await postStory(
      new Request('http://x/api/sceneflow/stories', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(401);
  });

  it('201 + creates story with defaults', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.createStory.mockResolvedValue('story-1');
    const res = await postStory(
      new Request('http://x/api/sceneflow/stories', {
        method: 'POST',
        body: JSON.stringify({
          title: 'My Story',
          format: '16:9',
          visualStyle: 'cinematic'
        }),
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(201);
    expect(dbMock.createStory).toHaveBeenCalledWith({
      userId: 'u-1',
      title: 'My Story',
      format: '16:9',
      visualStyle: 'cinematic'
    });
    const json = await res.json();
    expect(json.id).toBe('story-1');
  });

  it('400 on invalid format', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    const res = await postStory(
      new Request('http://x/api/sceneflow/stories', {
        method: 'POST',
        body: JSON.stringify({ title: 't', format: 'square', visualStyle: null }),
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/sceneflow/stories', () => {
  it('lists stories for session user', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.listStories.mockResolvedValue([]);
    const res = await getStories(new Request('http://x/api/sceneflow/stories'));
    expect(res.status).toBe(200);
    expect(dbMock.listStories).toHaveBeenCalledWith('u-1');
  });
});

describe('DELETE /api/sceneflow/stories/[id]', () => {
  it('404 when story missing', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.deleteStory.mockResolvedValue(false);
    const res = await delStory(new Request('http://x'), { params: { id: 'story-x' } });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/sceneflow/stories/[id]', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await patchStory(
      new Request('http://x', {
        method: 'PATCH',
        body: '{}',
        headers: { 'content-type': 'application/json' }
      }),
      { params: { id: 'story-1' } }
    );
    expect(res.status).toBe(401);
  });

  it('200 + forwards patch to updateStory for owner', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.updateStory.mockResolvedValue(true);
    const res = await patchStory(
      new Request('http://x', {
        method: 'PATCH',
        body: JSON.stringify({
          title: 'Renamed',
          characters: ['c-1', 'c-2'],
          storyText: 'hello'
        }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: { id: 'story-1' } }
    );
    expect(res.status).toBe(200);
    expect(dbMock.updateStory).toHaveBeenCalledWith({
      userId: 'u-1',
      storyId: 'story-1',
      patch: {
        title: 'Renamed',
        characters: ['c-1', 'c-2'],
        storyText: 'hello'
      }
    });
  });

  it('400 on invalid format', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    const res = await patchStory(
      new Request('http://x', {
        method: 'PATCH',
        body: JSON.stringify({ format: 'square' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: { id: 'story-1' } }
    );
    expect(res.status).toBe(400);
    expect(dbMock.updateStory).not.toHaveBeenCalled();
  });

  it('400 when characters array contains non-string', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    const res = await patchStory(
      new Request('http://x', {
        method: 'PATCH',
        body: JSON.stringify({ characters: ['c-1', 42] }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: { id: 'story-1' } }
    );
    expect(res.status).toBe(400);
  });

  it('404 when updateStory returns false (not found / cross-user)', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.updateStory.mockResolvedValue(false);
    const res = await patchStory(
      new Request('http://x', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'x' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: { id: 'story-x' } }
    );
    expect(res.status).toBe(404);
  });
});
