// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionMock = vi.fn();
const updateStoryMock = vi.fn();

vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession: (...a: unknown[]) => getSessionMock(...a) } }
}));
vi.mock('@/lib/sceneflow/stories-db', () => ({
  updateStory: (...a: unknown[]) => updateStoryMock(...a),
  deleteStory: vi.fn()
}));

beforeEach(() => {
  getSessionMock.mockReset();
  updateStoryMock.mockReset();
  getSessionMock.mockResolvedValue({ user: { id: 'u-1' } });
  updateStoryMock.mockResolvedValue(true);
});

function makeRequest(body: unknown): Request {
  return new Request('http://x', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('PATCH /api/sceneflow/stories/[id] — creditBudget', () => {
  it('accepts { creditBudget: 1000 } and forwards to updateStory', async () => {
    const { PATCH } = await import('@/app/api/sceneflow/stories/[id]/route');
    const res = await PATCH(makeRequest({ creditBudget: 1000 }), {
      params: { id: 'st-1' }
    });
    expect(res.status).toBe(200);
    expect(updateStoryMock).toHaveBeenCalledWith({
      userId: 'u-1',
      storyId: 'st-1',
      patch: { creditBudget: 1000 }
    });
  });

  it('accepts { creditBudget: null } to clear the cap', async () => {
    const { PATCH } = await import('@/app/api/sceneflow/stories/[id]/route');
    const res = await PATCH(makeRequest({ creditBudget: null }), {
      params: { id: 'st-1' }
    });
    expect(res.status).toBe(200);
    expect(updateStoryMock).toHaveBeenCalledWith({
      userId: 'u-1',
      storyId: 'st-1',
      patch: { creditBudget: null }
    });
  });

  it('rejects negative creditBudget with 400', async () => {
    const { PATCH } = await import('@/app/api/sceneflow/stories/[id]/route');
    const res = await PATCH(makeRequest({ creditBudget: -100 }), {
      params: { id: 'st-1' }
    });
    expect(res.status).toBe(400);
    expect(updateStoryMock).not.toHaveBeenCalled();
  });

  it('rejects non-numeric creditBudget with 400', async () => {
    const { PATCH } = await import('@/app/api/sceneflow/stories/[id]/route');
    const res = await PATCH(makeRequest({ creditBudget: 'lots' }), {
      params: { id: 'st-1' }
    });
    expect(res.status).toBe(400);
    expect(updateStoryMock).not.toHaveBeenCalled();
  });

  it('floors fractional values to integer credits', async () => {
    const { PATCH } = await import('@/app/api/sceneflow/stories/[id]/route');
    await PATCH(makeRequest({ creditBudget: 999.9 }), {
      params: { id: 'st-1' }
    });
    expect(updateStoryMock).toHaveBeenCalledWith({
      userId: 'u-1',
      storyId: 'st-1',
      patch: { creditBudget: 999 }
    });
  });
});
