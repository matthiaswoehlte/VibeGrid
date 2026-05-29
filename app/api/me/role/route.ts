import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { pool } from '@/lib/db/pg';

export const runtime = 'nodejs';

/**
 * Returns the current user's email, role, and banned status. Used by
 * the TopBar's UserSessionLoader to hydrate the user-session slice
 * once on app start. Better-Auth doesn't expose role/banned in the
 * session payload (no admin plugin in this project), so this endpoint
 * reads them from the user table directly.
 *
 * Response shape: `{ email, role, banned }`. All-null on no session.
 */
export async function GET(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return NextResponse.json(
      { email: null, role: null, banned: false },
      { status: 200 }
    );
  }
  const { rows } = await pool.query<{
    email: string | null;
    role: string | null;
    banned: boolean | null;
  }>(
    `SELECT email, role, banned FROM public."user" WHERE id = $1`,
    [session.user.id]
  );
  return NextResponse.json({
    email: rows[0]?.email ?? session.user.email ?? null,
    role: rows[0]?.role ?? 'user',
    banned: rows[0]?.banned ?? false
  });
}
