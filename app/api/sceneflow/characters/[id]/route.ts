import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { updateCharacter, deleteCharacter } from '@/lib/sceneflow/characters-db';
import type { UpdateCharacterPatch } from '@/lib/sceneflow/characters-db';

export const runtime = 'nodejs';

async function getUserId(req: Request): Promise<string | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  return session?.user.id ?? null;
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const ok = await updateCharacter({
    userId,
    characterId: params.id,
    patch: body as UpdateCharacterPatch
  });
  if (!ok) return NextResponse.json({ error: 'not found or unchanged' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const ok = await deleteCharacter({ userId, characterId: params.id });
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
