import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/db/pg', () => ({ pool: { query: queryMock } }));

import {
  createCharacter,
  listCharacters,
  listCharactersByIds,
  updateCharacter,
  deleteCharacter
} from '@/lib/sceneflow/characters-db';

beforeEach(() => queryMock.mockReset());

describe('characters-db CRUD', () => {
  it('createCharacter inserts the full field set, returns id', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'char-1' }] });
    const id = await createCharacter({
      userId: 'u-1',
      name: 'Magdalena',
      type: 'person',
      referenceImageUrl: 'https://r2/m.png',
      voiceProvider: 'elevenlabs',
      voiceId: 'xyz',
      imagePrompt: null
    });
    expect(id).toBe('char-1');
    expect(queryMock.mock.calls[0]![0]).toMatch(/INSERT INTO "VG_characters"/);
    expect(queryMock.mock.calls[0]![1]).toEqual([
      'u-1',
      'Magdalena',
      'person',
      'https://r2/m.png',
      'elevenlabs',
      'xyz',
      null
    ]);
  });

  it('listCharacters scopes to user_id', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await listCharacters('u-1');
    expect(queryMock.mock.calls[0]![0]).toMatch(/WHERE user_id = \$1/);
    expect(queryMock.mock.calls[0]![1]).toEqual(['u-1']);
  });

  it('updateCharacter — SET-builder branches on each optional field', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await updateCharacter({
      userId: 'u-1',
      characterId: 'char-1',
      patch: { name: 'Magda', voiceId: 'abc' }
    });
    const [sql, vals] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/SET name = \$1, voice_id = \$2 WHERE id = \$3 AND user_id = \$4/);
    expect(vals).toEqual(['Magda', 'abc', 'char-1', 'u-1']);
  });

  it('updateCharacter — empty patch is a no-op, returns false', async () => {
    const ok = await updateCharacter({ userId: 'u-1', characterId: 'char-1', patch: {} });
    expect(ok).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('deleteCharacter filters by user_id (no cross-user delete)', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    const ok = await deleteCharacter({ userId: 'u-1', characterId: 'char-1' });
    expect(queryMock.mock.calls[0]![1]).toEqual(['char-1', 'u-1']);
    expect(ok).toBe(true);
  });
});

describe('listCharactersByIds', () => {
  it('queries with user_id filter AND id = ANY(uuids[])', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await listCharactersByIds('u-1', ['c-1', 'c-2']);
    const [sql, vals] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/WHERE user_id = \$1 AND id = ANY\(\$2::uuid\[\]\)/);
    expect(vals).toEqual(['u-1', ['c-1', 'c-2']]);
  });

  it('empty ids array → returns [] without SQL', async () => {
    const rows = await listCharactersByIds('u-1', []);
    expect(rows).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
