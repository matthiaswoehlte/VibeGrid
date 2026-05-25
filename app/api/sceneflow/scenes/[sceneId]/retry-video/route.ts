import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { loadSceneById, patchSceneRender } from '@/lib/sceneflow/scenes-db';
import { loadStory } from '@/lib/sceneflow/stories-db';
import {
  enqueueVideoJobs,
  planRetryVideo,
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

  // [Fix D5] If neutral_video_url already exists (Dialog with Kling done),
  // only LipSync is reset; the orchestrator status route will see the
  // missing lipsync request_id + present neutral_video_url and re-submit
  // step B on the next poll. Otherwise the full video step (or Action) is
  // reset and re-enqueued here.
  const plan = planRetryVideo(scene);
  const patch = applyRetryPlanPatch(scene, plan);
  await patchSceneRender(scene.id, patch);

  const fresh = await loadSceneById(scene.id);
  if (!fresh) {
    return NextResponse.json({ error: 'not found after reset' }, { status: 500 });
  }

  if (
    fresh.type === 'dialog' &&
    fresh.neutral_video_url !== null &&
    fresh.video_url === null
  ) {
    // Step-B-only retry: caller polls /status and the status route
    // claims+enqueues the lipsync job idempotently.
    return NextResponse.json({
      retried: 'lipsync-only',
      message: 'Poll /status to advance the LipSync step'
    });
  }

  const [result] = await enqueueVideoJobs({
    story,
    scenes: [fresh]
  });
  return NextResponse.json({ result });
}
