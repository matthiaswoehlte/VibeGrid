import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { loadSceneById, patchSceneRender } from '@/lib/sceneflow/scenes-db';
import { loadStory } from '@/lib/sceneflow/stories-db';
import {
  generateAndStoreImages,
  planRetryImage,
  applyRetryPlanPatch
} from '@/lib/sceneflow/render-pipeline';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: { sceneId: string } }
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const scene = await loadSceneById(params.sceneId);
  if (!scene) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const story = await loadStory({
    userId: session.user.id,
    storyId: scene.story_id
  });
  if (!story) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // [Fix D5] reset only image-related state; preserve neutral_video_url.
  const plan = planRetryImage(scene);
  const patch = applyRetryPlanPatch(scene, plan);
  await patchSceneRender(scene.id, patch);

  const fresh = await loadSceneById(scene.id);
  if (!fresh) {
    return NextResponse.json({ error: 'not found after reset' }, { status: 500 });
  }

  const [result] = await generateAndStoreImages({
    story,
    scenes: [fresh]
  });
  return NextResponse.json({ result });
}
