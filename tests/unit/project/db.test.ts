import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted to the top of the file — local consts referenced
// inside the factory must use vi.hoisted() to share the same hoist phase.
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/db/pg', () => ({ pool: { query: queryMock } }));

import {
  createProject,
  listProjects,
  loadProject,
  updateProject,
  deleteProject
} from '@/lib/project/db';

beforeEach(() => queryMock.mockReset());

describe('project db CRUD', () => {
  it('createProject inserts with user_id + name + version + state, returns id', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'p-1' }] });
    const id = await createProject({
      userId: 'u-1',
      name: 'X',
      serialized: {
        store_version: 6,
        state: { ui: {}, timeline: {}, audio: {}, media: {} } as never
      }
    });
    expect(id).toBe('p-1');
    expect(queryMock.mock.calls[0]![0]).toMatch(/INSERT INTO "VG_projects"/);
    expect(queryMock.mock.calls[0]![1]).toEqual([
      'u-1',
      'X',
      6,
      { ui: {}, timeline: {}, audio: {}, media: {} }
    ]);
  });

  it('listProjects scopes to user_id + orders by updated_at DESC', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'p-1', name: 'X', updated_at: 't' }]
    });
    const out = await listProjects('u-1');
    expect(queryMock.mock.calls[0]![0]).toMatch(/WHERE user_id = \$1 ORDER BY updated_at DESC/);
    expect(queryMock.mock.calls[0]![1]).toEqual(['u-1']);
    expect(out).toHaveLength(1);
  });

  it('loadProject filters by user_id (no cross-user reads)', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'p-1',
          user_id: 'u-1',
          name: 'X',
          store_version: 6,
          state: {},
          created_at: 't',
          updated_at: 't'
        }
      ]
    });
    const rec = await loadProject({ userId: 'u-1', projectId: 'p-1' });
    expect(queryMock.mock.calls[0]![1]).toEqual(['p-1', 'u-1']);
    expect(rec?.id).toBe('p-1');
  });

  it('loadProject returns null when user-id mismatch (defense in depth)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const res = await loadProject({ userId: 'u-1', projectId: 'p-foreign' });
    expect(res).toBeNull();
  });

  it('updateProject — name-only branch builds correct SQL', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await updateProject({ userId: 'u-1', projectId: 'p-1', patch: { name: 'New' } });
    const [sql, vals] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/SET name = \$1 WHERE id = \$2 AND user_id = \$3/);
    expect(vals).toEqual(['New', 'p-1', 'u-1']);
  });

  it('updateProject — serialized-only branch builds correct SQL', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await updateProject({
      userId: 'u-1',
      projectId: 'p-1',
      patch: {
        serialized: {
          store_version: 6,
          state: { ui: {}, timeline: {}, audio: {}, media: {} } as never
        }
      }
    });
    const [sql, vals] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/SET state = \$1, store_version = \$2 WHERE id = \$3 AND user_id = \$4/);
    expect(vals).toEqual([
      { ui: {}, timeline: {}, audio: {}, media: {} },
      6,
      'p-1',
      'u-1'
    ]);
  });

  it('updateProject — combined branch (name + serialized) builds correct SQL', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await updateProject({
      userId: 'u-1',
      projectId: 'p-1',
      patch: {
        name: 'New',
        serialized: {
          store_version: 6,
          state: { ui: {}, timeline: {}, audio: {}, media: {} } as never
        }
      }
    });
    const [sql, vals] = queryMock.mock.calls[0]!;
    // Order is pinned: serialized fields first, then name.
    expect(sql).toMatch(
      /SET state = \$1, store_version = \$2, name = \$3 WHERE id = \$4 AND user_id = \$5/
    );
    expect(vals).toEqual([
      { ui: {}, timeline: {}, audio: {}, media: {} },
      6,
      'New',
      'p-1',
      'u-1'
    ]);
  });

  it('updateProject — empty patch is a no-op, returns false', async () => {
    const ok = await updateProject({ userId: 'u-1', projectId: 'p-1', patch: {} });
    expect(ok).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('deleteProject filters by user_id + projectId', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    const ok = await deleteProject({ userId: 'u-1', projectId: 'p-1' });
    expect(queryMock.mock.calls[0]![1]).toEqual(['p-1', 'u-1']);
    expect(ok).toBe(true);
  });
});
