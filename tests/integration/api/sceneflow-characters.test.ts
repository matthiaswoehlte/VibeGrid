import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock, getSession } = vi.hoisted(() => ({
  dbMock: {
    createCharacter: vi.fn(),
    listCharacters: vi.fn(),
    updateCharacter: vi.fn(),
    deleteCharacter: vi.fn()
  },
  getSession: vi.fn()
}));
vi.mock('@/lib/sceneflow/characters-db', () => dbMock);
vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession } }
}));

import { POST as postChars, GET as getChars } from '@/app/api/sceneflow/characters/route';
import {
  PATCH as patchChar,
  DELETE as delChar
} from '@/app/api/sceneflow/characters/[id]/route';

beforeEach(() => {
  Object.values(dbMock).forEach((m) => m.mockReset());
  getSession.mockReset();
});

describe('POST /api/sceneflow/characters', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await postChars(
      new Request('http://x/api/sceneflow/characters', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(401);
  });

  it('400 on missing name/type', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    const res = await postChars(
      new Request('http://x/api/sceneflow/characters', {
        method: 'POST',
        body: JSON.stringify({ name: '' }),
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(400);
  });

  it('201 + creates character with session user id', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.createCharacter.mockResolvedValue('char-1');
    const res = await postChars(
      new Request('http://x/api/sceneflow/characters', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Magdalena',
          type: 'person',
          referenceImageUrl: 'https://r2/m.png',
          voiceProvider: 'elevenlabs',
          voiceId: 'xyz',
          imagePrompt: null
        }),
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(201);
    expect(dbMock.createCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1', name: 'Magdalena', type: 'person' })
    );
    const json = await res.json();
    expect(json.id).toBe('char-1');
  });
});

describe('GET /api/sceneflow/characters', () => {
  it('lists characters of the current user only', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.listCharacters.mockResolvedValue([]);
    const res = await getChars(new Request('http://x/api/sceneflow/characters'));
    expect(res.status).toBe(200);
    expect(dbMock.listCharacters).toHaveBeenCalledWith('u-1');
  });
});

describe('PATCH/DELETE /api/sceneflow/characters/[id]', () => {
  it('PATCH delegates patch shape to updateCharacter', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.updateCharacter.mockResolvedValue(true);
    const res = await patchChar(
      new Request('http://x/api/sceneflow/characters/char-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'M' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: { id: 'char-1' } }
    );
    expect(res.status).toBe(200);
    expect(dbMock.updateCharacter).toHaveBeenCalledWith({
      userId: 'u-1',
      characterId: 'char-1',
      patch: expect.objectContaining({ name: 'M' })
    });
  });

  it('DELETE 404 when row missing', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.deleteCharacter.mockResolvedValue(false);
    const res = await delChar(new Request('http://x'), { params: { id: 'char-x' } });
    expect(res.status).toBe(404);
  });
});
