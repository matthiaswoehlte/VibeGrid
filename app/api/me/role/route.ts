import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { pool } from '@/lib/db/pg';

export const runtime = 'nodejs';

/**
 * Returns the current user's role + banned status. Used by the TopBar
 * to decide whether to render the Admin link. Without this endpoint
 * the client would need to know role/banned out of the session payload,
 * which Better-Auth doesn't expose without the admin plugin.
 */
export async function GET(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return NextResponse.json({ role: null, banned: false }, { status: 200 });
  }
  const { rows } = await pool.query<{ role: string | null; banned: boolean | null }>(
    `SELECT role, banned FROM public."user" WHERE id = $1`,
    [session.user.id]
  );
  return NextResponse.json({
    role: rows[0]?.role ?? 'user',
    banned: rows[0]?.banned ?? false
  });
}
