// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionMock = vi.fn();
const queryMock = vi.fn();
const grantCreditsMock = vi.fn();
const getBalanceMock = vi.fn();
const getDashboardStatsMock = vi.fn();

vi.mock('next/headers', () => ({
  headers: vi.fn(() => new Headers())
}));
vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession: (...a: unknown[]) => getSessionMock(...a) } }
}));
vi.mock('@/lib/db/pg', () => ({
  pool: { query: (sql: string, params?: unknown[]) => queryMock(sql, params) }
}));
vi.mock('@/lib/credits/credits', () => ({
  grantCredits: (...a: unknown[]) => grantCreditsMock(...a),
  getBalance: (...a: unknown[]) => getBalanceMock(...a)
}));
vi.mock('@/lib/admin/stats', () => ({
  getDashboardStats: () => getDashboardStatsMock()
}));

beforeEach(() => {
  getSessionMock.mockReset();
  queryMock.mockReset();
  grantCreditsMock.mockReset();
  getBalanceMock.mockReset();
  getDashboardStatsMock.mockReset();
});

/** Helper: mock requireAdminApi success path — session + admin DB row. */
function mockAdminSession(adminId = 'admin-1') {
  getSessionMock.mockResolvedValueOnce({ user: { id: adminId } });
  queryMock.mockResolvedValueOnce({
    rows: [{ id: adminId, role: 'admin', banned: false }]
  });
}

describe('GET /api/admin/users', () => {
  it('401 without session', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const { GET } = await import('@/app/api/admin/users/route');
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(401);
  });

  it('403 forbidden when role !== admin', async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } });
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'u-1', role: 'user', banned: false }]
    });
    const { GET } = await import('@/app/api/admin/users/route');
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(403);
  });

  it('returns user list with COALESCEd balance (no NaN for users without credits row)', async () => {
    mockAdminSession();
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'u-a',
          name: 'Anna',
          email: 'a@a',
          role: 'user',
          banned: false,
          banReason: null,
          createdAt: '2026-02-15',
          balance: 500,
          lifetime_spent: 0
        },
        {
          // User never hit a billable action → COALESCEd to 0
          id: 'u-b',
          name: 'Bob',
          email: 'b@b',
          role: 'user',
          banned: false,
          banReason: null,
          createdAt: '2026-02-16',
          balance: 0,
          lifetime_spent: 0
        }
      ]
    });
    const { GET } = await import('@/app/api/admin/users/route');
    const res = await GET(new Request('http://x'));
    const body = (await res.json()) as { users: Array<{ balance: number }> };
    expect(body.users).toHaveLength(2);
    expect(body.users[1]!.balance).toBe(0);
  });
});

describe('POST /api/admin/users/[id]/grant-credits', () => {
  it('grants credits + records admin_id in TransactionMeta', async () => {
    mockAdminSession('admin-1');
    getBalanceMock.mockResolvedValueOnce(500);
    grantCreditsMock.mockResolvedValueOnce(1500);
    const { POST } = await import(
      '@/app/api/admin/users/[id]/grant-credits/route'
    );
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ amount: 1000, reason: 'demo bonus' })
    });
    const res = await POST(req, { params: { id: 'u-target' } });
    expect(res.status).toBe(200);
    expect(grantCreditsMock).toHaveBeenCalledWith(
      'u-target',
      1000,
      'admin_grant',
      expect.objectContaining({
        admin_id: 'admin-1',
        reason: 'demo bonus'
      })
    );
  });

  it('rejects amount <= 0 with 400', async () => {
    mockAdminSession();
    const { POST } = await import(
      '@/app/api/admin/users/[id]/grant-credits/route'
    );
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ amount: 0 })
    });
    const res = await POST(req, { params: { id: 'u-target' } });
    expect(res.status).toBe(400);
    expect(grantCreditsMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/users/[id]/ban', () => {
  it('bans user + deletes session rows (own SQL path, plugin not installed)', async () => {
    mockAdminSession('admin-1');
    queryMock
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE user
      .mockResolvedValueOnce({ rowCount: 2 }); // DELETE session
    const { POST } = await import('@/app/api/admin/users/[id]/ban/route');
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ banned: true, reason: 'abuse' })
    });
    const res = await POST(req, { params: { id: 'u-target' } });
    expect(res.status).toBe(200);
    // calls[0] = admin lookup, calls[1] = UPDATE user, calls[2] = DELETE session
    expect(queryMock.mock.calls[1]![0]).toMatch(
      /UPDATE public\."user" SET banned = true.*"banReason" = \$1/
    );
    expect(queryMock.mock.calls[1]![1]).toEqual(['abuse', 'u-target']);
    expect(queryMock.mock.calls[2]![0]).toMatch(
      /DELETE FROM public\."session".*"userId" = \$1/
    );
    expect(queryMock.mock.calls[2]![1]).toEqual(['u-target']);
  });

  it('self-ban refused with 400', async () => {
    mockAdminSession('admin-self');
    const { POST } = await import('@/app/api/admin/users/[id]/ban/route');
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ banned: true })
    });
    const res = await POST(req, { params: { id: 'admin-self' } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/cannot ban your own account/i);
    // No UPDATE or DELETE fired
    expect(queryMock).toHaveBeenCalledTimes(1); // only the admin lookup
  });

  it('unban path → UPDATE only, no session delete', async () => {
    mockAdminSession('admin-1');
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    const { POST } = await import('@/app/api/admin/users/[id]/ban/route');
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ banned: false })
    });
    const res = await POST(req, { params: { id: 'u-target' } });
    expect(res.status).toBe(200);
    expect(queryMock.mock.calls[1]![0]).toMatch(
      /UPDATE public\."user" SET banned = false, "banReason" = NULL/
    );
    // No DELETE FROM session for unban
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});

describe('GET /api/admin/users/[id]/transactions', () => {
  it('paginates with OFFSET = (page - 1) * 25', async () => {
    mockAdminSession();
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // transactions
      .mockResolvedValueOnce({ rows: [{ total: 73 }] });
    const { GET } = await import(
      '@/app/api/admin/users/[id]/transactions/route'
    );
    const res = await GET(new Request('http://x?page=3'), {
      params: { id: 'u-target' }
    });
    const body = (await res.json()) as {
      page: number;
      pageSize: number;
      total: number;
    };
    expect(body.page).toBe(3);
    expect(body.pageSize).toBe(25);
    expect(body.total).toBe(73);
    expect(queryMock.mock.calls[1]![1]).toEqual(['u-target', 25, 50]);
  });

  it('defaults to page=1 when missing/invalid', async () => {
    mockAdminSession();
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });
    const { GET } = await import(
      '@/app/api/admin/users/[id]/transactions/route'
    );
    const res = await GET(new Request('http://x'), {
      params: { id: 'u-target' }
    });
    const body = (await res.json()) as { page: number };
    expect(body.page).toBe(1);
    expect(queryMock.mock.calls[1]![1]).toEqual(['u-target', 25, 0]);
  });
});

describe('GET /api/admin/dashboard', () => {
  it('delegates to getDashboardStats lib', async () => {
    mockAdminSession();
    getDashboardStatsMock.mockResolvedValueOnce({
      active_users_30d: 11,
      total_granted: 5500,
      total_spent: 234,
      fal_calls_30d: 47,
      recent_transactions: []
    });
    const { GET } = await import('@/app/api/admin/dashboard/route');
    const res = await GET(new Request('http://x'));
    const body = (await res.json()) as { active_users_30d: number };
    expect(body.active_users_30d).toBe(11);
  });
});
