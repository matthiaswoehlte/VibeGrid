import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/db/pg', () => ({ pool: { query: queryMock } }));

import { updateStory, loadStory } from '@/lib/sceneflow/stories-db';

beforeEach(() => queryMock.mockReset());

describe('stories-db updateStory + loadStory', () => {
  it('updateStory — SET-builder branches on each field, JSON.stringify on characters', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    const ok = await updateStory({
      userId: 'u-1',
      storyId: 's-1',
      patch: {
        title: 'New Title',
        characters: ['c-1', 'c-2'],
        storyText: 'A long story'
      }
    });
    expect(ok).toBe(true);
    const [sql, vals] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/SET title = \$1, characters = \$2::jsonb, story_text = \$3 WHERE id = \$4 AND user_id = \$5/);
    expect(vals).toEqual(['New Title', JSON.stringify(['c-1', 'c-2']), 'A long story', 's-1', 'u-1']);
  });

  it('updateStory — empty patch → false, no SQL', async () => {
    const ok = await updateStory({ userId: 'u-1', storyId: 's-1', patch: {} });
    expect(ok).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('loadStory — user-scoped, returns null when not owned', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const row = await loadStory({ userId: 'u-1', storyId: 's-x' });
    expect(row).toBeNull();
    expect(queryMock.mock.calls[0]![1]).toEqual(['s-x', 'u-1']);
  });
});
