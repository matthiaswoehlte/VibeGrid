import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { loadSceneById } from '@/lib/sceneflow/scenes-db';
import { loadStory } from '@/lib/sceneflow/stories-db';
import {
  advanceSceneRender,
  type FalStatusOrFailed
} from '@/lib/sceneflow/render-pipeline';
import { handleCreditEvent } from '@/lib/sceneflow/scene-credit-event-handler';

export const runtime = 'nodejs';

const ALLOWED_SIM_STATUS: ReadonlySet<FalStatusOrFailed> = new Set([
  'IN_QUEUE',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED'
]);

export async function GET(
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

  // Plan 8.5 [Fix D3] — test seam for FAILED-simulation, only outside
  // production. Lets us exercise the refund branch without provoking a
  // real fal-side failure.
  let simulatedFalStatus: FalStatusOrFailed | undefined;
  if (process.env.NODE_ENV !== 'production') {
    const sim = new URL(req.url).searchParams.get('simulateStatus');
    if (sim && ALLOWED_SIM_STATUS.has(sim as FalStatusOrFailed)) {
      simulatedFalStatus = sim as FalStatusOrFailed;
    }
  }

  const result = await advanceSceneRender({
    scene,
    story,
    ...(simulatedFalStatus ? { simulatedFalStatus } : {})
  });

  // [Settle-bug fix] Same helper as status-all so both polling paths
  // agree on settle/refund. settle/refund are idempotent (settle's
  // marker transaction + refund's empty-set early-return).
  await handleCreditEvent({
    userId: session.user.id,
    scene,
    story,
    result
  });

  return NextResponse.json(result);
}
