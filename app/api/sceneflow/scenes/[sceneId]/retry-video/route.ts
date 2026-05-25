import { NextResponse } from 'next/server';
import { requireUserSession } from '@/lib/auth/admin-guard';
import { loadSceneById, patchSceneRender } from '@/lib/sceneflow/scenes-db';
import { loadStory } from '@/lib/sceneflow/stories-db';
import {
  enqueueVideoJobs,
  enqueueLipSyncForScene,
  planRetryVideo,
  applyRetryPlanPatch
} from '@/lib/sceneflow/render-pipeline';
import type { FalLipSyncModel } from '@/lib/fal/client';
import {
  getBalance,
  reserveCredits,
  refundReserve,
  getOpenReserve,
  InsufficientCreditsError
} from '@/lib/credits/credits';
import { COST_TABLE, SAFETY_BUFFER } from '@/lib/credits/cost-table';
import type { SceneRecord, StoryRecord } from '@/lib/sceneflow/types';

export const runtime = 'nodejs';

function retryCost(scene: SceneRecord, story: StoryRecord): number {
  // [Fix D5] Dialog with neutral_video_url still present → only LipSync re-runs.
  if (scene.type === 'dialog' && scene.neutral_video_url !== null) {
    return story.lipsync_model === 'fal-ai/musetalk'
      ? COST_TABLE.musetalk
      : scene.duration <= 5
        ? COST_TABLE.sync_lipsync_5s
        : COST_TABLE.sync_lipsync_10s;
  }
  // Otherwise full Kling (+ LipSync if dialog).
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

export async function POST(
  req: Request,
  { params }: { params: { sceneId: string } }
): Promise<Response> {
  const guard = await requireUserSession(req);
  if ('response' in guard) return guard.response;
  const { userId } = guard.session;
  const scene = await loadSceneById(params.sceneId);
  if (!scene) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const story = await loadStory({
    userId,
    storyId: scene.story_id
  });
  if (!story) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Step 0 [Fix W5]: refund any open reserve from the previous fal job.
  const openReserve = await getOpenReserve(scene.id);
  if (openReserve > 0) {
    await refundReserve(userId, scene.id, {
      story_id: story.id,
      scene_id: scene.id,
      reason: 'implicit_cancel_on_retry'
    });
  }

  // Pre-flight credit check for the retry estimate.
  const estimate = retryCost(scene, story);
  const balance = await getBalance(userId);
  if (balance < estimate + SAFETY_BUFFER) {
    return NextResponse.json(
      {
        error:
          `You do not have sufficient credits to perform this action. ` +
          `This retry requires approximately ${estimate} credits ` +
          `(plus a $1.00 safety buffer), but your current balance is ` +
          `${balance} credits.`
      },
      { status: 402 }
    );
  }

  // [Fix D5] Reset request_ids + URLs per plan semantics.
  const plan = planRetryVideo(scene);
  const patch = applyRetryPlanPatch(scene, plan);
  await patchSceneRender(scene.id, patch);

  const fresh = await loadSceneById(scene.id);
  if (!fresh) {
    return NextResponse.json({ error: 'not found after reset' }, { status: 500 });
  }

  // Dialog with neutral_video_url present → step-B-only path. Submit the
  // lipsync job directly here — advanceSceneRender's auto-enqueue branch
  // only fires when neutral_video_url is still null (the first-run path),
  // so a retry where the neutral cached has to enqueue itself.
  if (
    fresh.type === 'dialog' &&
    fresh.neutral_video_url !== null &&
    fresh.video_url === null
  ) {
    try {
      await reserveCredits(userId, estimate, {
        story_id: story.id,
        scene_id: scene.id,
        model_id: story.lipsync_model
      });
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        return NextResponse.json(
          { error: 'Insufficient credits at reserve time' },
          { status: 402 }
        );
      }
      throw e;
    }

    let lipsyncRequestId: string;
    try {
      lipsyncRequestId = await enqueueLipSyncForScene({
        scene: fresh,
        neutralVideoUrl: fresh.neutral_video_url,
        lipsyncModel: story.lipsync_model as FalLipSyncModel
      });
    } catch (e) {
      // Submit failed — refund the reserve we just made and surface.
      const msg = e instanceof Error ? e.message : String(e);
      await patchSceneRender(scene.id, {
        status: 'error',
        error_message: `lipsync submit failed: ${msg}`
      }).catch(() => {});
      return NextResponse.json(
        { error: 'LipSync-Submit fehlgeschlagen: ' + msg },
        { status: 502 }
      );
    }

    await patchSceneRender(scene.id, {
      status: 'generating',
      fal_request_ids: {
        ...(fresh.fal_request_ids ?? {}),
        lipsync: lipsyncRequestId
      }
    });

    return NextResponse.json({
      retried: 'lipsync-only',
      requestId: lipsyncRequestId,
      message: 'LipSync läuft — Polling zeigt das fertige Video.'
    });
  }

  // Full Kling re-submit path. enqueueVideoJobs's beforeSubmit hook reserves
  // per scene atomically — if reserve fails, the fal submit doesn't fire.
  const [result] = await enqueueVideoJobs({
    story,
    scenes: [fresh],
    beforeSubmit: async (s) => {
      const amount = retryCost(s, story);
      if (amount === 0) return;
      await reserveCredits(userId, amount, {
        story_id: story.id,
        scene_id: s.id,
        model_id: story.video_model
      });
    }
  });

  if (result && !result.ok && /Insufficient credits/i.test(result.error ?? '')) {
    return NextResponse.json(
      { error: 'Insufficient credits at reserve time' },
      { status: 402 }
    );
  }

  return NextResponse.json({ result });
}
