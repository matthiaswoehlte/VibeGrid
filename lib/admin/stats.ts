import 'server-only';
import { pool } from '@/lib/db/pg';

/**
 * Plan 8.6 — admin dashboard stats.
 *
 * Server-Components import this directly (no fetch round-trip to a
 * sibling API route). The /api/admin/dashboard endpoint exists for
 * external consumers (admin CLI, future webhook).
 *
 * All five queries below run in parallel via Promise.all — the
 * dashboard cold-load latency is bound by the slowest query (the
 * `created_at DESC LIMIT 20` join), typically <50 ms on Supabase.
 */

const FAL_COST_ACTIONS = [
  'flux_image',
  'kling_video_5s',
  'kling_video_10s',
  'sync_lipsync_5s',
  'sync_lipsync_10s',
  'musetalk',
  'elevenlabs_tts'
];

export interface RecentTransaction {
  id: string;
  user_id: string;
  email: string | null;
  name: string | null;
  amount: number;
  balance_after: number;
  action: string;
  story_id: string | null;
  created_at: string;
}

export interface DashboardStats {
  active_users_30d: number;
  total_granted: number;
  total_spent: number;
  fal_calls_30d: number;
  recent_transactions: RecentTransaction[];
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [activeUsers, totalGranted, totalSpent, falCalls, recent] =
    await Promise.all([
      pool.query<{ active_users: number }>(
        `SELECT COUNT(DISTINCT "userId")::int AS active_users
         FROM public."session"
         WHERE "expiresAt" > now() - interval '30 days'`
      ),
      pool.query<{ total_granted: number }>(
        `SELECT COALESCE(SUM(amount), 0)::int AS total_granted
         FROM public."VG_credit_transactions"
         WHERE action IN ('admin_grant', 'onboarding_default')`
      ),
      pool.query<{ total_spent: number }>(
        `SELECT COALESCE(SUM(-amount), 0)::int AS total_spent
         FROM public."VG_credit_transactions"
         WHERE action = ANY($1::text[])`,
        [FAL_COST_ACTIONS]
      ),
      pool.query<{ fal_calls_30d: number }>(
        `SELECT COUNT(*)::int AS fal_calls_30d
         FROM public."VG_credit_transactions"
         WHERE action = ANY($1::text[])
           AND created_at > now() - interval '30 days'`,
        [FAL_COST_ACTIONS]
      ),
      pool.query<RecentTransaction>(
        `SELECT ct.id, ct.user_id, u.email, u.name,
                ct.amount, ct.balance_after, ct.action,
                ct.story_id, ct.created_at
         FROM public."VG_credit_transactions" ct
         LEFT JOIN public."user" u ON u.id = ct.user_id
         ORDER BY ct.created_at DESC
         LIMIT 20`
      )
    ]);

  return {
    active_users_30d: activeUsers.rows[0]?.active_users ?? 0,
    total_granted: totalGranted.rows[0]?.total_granted ?? 0,
    total_spent: totalSpent.rows[0]?.total_spent ?? 0,
    fal_calls_30d: falCalls.rows[0]?.fal_calls_30d ?? 0,
    recent_transactions: recent.rows
  };
}
