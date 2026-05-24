import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { deleteStory } from '@/lib/sceneflow/stories-db';

export const runtime = 'nodejs';

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const ok = await deleteStory({ userId: session.user.id, storyId: params.id });
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
