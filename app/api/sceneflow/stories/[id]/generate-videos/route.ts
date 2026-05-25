import { NextResponse } from 'next/server';
import { requireUserSession } from '@/lib/auth/admin-guard';
import { loadStory } from '@/lib/sceneflow/stories-db';
import { listScenes } from '@/lib/sceneflow/scenes-db';
import { enqueueVideoJobs } from '@/lib/sceneflow/render-pipeline';
import {
  getBalance,
  reserveCredits,
  getStorySpend,
  InsufficientCreditsError
} from '@/lib/credits/credits';
import { estimatePhase2Cost } from '@/lib/credits/estimator';
import { COST_TABLE, SAFETY_BUFFER } from '@/lib/credits/cost-table';
import type { SceneRecord } from '@/lib/sceneflow/types';

export const runtime = 'nodejs';

function scenePhase2Cost(
  scene: SceneRecord,
  lipsyncModel: string
): number {
  if (scene.type === 'endcard') return 0;
  const klingPart =
    scene.duration <= 5
      ? COST_TABLE.kling_video_5s
      : COST_TABLE.kling_video_10s;
  if (scene.type === 'action') return klingPart;
  const lipPart =
    lipsyncModel === 'fal-ai/musetalk'
      ? COST_TABLE.musetalk
      : scene.duration <= 5
        ? COST_TABLE.sync_lipsync_5s
        : COST_TABLE.sync_lipsync_10s;
  return klingPart + lipPart;
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const guard = await requireUserSession(req);
  if ('response' in guard) return guard.response;
  const { userId } = guard.session;

  const story = await loadStory({
    userId,
    storyId: params.id
  });
  if (!story) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const scenes = await listScenes(userId, params.id);
  const missingImage = scenes.find(
    (s) => s.type !== 'endcard' && s.image_url === null
  );
  if (missingImage) {
    return NextResponse.json(
      {
        error: 'phase-1-incomplete',
        message: 'Some scenes still need image generation (Phase 1)'
      },
      { status: 400 }
    );
  }

  // Pre-flight credit + budget check (comfort — reserves below are authoritative).
  const estimate = estimatePhase2Cost(scenes, story);
  const balance = await getBalance(userId);
  if (balance < estimate + SAFETY_BUFFER) {
    return NextResponse.json(
      {
        error:
          `You do not have sufficient credits to perform this action. ` +
          `This run requires approximately ${estimate} credits ` +
          `(plus a $1.00 safety buffer), but your current balance is ` +
          `${balance} credits.`
      },
      { status: 402 }
    );
  }
  if (story.credit_budget !== null && story.credit_budget !== undefined) {
    const spent = await getStorySpend(story.id);
    const remaining = story.credit_budget - spent;
    if (estimate > remaining) {
      return NextResponse.json(
        {
          error:
            `This run would exceed your story budget of ${story.credit_budget} ` +
            `credits. Already spent: ${spent}. Estimated cost: ${estimate}.`
        },
        { status: 402 }
      );
    }
  }

  // Per-scene atomic reserve before each fal submit.
  const results = await enqueueVideoJobs({
    story,
    scenes,
    beforeSubmit: async (scene) => {
      const amount = scenePhase2Cost(scene, story.lipsync_model);
      if (amount === 0) return;
      await reserveCredits(userId, amount, {
        story_id: story.id,
        scene_id: scene.id,
        model_id: story.video_model
      });
    }
  });

  // If reserve threw mid-loop, that scene's outcome is ok:false.
  const reserveErrs = results.filter(
    (r) => !r.ok && /Insufficient credits/i.test(r.error ?? '')
  );
  if (reserveErrs.length > 0) {
    return NextResponse.json(
      {
        error:
          `Credit reservation failed mid-run after ${
            results.filter((r) => r.ok).length
          } scene(s). Already-reserved credits will refund when those jobs ` +
          `complete or fail.`,
        results
      },
      { status: 402 }
    );
  }

  const enqueued = results.filter((r) => r.ok).length;
  return NextResponse.json({ enqueued, results });
}

// Re-export for typing
export type { InsufficientCreditsError };
