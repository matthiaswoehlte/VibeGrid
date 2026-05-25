// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();

vi.mock('@/lib/db/pg', () => ({
  pool: { query: (sql: string, params?: unknown[]) => queryMock(sql, params) }
}));

beforeEach(() => {
  queryMock.mockReset();
});

describe('getDashboardStats — 5 parallel queries', () => {
  it('returns aggregated payload when all queries resolve', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ active_users: 11 }] }) // session
      .mockResolvedValueOnce({ rows: [{ total_granted: 5500 }] }) // granted
      .mockResolvedValueOnce({ rows: [{ total_spent: 234 }] }) // spent
      .mockResolvedValueOnce({ rows: [{ fal_calls_30d: 47 }] }) // fal calls
      .mockResolvedValueOnce({
        rows: [
          {
            id: 't1',
            user_id: 'u1',
            email: 'a@a',
            name: 'Anna',
            amount: -90,
            balance_after: 410,
            action: 'kling_video_5s',
            story_id: 'st1',
            created_at: '2026-05-25T10:00:00Z'
          }
        ]
      });

    const { getDashboardStats } = await import('@/lib/admin/stats');
    const stats = await getDashboardStats();
    expect(stats).toEqual({
      active_users_30d: 11,
      total_granted: 5500,
      total_spent: 234,
      fal_calls_30d: 47,
      recent_transactions: [
        expect.objectContaining({
          id: 't1',
          email: 'a@a',
          amount: -90,
          action: 'kling_video_5s'
        })
      ]
    });
  });

  it('zeroes out missing aggregates (empty tables)', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ active_users: 0 }] })
      .mockResolvedValueOnce({ rows: [{ total_granted: 0 }] })
      .mockResolvedValueOnce({ rows: [{ total_spent: 0 }] })
      .mockResolvedValueOnce({ rows: [{ fal_calls_30d: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const { getDashboardStats } = await import('@/lib/admin/stats');
    const stats = await getDashboardStats();
    expect(stats.active_users_30d).toBe(0);
    expect(stats.total_granted).toBe(0);
    expect(stats.recent_transactions).toEqual([]);
  });

  it('fires queries in parallel (Promise.all)', async () => {
    let resolveTimes: number[] = [];
    queryMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      resolveTimes.push(Date.now());
      return { rows: [{ active_users: 0, total_granted: 0, total_spent: 0, fal_calls_30d: 0 }] };
    });
    const { getDashboardStats } = await import('@/lib/admin/stats');
    const t0 = Date.now();
    await getDashboardStats();
    const elapsed = Date.now() - t0;
    // 5 queries × 10 ms serial = 50 ms; parallel < 30 ms with slack.
    expect(elapsed).toBeLessThan(40);
    expect(queryMock).toHaveBeenCalledTimes(5);
  });
});
