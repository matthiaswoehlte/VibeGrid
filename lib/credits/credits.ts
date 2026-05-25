import 'server-only';
import { pool } from '@/lib/db/pg';
import type { CreditAction } from './cost-table';

/**
 * Plan 8.5 — server-only credit helpers.
 *
 * Atomic semantics (precedent: setNeutralVideoUrlAndClaimLipsync in
 * scenes-db.ts). Every balance-changing path uses a single UPDATE
 * with WHERE guard, so two concurrent pollers can't both pass a
 * "check, then write" check and produce a negative balance.
 *
 * Reserve lifecycle:
 *   reserveCredits   → action='reserve'        (amount < 0)
 *   settleReserve    → action='reserve_settle' (amount = refund, may be 0)
 *   refundReserve    → action='reserve_refund' (amount = full refund)
 *
 * settle/refund transactions carry meta.settled_reserve_ids: string[] —
 * a JSONB array of the closed reserve transaction UUIDs. getOpenReserveRows
 * unnests it via jsonb_array_elements_text, so multiple parallel reserves
 * on the same scene are correctly tracked (defensive — the retry flow
 * already refunds before re-reserving, so in practice it's always one).
 */

export class InsufficientCreditsError extends Error {
  readonly userId: string;
  readonly requested: number;
  constructor(userId: string, requested: number) {
    super(`Insufficient credits for user ${userId} (requested ${requested})`);
    this.name = 'InsufficientCreditsError';
    this.userId = userId;
    this.requested = requested;
  }
}

export interface TransactionMeta {
  fal_request_id?: string;
  model_id?: string;
  duration_sec?: number;
  fal_cost_usd_cents?: number;
  reserved_amount?: number;
  overage_credits?: number;
  settled_reserve_ids?: string[];
  reason?: string;
  story_id?: string;
  scene_id?: string;
  // Plan 8.6 — admin who issued the grant (admin_grant action only).
  admin_id?: string;
}

// ---------- Read paths ----------

/**
 * Hot-path balance read: SELECT only, no UPSERT. Returns 0 if the user
 * has no credits row yet. Used by status-all polling so 4-s ticks
 * don't fire UPSERT writes against the same row repeatedly.
 */
export async function readBalance(userId: string): Promise<number> {
  const { rows } = await pool.query<{ balance: number }>(
    `SELECT balance FROM public."VG_user_credits" WHERE user_id = $1`,
    [userId]
  );
  return rows[0]?.balance ?? 0;
}

/**
 * Lazy-init + onboarding-default. The CTE atomically:
 *   1. INSERTs a 500-credit row on first call (ON CONFLICT DO NOTHING).
 *   2. INSERTs an 'onboarding_default' transaction ONLY when step 1 inserted.
 * Two concurrent getBalance calls for the same new user produce exactly
 * one onboarding_default row.
 *
 * Used by submit paths (Phase 1/2 entry routes) — they're going to write
 * anyway, so the UPSERT overhead is acceptable. Use readBalance in hot
 * polling paths.
 */
export async function getBalance(userId: string): Promise<number> {
  await pool.query(
    `WITH ins AS (
       INSERT INTO public."VG_user_credits" (user_id, balance)
       VALUES ($1, 500)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING user_id, balance
     )
     INSERT INTO public."VG_credit_transactions"
       (user_id, amount, balance_after, action)
     SELECT user_id, balance, balance, 'onboarding_default' FROM ins`,
    [userId]
  );
  const { rows } = await pool.query<{ balance: number }>(
    `SELECT balance FROM public."VG_user_credits" WHERE user_id = $1`,
    [userId]
  );
  return rows[0]!.balance;
}

// ---------- Reserve lifecycle internals ----------

interface OpenReserveRow {
  id: string;
  amount: number;
}

/**
 * Returns the reserve transactions that have not yet been settled or
 * refunded for a given scene. The NOT IN subquery uses
 * jsonb_array_elements_text to unnest each settle/refund transaction's
 * settled_reserve_ids array.
 */
async function getOpenReserveRows(sceneId: string): Promise<OpenReserveRow[]> {
  const { rows } = await pool.query<OpenReserveRow>(
    `SELECT id::text AS id, amount
     FROM public."VG_credit_transactions"
     WHERE scene_id = $1
       AND action   = 'reserve'
       AND id::text NOT IN (
         SELECT jsonb_array_elements_text(t.meta->'settled_reserve_ids')
         FROM public."VG_credit_transactions" t
         WHERE t.scene_id = $1
           AND t.action IN ('reserve_settle', 'reserve_refund')
           AND t.meta ? 'settled_reserve_ids'
       )`,
    [sceneId]
  );
  return rows;
}

/** Sum of open reserves for a scene (UI / pre-flight surface). */
export async function getOpenReserve(sceneId: string): Promise<number> {
  const open = await getOpenReserveRows(sceneId);
  return open.reduce((sum, r) => sum + -r.amount, 0);
}

/**
 * Append-only audit log writer. story_id/scene_id are lifted out of meta
 * so they land in indexed columns. The full meta blob (incl. those keys)
 * is kept for completeness.
 */
async function logTransaction(
  userId: string,
  amount: number,
  balanceAfter: number,
  action: CreditAction,
  meta?: TransactionMeta
): Promise<void> {
  await pool.query(
    `INSERT INTO public."VG_credit_transactions"
       (user_id, amount, balance_after, action, story_id, scene_id, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      amount,
      balanceAfter,
      action,
      meta?.story_id ?? null,
      meta?.scene_id ?? null,
      meta ? JSON.stringify(meta) : null
    ]
  );
}

// ---------- Atomic mutations ----------

/**
 * Atomic decrement: the WHERE balance >= $1 guard ensures concurrent
 * pollers can't both succeed when only one could fit the balance.
 * On rowCount === 0 we throw InsufficientCreditsError.
 *
 * The DB-level CHECK (balance >= 0) is a redundant defense. If a bug
 * ever bypassed the WHERE guard, Postgres raises 23514, which we
 * normalize to the same error type so callers have one branch to handle.
 */
export async function deductCredits(
  userId: string,
  amount: number,
  action: CreditAction,
  meta?: TransactionMeta
): Promise<number> {
  if (amount <= 0) {
    throw new Error(`deductCredits requires positive amount, got ${amount}`);
  }
  try {
    const { rows, rowCount } = await pool.query<{ balance: number }>(
      `UPDATE public."VG_user_credits"
         SET balance        = balance - $1,
             lifetime_spent = lifetime_spent + $1,
             updated_at     = now()
       WHERE user_id = $2 AND balance >= $1
       RETURNING balance`,
      [amount, userId]
    );
    if (rowCount === 0) throw new InsufficientCreditsError(userId, amount);
    const newBalance = rows[0]!.balance;
    await logTransaction(userId, -amount, newBalance, action, meta);
    return newBalance;
  } catch (err) {
    if (
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === '23514'
    ) {
      throw new InsufficientCreditsError(userId, amount);
    }
    throw err;
  }
}

/** Aufladung. Used by admin grants and refund/settle paths. */
export async function grantCredits(
  userId: string,
  amount: number,
  action: CreditAction,
  meta?: TransactionMeta
): Promise<number> {
  if (amount < 0) {
    throw new Error(`grantCredits requires non-negative amount, got ${amount}`);
  }
  const { rows } = await pool.query<{ balance: number }>(
    `UPDATE public."VG_user_credits"
       SET balance    = balance + $1,
           updated_at = now()
     WHERE user_id    = $2
     RETURNING balance`,
    [amount, userId]
  );
  if (rows.length === 0) {
    throw new Error(`User credits row not found: ${userId}`);
  }
  const newBalance = rows[0]!.balance;
  await logTransaction(userId, amount, newBalance, action, meta);
  return newBalance;
}

/**
 * Bucks the same row as deductCredits but tags the transaction as a
 * reserve so settleReserve / refundReserve can find it later.
 */
export async function reserveCredits(
  userId: string,
  amount: number,
  meta: { story_id: string; scene_id: string; model_id: string }
): Promise<number> {
  return deductCredits(userId, amount, 'reserve', meta);
}

/**
 * Settle an open reserve after a fal job COMPLETED. Three branches —
 * all three emit a reserve_settle transaction with settled_reserve_ids
 * so getOpenReserveRows can mark the reserves as closed.
 *
 *   actual <  reserved  → grantCredits(reserved-actual) — refund difference
 *   actual === reserved → zero-amount marker transaction
 *   actual >  reserved  → log warning, zero-amount marker with overage
 *
 * The over-budget case is absorbed by the 10% estimator buffer + the
 * SAFETY_BUFFER. We don't try to deduct the overage from the user.
 */
export async function settleReserve(
  userId: string,
  sceneId: string,
  actual: number,
  meta: TransactionMeta
): Promise<void> {
  const open = await getOpenReserveRows(sceneId);
  if (open.length === 0) return;
  const reserved = open.reduce((sum, r) => sum + -r.amount, 0);
  const settledIds = open.map((r) => r.id);
  const currentBalance = await readBalance(userId);

  if (actual < reserved) {
    await grantCredits(userId, reserved - actual, 'reserve_settle', {
      ...meta,
      reserved_amount: reserved,
      settled_reserve_ids: settledIds
    });
    return;
  }
  if (actual > reserved) {
    // eslint-disable-next-line no-console
    console.warn(
      `[credits] overage scene=${sceneId} reserved=${reserved} actual=${actual}`
    );
    await logTransaction(userId, 0, currentBalance, 'reserve_settle', {
      ...meta,
      reserved_amount: reserved,
      overage_credits: actual - reserved,
      settled_reserve_ids: settledIds
    });
    return;
  }
  // actual === reserved — marker transaction so getOpenReserveRows sees it as closed
  await logTransaction(userId, 0, currentBalance, 'reserve_settle', {
    ...meta,
    reserved_amount: reserved,
    settled_reserve_ids: settledIds
  });
}

/**
 * Full refund — used for fal FAILED/CANCELLED and the implicit cancel
 * before a retry-video re-reserve.
 */
export async function refundReserve(
  userId: string,
  sceneId: string,
  meta: TransactionMeta
): Promise<void> {
  const open = await getOpenReserveRows(sceneId);
  if (open.length === 0) return;
  const total = open.reduce((sum, r) => sum + -r.amount, 0);
  const settledIds = open.map((r) => r.id);
  await grantCredits(userId, total, 'reserve_refund', {
    ...meta,
    settled_reserve_ids: settledIds
  });
}

// ---------- Budget cap ----------

/**
 * Sum of credits spent against a story — actual deductions + currently
 * reserved amounts. Reserves count so the budget cap surface reflects
 * in-flight commitments, not just settled ones.
 */
export async function getStorySpend(storyId: string): Promise<number> {
  const { rows } = await pool.query<{ spent: number }>(
    `SELECT COALESCE(SUM(-amount), 0)::int AS spent
     FROM public."VG_credit_transactions"
     WHERE story_id = $1
       AND action IN (
         'flux_image', 'kling_video_5s', 'kling_video_10s',
         'sync_lipsync_5s', 'sync_lipsync_10s', 'musetalk',
         'elevenlabs_tts', 'reserve'
       )`,
    [storyId]
  );
  return rows[0]!.spent;
}
