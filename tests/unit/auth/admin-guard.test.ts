// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionMock = vi.fn();
const queryMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  // next/navigation's redirect() throws NEXT_REDIRECT internally; we
  // throw a recognizable error so tests assert via rejects.toThrow.
  throw new Error(`NEXT_REDIRECT:${path}`);
});

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path)
}));
vi.mock('next/headers', () => ({
  headers: vi.fn(() => new Headers())
}));
vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession: (...a: unknown[]) => getSessionMock(...a) } }
}));
vi.mock('@/lib/db/pg', () => ({
  pool: { query: (sql: string, params?: unknown[]) => queryMock(sql, params) }
}));

beforeEach(() => {
  getSessionMock.mockReset();
  queryMock.mockReset();
  redirectMock.mockClear();
});

describe('requireAdminPage', () => {
  it('no session → redirect("/login")', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const { requireAdminPage } = await import('@/lib/auth/admin-guard');
    await expect(requireAdminPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('role !== admin → redirect("/")', async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } });
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'u-1', role: 'user', banned: false }]
    });
    const { requireAdminPage } = await import('@/lib/auth/admin-guard');
    await expect(requireAdminPage()).rejects.toThrow('NEXT_REDIRECT:/');
  });

  it('banned admin → redirect("/")', async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } });
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'u-1', role: 'admin', banned: true }]
    });
    const { requireAdminPage } = await import('@/lib/auth/admin-guard');
    await expect(requireAdminPage()).rejects.toThrow('NEXT_REDIRECT:/');
  });

  it('role === admin → returns { userId }', async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } });
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'u-1', role: 'admin', banned: false }]
    });
    const { requireAdminPage } = await import('@/lib/auth/admin-guard');
    const result = await requireAdminPage();
    expect(result).toEqual({ userId: 'u-1' });
  });
});

describe('requireAdminApi', () => {
  it('no session → { response: 401 }', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const { requireAdminApi } = await import('@/lib/auth/admin-guard');
    const r = await requireAdminApi(new Request('http://x'));
    expect('response' in r).toBe(true);
    if ('response' in r) {
      expect(r.response.status).toBe(401);
      const body = (await r.response.json()) as { error: string };
      expect(body.error).toBe('unauthorized');
    }
  });

  it('role === user → { response: 403 forbidden }', async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } });
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'u-1', role: 'user', banned: false }]
    });
    const { requireAdminApi } = await import('@/lib/auth/admin-guard');
    const r = await requireAdminApi(new Request('http://x'));
    if ('response' in r) {
      expect(r.response.status).toBe(403);
      const body = (await r.response.json()) as { error: string };
      expect(body.error).toBe('forbidden');
    }
  });

  it('banned admin → { response: 403 banned }', async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } });
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'u-1', role: 'admin', banned: true }]
    });
    const { requireAdminApi } = await import('@/lib/auth/admin-guard');
    const r = await requireAdminApi(new Request('http://x'));
    if ('response' in r) {
      expect(r.response.status).toBe(403);
      const body = (await r.response.json()) as { error: string };
      expect(body.error).toBe('banned');
    }
  });

  it('role === admin + not banned → { userId }', async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } });
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'u-1', role: 'admin', banned: false }]
    });
    const { requireAdminApi } = await import('@/lib/auth/admin-guard');
    const r = await requireAdminApi(new Request('http://x'));
    expect(r).toEqual({ userId: 'u-1' });
  });
});

describe('requireUserSession — single getSession + single DB lookup', () => {
  it('no session → 401, NO DB lookup', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const { requireUserSession } = await import('@/lib/auth/admin-guard');
    const r = await requireUserSession(new Request('http://x'));
    if ('response' in r) {
      expect(r.response.status).toBe(401);
    }
    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('banned user → 403 with suspension message', async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } });
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'u-1', role: 'user', banned: true }]
    });
    const { requireUserSession } = await import('@/lib/auth/admin-guard');
    const r = await requireUserSession(new Request('http://x'));
    if ('response' in r) {
      expect(r.response.status).toBe(403);
      const body = (await r.response.json()) as { error: string };
      expect(body.error).toMatch(/suspended/);
    }
  });

  it('healthy user → { session: { userId, role } }, exactly one getSession call', async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } });
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'u-1', role: 'user', banned: false }]
    });
    const { requireUserSession } = await import('@/lib/auth/admin-guard');
    const r = await requireUserSession(new Request('http://x'));
    expect(r).toEqual({ session: { userId: 'u-1', role: 'user' } });
    // The point of W2-R: a single Better-Auth lookup per request, not two.
    expect(getSessionMock).toHaveBeenCalledTimes(1);
  });

  it('user without DB row → role defaults to "user", not banned', async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } });
    queryMock.mockResolvedValueOnce({ rows: [] });
    const { requireUserSession } = await import('@/lib/auth/admin-guard');
    const r = await requireUserSession(new Request('http://x'));
    expect(r).toEqual({ session: { userId: 'u-1', role: 'user' } });
  });
});
