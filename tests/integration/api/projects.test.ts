import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock, getSession } = vi.hoisted(() => ({
  dbMock: {
    createProject: vi.fn(),
    listProjects: vi.fn(),
    loadProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn()
  },
  getSession: vi.fn()
}));

vi.mock('@/lib/project/db', () => dbMock);
vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession } }
}));

import { GET as projectsGet, POST as projectsPost } from '@/app/api/projects/route';
import {
  GET as projectGet,
  PATCH as projectPatch,
  DELETE as projectDelete
} from '@/app/api/projects/[id]/route';

beforeEach(() => {
  Object.values(dbMock).forEach((m) => m.mockReset());
  getSession.mockReset();
});

describe('POST /api/projects', () => {
  it('returns 401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await projectsPost(
      new Request('http://localhost/api/projects', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid body', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    const res = await projectsPost(
      new Request('http://localhost/api/projects', {
        method: 'POST',
        body: '{"name":"X"}', // no serialized
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(400);
  });

  it('creates project with session.user.id', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.createProject.mockResolvedValue('p-1');
    const body = {
      name: 'My',
      serialized: { store_version: 6, state: { ui: {}, timeline: {}, audio: {}, media: {} } }
    };
    const res = await projectsPost(
      new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(201);
    expect(dbMock.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1', name: 'My' })
    );
    const json = await res.json();
    expect(json.id).toBe('p-1');
  });
});

describe('GET /api/projects', () => {
  it('returns 401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await projectsGet(new Request('http://localhost/api/projects'));
    expect(res.status).toBe(401);
  });

  it('lists projects of the current user only', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.listProjects.mockResolvedValue([{ id: 'p-1', name: 'X', updated_at: 't' }]);
    const res = await projectsGet(new Request('http://localhost/api/projects'));
    expect(res.status).toBe(200);
    expect(dbMock.listProjects).toHaveBeenCalledWith('u-1');
  });
});

describe('GET/PATCH/DELETE /api/projects/[id]', () => {
  it('GET returns 404 when load returns null', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.loadProject.mockResolvedValue(null);
    const res = await projectGet(new Request('http://localhost/api/projects/p-x'), {
      params: { id: 'p-x' }
    });
    expect(res.status).toBe(404);
    expect(dbMock.loadProject).toHaveBeenCalledWith({ userId: 'u-1', projectId: 'p-x' });
  });

  it('PATCH passes name + serialized through to updateProject', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.updateProject.mockResolvedValue(true);
    const res = await projectPatch(
      new Request('http://localhost/api/projects/p-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: { id: 'p-1' } }
    );
    expect(res.status).toBe(200);
    expect(dbMock.updateProject).toHaveBeenCalledWith({
      userId: 'u-1',
      projectId: 'p-1',
      patch: { name: 'New', serialized: undefined }
    });
  });

  it('DELETE returns 404 when row not found', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.deleteProject.mockResolvedValue(false);
    const res = await projectDelete(new Request('http://localhost/api/projects/p-1'), {
      params: { id: 'p-1' }
    });
    expect(res.status).toBe(404);
  });
});
