import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
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

export const runtime = 'nodejs';
// Phase 1 work is bounded — TTS is sync but capped at 3-parallel; image
// jobs are fal.subscribe (5–15 s each). 60 s is normally enough, but be
// generous when the platform allows.
export const maxDuration = 300;

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
  if (scenes.length === 0) {
    return NextResponse.json(
      { error: 'no scenes — run scene generation first' },
      { status: 400 }
    );
  }

  const characters = await listCharactersByIds(
    session.user.id,
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

  // Run TTS first (sync, max-3 concurrency). FLUX image generation runs
  // in parallel with the TTS step — both are awaited together. fal.ai
  // throttles image queue internally, so we don't cap concurrency.
  const [ttsResults, imageResults] = await Promise.all([
    runTtsForScenes({
      userId: session.user.id,
      storyId: story.id,
      scenes,
      characters
    }),
    generateAndStoreImages({ story, scenes })
  ]);

  const ttsOk = ttsResults.filter((r) => r.ok).length;
  const imagesOk = imageResults.filter((r) => r.ok).length;

  return NextResponse.json({
    tts: { ok: ttsOk, total: ttsResults.length, results: ttsResults },
    images: {
      ok: imagesOk,
      total: imageResults.length,
      results: imageResults
    }
  });
}
