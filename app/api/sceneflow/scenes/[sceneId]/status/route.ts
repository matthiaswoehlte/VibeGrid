import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { loadSceneById } from '@/lib/sceneflow/scenes-db';
import { loadStory } from '@/lib/sceneflow/stories-db';
import {
  advanceSceneRender,
  type FalStatusOrFailed
} from '@/lib/sceneflow/render-pipeline';
import { settleReserve, refundReserve } from '@/lib/credits/credits';
import { COST_TABLE } from '@/lib/credits/cost-table';
import type { SceneRecord, StoryRecord } from '@/lib/sceneflow/types';

export const runtime = 'nodejs';

const ALLOWED_SIM_STATUS: ReadonlySet<FalStatusOrFailed> = new Set([
  'IN_QUEUE',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED'
]);

function actualCostForScene(scene: SceneRecord, story: StoryRecord): number {
  if (scene.type === 'endcard') return 0;
  const klingPart =
    scene.duration <= 5
      ? COST_TABLE.kling_video_5s
      : COST_TABLE.kling_video_10s;
  if (scene.type === 'action') return klingPart;
  const lipPart =
    story.lipsync_model === 'fal-ai/musetalk'
      ? COST_TABLE.musetalk
      : scene.duration <= 5
        ? COST_TABLE.sync_lipsync_5s
        : COST_TABLE.sync_lipsync_10s;
  return klingPart + lipPart;
}

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

  // React to credit events. settle and refund are idempotent — settle's
  // marker transaction prevents double-counting, refund's getOpenReserveRows
  // returns [] after the first call.
  if (result.creditEvent === 'settle') {
    const actual = actualCostForScene(scene, story);
    await settleReserve(session.user.id, scene.id, actual, {
      story_id: story.id,
      scene_id: scene.id,
      model_id: story.video_model
    });
  } else if (result.creditEvent === 'refund') {
    await refundReserve(session.user.id, scene.id, {
      story_id: story.id,
      scene_id: scene.id,
      reason: 'fal_failed'
    });
  }

  return NextResponse.json(result);
}
