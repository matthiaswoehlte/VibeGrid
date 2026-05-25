import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth/admin-guard';
import { pool } from '@/lib/db/pg';

export const runtime = 'nodejs';

interface UserListRow {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  banned: boolean | null;
  banReason: string | null;
  createdAt: string;
  balance: number;
  lifetime_spent: number;
}

export async function GET(req: Request): Promise<Response> {
  const guard = await requireAdminApi(req);
  if ('response' in guard) return guard.response;

  // COALESCE so users without a VG_user_credits row (never hit a billable
  // action) show 0, not null. UI renders 0 cleanly; null would NaN.
  const { rows } = await pool.query<UserListRow>(
    `SELECT u.id, u.name, u.email, u.role, u.banned, u."banReason",
            u."createdAt",
            COALESCE(c.balance,        0)::int AS balance,
            COALESCE(c.lifetime_spent, 0)::int AS lifetime_spent
     FROM public."user" u
     LEFT JOIN public."VG_user_credits" c ON c.user_id = u.id
     ORDER BY u."createdAt" DESC`
  );
  return NextResponse.json({ users: rows });
}
