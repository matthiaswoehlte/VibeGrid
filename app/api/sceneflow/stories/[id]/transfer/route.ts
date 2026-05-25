import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { loadStory } from '@/lib/sceneflow/stories-db';
import { listScenes } from '@/lib/sceneflow/scenes-db';

export const runtime = 'nodejs';

/**
 * Plan 8c — Transfer to Timeline (stub).
 *
 * Returns the ordered list of finished clips. Plan 8d picks up here:
 * Timeline integration + Beat-Snap + crossfade overlap. For 8c, this
 * route is the contract surface so the SceneFlow UI can wire its
 * "Transfer" button.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const story = await loadStory({
    userId: session.user.id,
    storyId: params.id
  });
  if (!story) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const scenes = await listScenes(session.user.id, params.id);
  const clips = scenes
    .filter((s) => s.video_url !== null || s.type === 'endcard')
    .map((s) => ({
      sceneId: s.id,
      sceneOrder: s.scene_order,
      type: s.type,
      videoUrl: s.video_url,
      imageUrl: s.image_url,
      duration: s.duration,
      transition: s.transition
    }));
  return NextResponse.json({ storyId: story.id, clips });
}
