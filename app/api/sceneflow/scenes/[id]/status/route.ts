import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { loadSceneById } from '@/lib/sceneflow/scenes-db';
import { loadStory } from '@/lib/sceneflow/stories-db';
import { advanceSceneRender } from '@/lib/sceneflow/render-pipeline';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const scene = await loadSceneById(params.id);
  if (!scene) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const story = await loadStory({
    userId: session.user.id,
    storyId: scene.story_id
  });
  if (!story) {
    // Story exists but isn't owned by the session user — same 404 as missing.
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const result = await advanceSceneRender({ scene, story });
  return NextResponse.json(result);
}
