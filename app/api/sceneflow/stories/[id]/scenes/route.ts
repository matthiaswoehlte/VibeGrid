import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { listScenes, createScenes } from '@/lib/sceneflow/scenes-db';
import type { NewSceneInput } from '@/lib/sceneflow/scenes-db';
import { loadStory } from '@/lib/sceneflow/stories-db';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const scenes = await listScenes(session.user.id, params.id);
  return NextResponse.json({ scenes });
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const b = body as { scenes?: unknown };
  if (!Array.isArray(b.scenes)) {
    return NextResponse.json({ error: 'invalid scenes' }, { status: 400 });
  }
  const story = await loadStory({ userId: session.user.id, storyId: params.id });
  if (!story) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const created = await createScenes(params.id, b.scenes as NewSceneInput[]);
  return NextResponse.json({ scenes: created }, { status: 201 });
}
