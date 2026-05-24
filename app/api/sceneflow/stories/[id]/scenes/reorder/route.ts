import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { swapSceneOrder } from '@/lib/sceneflow/scenes-db';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const b = body as { aId?: unknown; bId?: unknown };
  if (typeof b.aId !== 'string' || typeof b.bId !== 'string' || b.aId === b.bId) {
    return NextResponse.json({ error: 'invalid scene ids' }, { status: 400 });
  }
  const ok = await swapSceneOrder({
    userId: session.user.id,
    aId: b.aId,
    bId: b.bId
  });
  if (!ok) return NextResponse.json({ error: 'not found or cross-story' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
