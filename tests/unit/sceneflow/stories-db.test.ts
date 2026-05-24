import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/db/pg', () => ({ pool: { query: queryMock } }));

import { createStory, listStories, deleteStory } from '@/lib/sceneflow/stories-db';

beforeEach(() => queryMock.mockReset());

describe('stories-db CRUD', () => {
  it('createStory inserts title/format/visualStyle, returns id', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'story-1' }] });
    const id = await createStory({
      userId: 'u-1',
      title: 'My Story',
      format: '16:9',
      visualStyle: 'cinematic'
    });
    expect(id).toBe('story-1');
    expect(queryMock.mock.calls[0]![0]).toMatch(/INSERT INTO "VG_stories"/);
    expect(queryMock.mock.calls[0]![1]).toEqual(['u-1', 'My Story', '16:9', 'cinematic']);
  });

  it('listStories ordered by updated_at DESC, user-scoped', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await listStories('u-1');
    expect(queryMock.mock.calls[0]![0]).toMatch(
      /WHERE user_id = \$1 ORDER BY updated_at DESC/
    );
  });

  it('deleteStory user-scoped — returns false on miss', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });
    const ok = await deleteStory({ userId: 'u-1', storyId: 'story-x' });
    expect(ok).toBe(false);
  });
});
