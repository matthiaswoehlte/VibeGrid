// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();

vi.mock('@/lib/db/pg', () => ({
  pool: { query: (sql: string, params?: unknown[]) => queryMock(sql, params) }
}));

beforeEach(() => {
  queryMock.mockReset();
});

/**
 * Test harness for the credits.ts atomic SQL semantics.
 *
 * Each test wires a query() mock that returns canned rows per call.
 * We assert both behaviour (return values, thrown errors) and SQL
 * surface (which UPDATE/INSERT fired, with which params).
 */

describe('readBalance — hot path', () => {
  it('returns balance from SELECT', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ balance: 487 }], rowCount: 1 });
    const { readBalance } = await import('@/lib/credits/credits');
    const b = await readBalance('u-1');
    expect(b).toBe(487);
    expect(queryMock.mock.calls[0]![0]).toMatch(/SELECT balance/);
    expect(queryMock.mock.calls[0]![1]).toEqual(['u-1']);
  });

  it('returns 0 when no row exists (no UPSERT)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { readBalance } = await import('@/lib/credits/credits');
    expect(await readBalance('u-new')).toBe(0);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});

describe('getBalance — lazy init via CTE', () => {
  it('runs CTE-upsert-with-onboarding-log and returns balance', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // CTE insert
      .mockResolvedValueOnce({ rows: [{ balance: 500 }], rowCount: 1 });
    const { getBalance } = await import('@/lib/credits/credits');
    const b = await getBalance('u-new');
    expect(b).toBe(500);
    expect(queryMock.mock.calls[0]![0]).toMatch(/WITH ins AS/);
    expect(queryMock.mock.calls[0]![0]).toMatch(/onboarding_default/);
    expect(queryMock.mock.calls[1]![0]).toMatch(/SELECT balance/);
  });
});

describe('deductCredits — atomic decrement', () => {
  it('UPDATE includes WHERE balance >= $1 guard + logs transaction', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ balance: 410 }], rowCount: 1 }) // UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // logTransaction INSERT
    const { deductCredits } = await import('@/lib/credits/credits');
    const newBal = await deductCredits('u-1', 90, 'kling_video_5s', {
      scene_id: 'sc-1',
      fal_request_id: 'req-x'
    });
    expect(newBal).toBe(410);
    expect(queryMock.mock.calls[0]![0]).toMatch(/balance\s*-\s*\$1/);
    expect(queryMock.mock.calls[0]![0]).toMatch(/balance >= \$1/);
    expect(queryMock.mock.calls[1]![0]).toMatch(/INSERT INTO public\."VG_credit_transactions"/);
    // amount is negative in log
    expect(queryMock.mock.calls[1]![1]![1]).toBe(-90);
  });

  it('throws InsufficientCreditsError when WHERE rowCount === 0', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { deductCredits, InsufficientCreditsError } = await import(
      '@/lib/credits/credits'
    );
    await expect(
      deductCredits('u-broke', 9999, 'kling_video_5s')
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
  });

  it('normalizes Postgres 23514 CHECK violation to InsufficientCreditsError', async () => {
    const pgErr = Object.assign(new Error('check constraint violated'), {
      code: '23514'
    });
    queryMock.mockRejectedValueOnce(pgErr);
    const { deductCredits, InsufficientCreditsError } = await import(
      '@/lib/credits/credits'
    );
    await expect(
      deductCredits('u-1', 100, 'flux_image')
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
  });

  it('rejects non-positive amount as programmer error', async () => {
    const { deductCredits } = await import('@/lib/credits/credits');
    await expect(deductCredits('u-1', 0, 'flux_image')).rejects.toThrow(
      /positive amount/
    );
    await expect(deductCredits('u-1', -5, 'flux_image')).rejects.toThrow(
      /positive amount/
    );
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('grantCredits', () => {
  it('UPDATE adds amount and logs positive transaction', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ balance: 1500 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const { grantCredits } = await import('@/lib/credits/credits');
    const b = await grantCredits('u-1', 1000, 'admin_grant');
    expect(b).toBe(1500);
    expect(queryMock.mock.calls[0]![0]).toMatch(/balance\s*\+\s*\$1/);
    expect(queryMock.mock.calls[1]![1]![1]).toBe(1000); // positive in log
  });

  it('throws when user row does not exist', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { grantCredits } = await import('@/lib/credits/credits');
    await expect(grantCredits('u-ghost', 100, 'admin_grant')).rejects.toThrow(
      /not found/
    );
  });
});

describe('settleReserve — 3-branch with settled_reserve_ids', () => {
  it('actual < reserved → refunds difference with settled_reserve_ids array', async () => {
    queryMock
      // getOpenReserveRows
      .mockResolvedValueOnce({
        rows: [{ id: 'tx-reserve-1', amount: -100 }],
        rowCount: 1
      })
      // readBalance
      .mockResolvedValueOnce({ rows: [{ balance: 400 }], rowCount: 1 })
      // grantCredits UPDATE
      .mockResolvedValueOnce({ rows: [{ balance: 410 }], rowCount: 1 })
      // logTransaction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const { settleReserve } = await import('@/lib/credits/credits');
    await settleReserve('u-1', 'sc-1', 90, { scene_id: 'sc-1' });
    // grantCredits UPDATE +10 ($1.00 refund)
    expect(queryMock.mock.calls[2]![0]).toMatch(/balance\s*\+\s*\$1/);
    expect(queryMock.mock.calls[2]![1]![0]).toBe(10);
    // logTransaction meta carries settled_reserve_ids as JSON array
    const metaJson = JSON.parse(queryMock.mock.calls[3]![1]![6] as string);
    expect(metaJson.settled_reserve_ids).toEqual(['tx-reserve-1']);
    expect(metaJson.reserved_amount).toBe(100);
  });

  it('actual === reserved → zero-amount marker with settled_reserve_ids', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'tx-reserve-2', amount: -90 }],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [{ balance: 410 }], rowCount: 1 }) // readBalance
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // logTransaction
    const { settleReserve } = await import('@/lib/credits/credits');
    await settleReserve('u-1', 'sc-1', 90, { scene_id: 'sc-1' });
    expect(queryMock).toHaveBeenCalledTimes(3);
    // logTransaction was called with balance_after === current readBalance (410)
    expect(queryMock.mock.calls[2]![1]![1]).toBe(0); // amount=0
    expect(queryMock.mock.calls[2]![1]![2]).toBe(410); // balance_after
    const metaJson = JSON.parse(queryMock.mock.calls[2]![1]![6] as string);
    expect(metaJson.settled_reserve_ids).toEqual(['tx-reserve-2']);
  });

  it('actual > reserved → overage logged, no -1 sentinel in balance_after', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'tx-reserve-3', amount: -90 }],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [{ balance: 320 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { settleReserve } = await import('@/lib/credits/credits');
    await settleReserve('u-1', 'sc-1', 95, { scene_id: 'sc-1' });
    expect(queryMock.mock.calls[2]![1]![1]).toBe(0); // amount
    expect(queryMock.mock.calls[2]![1]![2]).toBe(320); // balance_after — fresh, not -1
    const metaJson = JSON.parse(queryMock.mock.calls[2]![1]![6] as string);
    expect(metaJson.overage_credits).toBe(5);
    expect(metaJson.settled_reserve_ids).toEqual(['tx-reserve-3']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('no open reserve → no-op, no DB writes', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { settleReserve } = await import('@/lib/credits/credits');
    await settleReserve('u-1', 'sc-1', 90, {});
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});

describe('refundReserve', () => {
  it('grants the full reserved amount back with settled_reserve_ids array', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          { id: 'tx-r-a', amount: -50 },
          { id: 'tx-r-b', amount: -40 }
        ],
        rowCount: 2
      })
      .mockResolvedValueOnce({ rows: [{ balance: 590 }], rowCount: 1 }) // grant UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // logTransaction
    const { refundReserve } = await import('@/lib/credits/credits');
    await refundReserve('u-1', 'sc-1', { reason: 'fal_failed' });
    expect(queryMock.mock.calls[1]![1]![0]).toBe(90); // grant amount = 50+40
    const metaJson = JSON.parse(queryMock.mock.calls[2]![1]![6] as string);
    expect(metaJson.settled_reserve_ids).toEqual(['tx-r-a', 'tx-r-b']);
    expect(metaJson.reason).toBe('fal_failed');
  });

  it('no open reserve → no-op', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { refundReserve } = await import('@/lib/credits/credits');
    await refundReserve('u-1', 'sc-x', {});
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});

describe('getOpenReserve — uses jsonb_array_elements_text unnest', () => {
  it('returns 0 when no open reserves remain', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { getOpenReserve } = await import('@/lib/credits/credits');
    expect(await getOpenReserve('sc-1')).toBe(0);
    expect(queryMock.mock.calls[0]![0]).toMatch(/jsonb_array_elements_text/);
  });

  it('sums the open reserve amounts', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: 'a', amount: -90 },
        { id: 'b', amount: -10 }
      ],
      rowCount: 2
    });
    const { getOpenReserve } = await import('@/lib/credits/credits');
    expect(await getOpenReserve('sc-1')).toBe(100);
  });
});

describe('getStorySpend', () => {
  it('sums spend + reserves for a story', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ spent: 247 }], rowCount: 1 });
    const { getStorySpend } = await import('@/lib/credits/credits');
    expect(await getStorySpend('st-1')).toBe(247);
    expect(queryMock.mock.calls[0]![0]).toMatch(/SUM\(-amount\)/);
    expect(queryMock.mock.calls[0]![0]).toMatch(/'reserve'/);
  });
});
