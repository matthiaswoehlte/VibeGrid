import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth/admin-guard';
import { getBalance, grantCredits } from '@/lib/credits/credits';

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
  const b = body as { amount?: unknown; reason?: unknown };
  if (
    typeof b.amount !== 'number' ||
    !Number.isFinite(b.amount) ||
    b.amount <= 0
  ) {
    return NextResponse.json({ error: 'amount must be a positive integer' }, { status: 400 });
  }
  const amount = Math.floor(b.amount);
  const reason = typeof b.reason === 'string' ? b.reason : undefined;

  // Ensure the target user has a VG_user_credits row before granting —
  // grantCredits throws if the row is missing, since it's a pure UPDATE.
  await getBalance(params.id);

  const newBalance = await grantCredits(params.id, amount, 'admin_grant', {
    admin_id: adminId,
    reason
  });
  return NextResponse.json({ ok: true, balance: newBalance });
}
