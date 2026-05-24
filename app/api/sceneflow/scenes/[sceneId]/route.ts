import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { updateScene, deleteScene } from '@/lib/sceneflow/scenes-db';
import type { UpdateScenePatch } from '@/lib/sceneflow/scenes-db';

export const runtime = 'nodejs';

async function userId(req: Request): Promise<string | null> {
  const s = await auth.api.getSession({ headers: req.headers });
  return s?.user.id ?? null;
}

export async function PATCH(
  req: Request,
  { params }: { params: { sceneId: string } }
): Promise<Response> {
  const uid = await userId(req);
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const ok = await updateScene({
    userId: uid,
    sceneId: params.sceneId,
    patch: body as UpdateScenePatch
  });
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: { sceneId: string } }
): Promise<Response> {
  const uid = await userId(req);
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const ok = await deleteScene({ userId: uid, sceneId: params.sceneId });
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
