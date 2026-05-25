import 'server-only';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from './better-auth-server';
import { pool } from '@/lib/db/pg';

/**
 * Plan 8.6 — auth guards.
 *
 * Better-Auth is configured WITHOUT the admin plugin in this project, so
 * its inferred Session type doesn't expose `role` / `banned` / `banReason`
 * even though those columns exist on the user table (Better-Auth admin
 * schema was applied separately). Each guard reads them from Postgres
 * directly using the userId from the validated session, which has two
 * benefits over relying on session.user.role:
 *
 *  1. Fresh status: a user banned 5 minutes ago by another admin loses
 *     access on their next request, not when the cookie expires.
 *  2. No type gymnastics around the Better-Auth inferred shape.
 *
 * The user-table columns are camelCase quoted (`"banReason"`, not
 * `ban_reason`) — they were created by Better-Auth's own migrate tool,
 * which doesn't follow our snake_case convention. Stick to camelCase
 * for every column in the `"user"` and `"session"` tables.
 */

interface UserRow {
  id: string;
  role: string | null;
  banned: boolean | null;
}

async function loadUserById(userId: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, role, banned FROM public."user" WHERE id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

/**
 * Page/Layout guard — uses next/headers (server-component context) and
 * redirect() (NEXT_REDIRECT throw, rendered as 302 by Next).
 */
export async function requireAdminPage(): Promise<{ userId: string }> {
  const session = await auth.api.getSession({ headers: headers() });
  if (!session?.user) redirect('/login');
  const user = await loadUserById(session.user.id);
  if (!user || user.role !== 'admin') redirect('/');
  if (user.banned) redirect('/');
  return { userId: session.user.id };
}

/**
 * API-route guard — returns a discriminated union. Caller does:
 *
 *   const guard = await requireAdminApi(req);
 *   if ('response' in guard) return guard.response;
 *   const { userId } = guard;
 */
export type AdminApiResult =
  | { userId: string }
  | { response: Response };

export async function requireAdminApi(req: Request): Promise<AdminApiResult> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return {
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    };
  }
  const user = await loadUserById(session.user.id);
  if (!user || user.role !== 'admin') {
    return {
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 })
    };
  }
  if (user.banned) {
    return {
      response: NextResponse.json({ error: 'banned' }, { status: 403 })
    };
  }
  return { userId: session.user.id };
}

/**
 * General user-session guard — single Better-Auth lookup + single DB read,
 * returns 401 for no-session and 403 for banned. Replaces the older
 * pattern of "auth.api.getSession + separate banned check" in the fal-
 * billable routes so each request makes one Better-Auth call instead of two.
 */
export type UserSession = {
  userId: string;
  role: string;
};

export type UserSessionResult =
  | { session: UserSession }
  | { response: Response };

export async function requireUserSession(
  req: Request
): Promise<UserSessionResult> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return {
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    };
  }
  const user = await loadUserById(session.user.id);
  if (user?.banned) {
    return {
      response: NextResponse.json(
        { error: 'Your account has been suspended.' },
        { status: 403 }
      )
    };
  }
  return {
    session: {
      userId: session.user.id,
      role: user?.role ?? 'user'
    }
  };
}
