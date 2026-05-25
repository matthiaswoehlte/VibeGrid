import { NextResponse } from 'next/server';
import { requireUserSession } from '@/lib/auth/admin-guard';
import { loadSceneById, patchSceneRender } from '@/lib/sceneflow/scenes-db';
import { loadStory } from '@/lib/sceneflow/stories-db';
import {
  generateAndStoreImages,
  planRetryImage,
  applyRetryPlanPatch
} from '@/lib/sceneflow/render-pipeline';
import {
  getBalance,
  deductCredits,
  InsufficientCreditsError
} from '@/lib/credits/credits';
import { COST_TABLE, SAFETY_BUFFER } from '@/lib/credits/cost-table';

export const runtime = 'nodejs';

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

  // Pre-flight credit check (image is a one-shot direct deduct).
  const balance = await getBalance(userId);
  if (balance < COST_TABLE.flux_image + SAFETY_BUFFER) {
    return NextResponse.json(
      {
        error:
          `You do not have sufficient credits to perform this action. ` +
          `This run requires ${COST_TABLE.flux_image} credits ` +
          `(plus a $1.00 safety buffer), but your current balance is ` +
          `${balance} credits.`
      },
      { status: 402 }
    );
  }

  // Reset image-related state, preserve neutral_video_url. [Fix D5]
  const plan = planRetryImage(scene);
  const patch = applyRetryPlanPatch(scene, plan);
  await patchSceneRender(scene.id, patch);

  const fresh = await loadSceneById(scene.id);
  if (!fresh) {
    return NextResponse.json({ error: 'not found after reset' }, { status: 500 });
  }

  const [result] = await generateAndStoreImages({ story, scenes: [fresh] });

  if (result?.ok) {
    try {
      await deductCredits(
        userId,
        COST_TABLE.flux_image,
        'flux_image',
        { story_id: story.id, scene_id: scene.id }
      );
    } catch (e) {
      if (!(e instanceof InsufficientCreditsError)) throw e;
      // eslint-disable-next-line no-console
      console.warn(
        `[credits] retry-image succeeded but deduct failed for ${scene.id}`
      );
    }
  }

  return NextResponse.json({ result });
}
