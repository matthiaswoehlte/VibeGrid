import { NextResponse } from 'next/server';
import { requireUserSession } from '@/lib/auth/admin-guard';
import { loadStory } from '@/lib/sceneflow/stories-db';
import { listScenes } from '@/lib/sceneflow/scenes-db';
import { listCharactersByIds } from '@/lib/sceneflow/characters-db';
import {
  runTtsForScenes,
  generateAndStoreImages
} from '@/lib/sceneflow/render-pipeline';
import {
  validateScenesForGeneration,
  hasBlockers
} from '@/lib/sceneflow/validation';
import {
  readBalance,
  getBalance,
  deductCredits,
  getStorySpend,
  InsufficientCreditsError
} from '@/lib/credits/credits';
import { estimatePhase1Cost } from '@/lib/credits/estimator';
import { COST_TABLE, SAFETY_BUFFER } from '@/lib/credits/cost-table';

export const runtime = 'nodejs';
export const maxDuration = 300;

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
  if (scenes.length === 0) {
    return NextResponse.json(
      { error: 'no scenes — run scene generation first' },
      { status: 400 }
    );
  }

  const characters = await listCharactersByIds(
    userId,
    story.characters
  );

  const warnings = validateScenesForGeneration({
    story,
    scenes,
    characters
  });
  if (hasBlockers(warnings)) {
    return NextResponse.json(
      { error: 'validation-blocked', warnings },
      { status: 400 }
    );
  }

  // Credit pre-flight (comfort check — atomic deducts below are authoritative).
  const estimate = estimatePhase1Cost(scenes, story, characters);
  const balance = await getBalance(userId); // lazy-init on first run
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

  const [ttsResults, imageResults] = await Promise.all([
    runTtsForScenes({
      userId: userId,
      storyId: story.id,
      scenes,
      characters
    }),
    generateAndStoreImages({ story, scenes })
  ]);

  // Deduct per successful outcome. Order: images first (FLUX is the dominant
  // cost), then TTS. Each deduct is atomic; a mid-run InsufficientCredits is
  // logged but doesn't undo the fal call — the safety buffer + pre-flight
  // make this rare enough to accept.
  const charById = new Map(characters.map((c) => [c.id, c]));
  for (const r of imageResults) {
    if (!r.ok) continue;
    try {
      await deductCredits(userId, COST_TABLE.flux_image, 'flux_image', {
        story_id: story.id,
        scene_id: r.sceneId
      });
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        // eslint-disable-next-line no-console
        console.warn(`[credits] mid-run insufficient on flux ${r.sceneId}`);
      } else throw e;
    }
  }
  for (const r of ttsResults) {
    if (!r.ok) continue;
    const scene = scenes.find((s) => s.id === r.sceneId);
    const speakerId = scene?.speaking_character_id;
    const speaker = speakerId !== undefined && speakerId !== null
      ? charById.get(speakerId)
      : undefined;
    if (!speaker) continue;
    const provider = speaker.voice_provider;
    // Only ElevenLabs is billable in Phase 1 TTS.
    // Edge is free; Azure is blocked by validation upstream.
    if (provider !== 'elevenlabs') continue;
    try {
      await deductCredits(
        userId,
        COST_TABLE.elevenlabs_tts,
        'elevenlabs_tts',
        {
          story_id: story.id,
          scene_id: r.sceneId,
          model_id: provider
        }
      );
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        // eslint-disable-next-line no-console
        console.warn(`[credits] mid-run insufficient on tts ${r.sceneId}`);
      } else throw e;
    }
  }

  const ttsOk = ttsResults.filter((r) => r.ok).length;
  const imagesOk = imageResults.filter((r) => r.ok).length;
  const finalBalance = await readBalance(userId);

  return NextResponse.json({
    tts: { ok: ttsOk, total: ttsResults.length, results: ttsResults },
    images: {
      ok: imagesOk,
      total: imageResults.length,
      results: imageResults
    },
    balance: finalBalance
  });
}
