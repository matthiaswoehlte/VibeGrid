import { NextResponse } from 'next/server';
import { requireUserSession } from '@/lib/auth/admin-guard';
import { loadSceneById, patchSceneRender } from '@/lib/sceneflow/scenes-db';
import { loadStory } from '@/lib/sceneflow/stories-db';
import { listCharactersByIds } from '@/lib/sceneflow/characters-db';
import { synthesizeForCharacter } from '@/lib/sceneflow/tts';
import { uploadAssetToR2 } from '@/lib/sceneflow/fal-to-r2';
import {
  getBalance,
  deductCredits,
  InsufficientCreditsError
} from '@/lib/credits/credits';
import { COST_TABLE, SAFETY_BUFFER } from '@/lib/credits/cost-table';

export const runtime = 'nodejs';

/**
 * Plan post-8.6 — per-scene voice/TTS re-generation.
 *
 * Use case: user changed the tts_text or wants a different voice, but
 * doesn't want to re-run the whole Phase 1 (which would re-do all images
 * too). Re-synthesizes audio with the current tts_text + character voice,
 * uploads to R2, updates audio_url. Does NOT touch video_url — the
 * existing lipsync video still references the OLD audio, so the user
 * must follow up with retry-video to refresh the lipsync (which uses
 * the now-cached neutral_video_url and only re-runs the lipsync step).
 */
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
  const story = await loadStory({ userId, storyId: scene.story_id });
  if (!story) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  if (scene.audio_type === 'none') {
    return NextResponse.json(
      { error: 'Scene has audio_type=none, nothing to synthesize' },
      { status: 400 }
    );
  }
  if (scene.speaking_character_id === null) {
    return NextResponse.json(
      { error: 'Scene has no speaking_character_id assigned' },
      { status: 400 }
    );
  }
  if (scene.tts_text === null || scene.tts_text.trim().length === 0) {
    return NextResponse.json(
      { error: 'Scene has no tts_text. Type something first.' },
      { status: 400 }
    );
  }

  const [character] = await listCharactersByIds(userId, [
    scene.speaking_character_id
  ]);
  if (!character) {
    return NextResponse.json(
      { error: 'Speaking character not found' },
      { status: 400 }
    );
  }

  // Pre-flight credit check (only ElevenLabs costs; Edge is free).
  const cost =
    character.voice_provider === 'elevenlabs' ? COST_TABLE.elevenlabs_tts : 0;
  if (cost > 0) {
    const balance = await getBalance(userId);
    if (balance < cost + SAFETY_BUFFER) {
      return NextResponse.json(
        {
          error:
            `You do not have sufficient credits to perform this action. ` +
            `This run requires ${cost} credits (plus a $1.00 safety buffer), ` +
            `but your current balance is ${balance} credits.`
        },
        { status: 402 }
      );
    }
  }

  // Reset audio_url so a concurrent status-route poll doesn't see a
  // stale audio path; synthesize fresh; write back.
  await patchSceneRender(scene.id, { audio_url: null });

  let buf: Buffer;
  try {
    buf = await synthesizeForCharacter(character, scene.tts_text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await patchSceneRender(scene.id, {
      status: 'error',
      error_message: `tts retry: ${msg}`
    }).catch(() => {});
    return NextResponse.json(
      { error: 'TTS synthesis failed: ' + msg },
      { status: 502 }
    );
  }

  const url = await uploadAssetToR2({
    userId: story.user_id,
    storyId: story.id,
    sceneId: scene.id,
    kind: 'audio',
    body: new Uint8Array(buf)
  });
  await patchSceneRender(scene.id, { audio_url: url });

  if (cost > 0) {
    try {
      await deductCredits(userId, cost, 'elevenlabs_tts', {
        story_id: story.id,
        scene_id: scene.id,
        model_id: character.voice_provider ?? 'unknown'
      });
    } catch (e) {
      if (!(e instanceof InsufficientCreditsError)) throw e;
      // eslint-disable-next-line no-console
      console.warn(`[credits] retry-audio synth ok but deduct failed for ${scene.id}`);
    }
  }

  return NextResponse.json({
    sceneId: scene.id,
    audioUrl: url,
    provider: character.voice_provider,
    voiceId: character.voice_id,
    message:
      'Audio neu generiert. LipSync-Video referenziert noch die alte Audio — bitte "Video neu" klicken.'
  });
}
