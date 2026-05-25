import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth/admin-guard';
import { pool } from '@/lib/db/pg';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const guard = await requireAdminApi(req);
  if ('response' in guard) return guard.response;
  const { userId: adminId } = guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const b = body as { banned?: unknown; reason?: unknown };
  if (typeof b.banned !== 'boolean') {
    return NextResponse.json({ error: 'banned must be boolean' }, { status: 400 });
  }
  const banned = b.banned;
  const reason = typeof b.reason === 'string' ? b.reason : null;

  // [Fix D2-R] Self-ban guard — admin can't lock themselves out via the API.
  if (banned && params.id === adminId) {
    return NextResponse.json(
      { error: 'You cannot ban your own account.' },
      { status: 400 }
    );
  }

  if (banned) {
    // camelCase quoted — Better-Auth schema convention for the user table.
    await pool.query(
      `UPDATE public."user" SET banned = true, "banReason" = $1 WHERE id = $2`,
      [reason, params.id]
    );
    // Session-revoke: delete every active session for this user. Better-Auth
    // admin-plugin would do this for us, but it's not installed (Schritt 0).
    await pool.query(`DELETE FROM public."session" WHERE "userId" = $1`, [
      params.id
    ]);
  } else {
    await pool.query(
      `UPDATE public."user" SET banned = false, "banReason" = NULL WHERE id = $1`,
      [params.id]
    );
  }

  return NextResponse.json({ ok: true, banned });
}
