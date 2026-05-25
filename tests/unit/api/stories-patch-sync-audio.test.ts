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

describe('PATCH /api/sceneflow/stories/[id] — Plan 8d fields', () => {
  it('syncAudioUrl as string → forwarded', async () => {
    const { PATCH } = await import('@/app/api/sceneflow/stories/[id]/route');
    await PATCH(makeRequest({ syncAudioUrl: 'https://r2/song.mp3' }), {
      params: { id: 'st-1' }
    });
    expect(updateStoryMock).toHaveBeenCalledWith({
      userId: 'u-1',
      storyId: 'st-1',
      patch: { syncAudioUrl: 'https://r2/song.mp3' }
    });
  });

  it('syncAudioUrl: null → forwarded (clears the song)', async () => {
    const { PATCH } = await import('@/app/api/sceneflow/stories/[id]/route');
    await PATCH(makeRequest({ syncAudioUrl: null }), {
      params: { id: 'st-1' }
    });
    expect(updateStoryMock).toHaveBeenCalledWith({
      userId: 'u-1',
      storyId: 'st-1',
      patch: { syncAudioUrl: null }
    });
  });

  it('syncAudioBpm: 128 → rounded + forwarded', async () => {
    const { PATCH } = await import('@/app/api/sceneflow/stories/[id]/route');
    await PATCH(makeRequest({ syncAudioBpm: 128.4 }), {
      params: { id: 'st-1' }
    });
    expect(updateStoryMock).toHaveBeenCalledWith({
      userId: 'u-1',
      storyId: 'st-1',
      patch: { syncAudioBpm: 128 }
    });
  });

  it('syncAudioBpm out of range (40–300) → 400', async () => {
    const { PATCH } = await import('@/app/api/sceneflow/stories/[id]/route');
    const res = await PATCH(makeRequest({ syncAudioBpm: 999 }), {
      params: { id: 'st-1' }
    });
    expect(res.status).toBe(400);
    expect(updateStoryMock).not.toHaveBeenCalled();
  });

  it('syncAudioBpm: null → forwarded', async () => {
    const { PATCH } = await import('@/app/api/sceneflow/stories/[id]/route');
    await PATCH(makeRequest({ syncAudioBpm: null }), {
      params: { id: 'st-1' }
    });
    expect(updateStoryMock).toHaveBeenCalledWith({
      userId: 'u-1',
      storyId: 'st-1',
      patch: { syncAudioBpm: null }
    });
  });

  it('snapMode: "bar" → forwarded', async () => {
    const { PATCH } = await import('@/app/api/sceneflow/stories/[id]/route');
    await PATCH(makeRequest({ snapMode: 'bar' }), {
      params: { id: 'st-1' }
    });
    expect(updateStoryMock).toHaveBeenCalledWith({
      userId: 'u-1',
      storyId: 'st-1',
      patch: { snapMode: 'bar' }
    });
  });

  it('snapMode invalid value → 400', async () => {
    const { PATCH } = await import('@/app/api/sceneflow/stories/[id]/route');
    const res = await PATCH(makeRequest({ snapMode: 'every-other-beat' }), {
      params: { id: 'st-1' }
    });
    expect(res.status).toBe(400);
    expect(updateStoryMock).not.toHaveBeenCalled();
  });
});
