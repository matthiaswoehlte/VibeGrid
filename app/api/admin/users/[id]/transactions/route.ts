import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth/admin-guard';
import { pool } from '@/lib/db/pg';

export const runtime = 'nodejs';

const PAGE_SIZE = 25;

interface TransactionRow {
  id: string;
  user_id: string;
  amount: number;
  balance_after: number;
  action: string;
  story_id: string | null;
  scene_id: string | null;
  meta: unknown;
  created_at: string;
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const guard = await requireAdminApi(req);
  if ('response' in guard) return guard.response;

  const url = new URL(req.url);
  const pageRaw = parseInt(url.searchParams.get('page') ?? '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const [rows, count] = await Promise.all([
    pool.query<TransactionRow>(
      `SELECT id, user_id, amount, balance_after, action,
              story_id, scene_id, meta, created_at
       FROM public."VG_credit_transactions"
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [params.id, PAGE_SIZE, offset]
    ),
    pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM public."VG_credit_transactions" WHERE user_id = $1`,
      [params.id]
    )
  ]);

  return NextResponse.json({
    transactions: rows.rows,
    page,
    pageSize: PAGE_SIZE,
    total: count.rows[0]?.total ?? 0
  });
}
