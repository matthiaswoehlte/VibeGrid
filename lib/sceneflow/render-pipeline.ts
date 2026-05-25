import 'server-only';
import type { CharacterRecord, SceneRecord, StoryRecord } from './types';
import { patchSceneRender } from './scenes-db';
import { uploadAssetToR2, falUrlToR2 } from './fal-to-r2';
import { synthesizeForCharacter } from './tts';
import {
  generateImage,
  submitVideoJob,
  submitLipSyncJob,
  submitMuseTalkJob,
  storyFormatToImageSize,
  type FalImageModel,
  type FalVideoModel,
  type FalLipSyncModel
} from '@/lib/fal/client';

/**
 * Plan 8c — render-pipeline orchestration.
 *
 * Phase 1: TTS (sync, max-3 concurrency for rate-limit protection)
 *          + FLUX image jobs (queue-submitted, fal.ai handles throttling).
 *
 * Phase 2: Kling video job per scene. Dialog scenes get a neutral-portrait
 *          first step; the status polling route auto-enqueues the lipsync
 *          second step (see [Fix N1]) so the client doesn't pay round-trip
 *          latency × scene-count to chain them.
 *
 * No fal call for endcards.
 */

// ---------- Concurrency helper ----------

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  async function next(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        const value = await worker(items[idx]!, idx);
        results[idx] = { status: 'fulfilled', value };
      } catch (e) {
        results[idx] = { status: 'rejected', reason: e };
      }
    }
  }
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => next()));
  return results;
}

// ---------- Phase 1: TTS ----------

export interface RunTtsForScenesInput {
  userId: string;
  storyId: string;
  scenes: SceneRecord[];
  characters: CharacterRecord[];
}

export interface TtsOutcome {
  sceneId: string;
  ok: boolean;
  url?: string;
  error?: string;
}

export async function runTtsForScenes(
  input: RunTtsForScenesInput
): Promise<TtsOutcome[]> {
  const charMap = new Map(input.characters.map((c) => [c.id, c]));
  const targets = input.scenes.filter(
    (s) => s.audio_type !== 'none' && s.tts_text !== null && s.tts_text !== '' &&
           s.audio_url === null
  );

  const settled = await runWithConcurrency(targets, 3, async (scene) => {
    if (scene.speaking_character_id === null) {
      throw new Error(`Scene ${scene.id}: no speaking_character_id`);
    }
    const character = charMap.get(scene.speaking_character_id);
    if (!character) {
      throw new Error(
        `Scene ${scene.id}: speaking_character_id not in story.characters`
      );
    }
    const buf = await synthesizeForCharacter(character, scene.tts_text!);
    const url = await uploadAssetToR2({
      userId: input.userId,
      storyId: input.storyId,
      sceneId: scene.id,
      kind: 'audio',
      body: new Uint8Array(buf)
    });
    await patchSceneRender(scene.id, { audio_url: url });
    return url;
  });

  return targets.map((scene, i): TtsOutcome => {
    const r = settled[i]!;
    if (r.status === 'fulfilled') {
      return { sceneId: scene.id, ok: true, url: r.value };
    }
    const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
    void patchSceneRender(scene.id, { error_message: `tts: ${msg}` }).catch(() => {});
    return { sceneId: scene.id, ok: false, error: msg };
  });
}

// ---------- Phase 1: FLUX image enqueue ----------

export interface EnqueueImagesInput {
  story: StoryRecord;
  scenes: SceneRecord[];
}

export interface ImageEnqueueOutcome {
  sceneId: string;
  ok: boolean;
  imageUrl?: string;
  error?: string;
}

/**
 * Image generation via fal.subscribe — short call, fits in Vercel-Hobby's
 * 60-s timeout for batched-but-bounded number of scenes. fal.ai handles
 * its own queue/throttle internally, so we don't cap concurrency client-side.
 */
export async function generateAndStoreImages(
  input: EnqueueImagesInput
): Promise<ImageEnqueueOutcome[]> {
  const targets = input.scenes.filter(
    (s) => s.type !== 'endcard' && s.image_url === null && s.image_prompt !== null
  );
  const imageSize = storyFormatToImageSize(input.story.format);
  const model = input.story.image_model as FalImageModel;

  const settled = await Promise.allSettled(
    targets.map(async (scene): Promise<string> => {
      const result = await generateImage({
        prompt: scene.image_prompt!,
        imageSize,
        model
      });
      const r2Url = await falUrlToR2(result.url, {
        userId: input.story.user_id,
        storyId: input.story.id,
        sceneId: scene.id,
        kind: 'image'
      });
      await patchSceneRender(scene.id, { image_url: r2Url });
      return r2Url;
    })
  );

  return targets.map((scene, i): ImageEnqueueOutcome => {
    const r = settled[i]!;
    if (r.status === 'fulfilled') {
      return { sceneId: scene.id, ok: true, imageUrl: r.value };
    }
    const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
    void patchSceneRender(scene.id, { error_message: `image: ${msg}` }).catch(() => {});
    return { sceneId: scene.id, ok: false, error: msg };
  });
}

// ---------- Phase 2: video enqueue ----------

export interface EnqueueVideosInput {
  story: StoryRecord;
  scenes: SceneRecord[];
}

export interface VideoEnqueueOutcome {
  sceneId: string;
  ok: boolean;
  requestId?: string;
  step?: 'neutral_video' | 'lipsync' | 'video';
  error?: string;
}

const NEUTRAL_PORTRAIT_PROMPT =
  'person standing still, natural subtle head movement, looking at camera, portrait medium shot';

export async function enqueueVideoJobs(
  input: EnqueueVideosInput
): Promise<VideoEnqueueOutcome[]> {
  const out: VideoEnqueueOutcome[] = [];
  const videoModel = input.story.video_model as FalVideoModel;

  for (const scene of input.scenes) {
    if (scene.type === 'endcard') {
      await patchSceneRender(scene.id, { status: 'done' });
      continue;
    }
    if (scene.image_url === null) continue; // Phase 1 not done for this scene
    if (scene.video_url !== null) continue; // already done

    try {
      if (scene.type === 'action') {
        if (scene.fal_request_ids?.video) {
          // already enqueued — skip
          continue;
        }
        const requestId = await submitVideoJob({
          prompt: scene.motion_prompt ?? '',
          imageUrl: scene.image_url,
          duration: scene.duration <= 5 ? '5' : '10',
          ...(scene.end_frame_url
            ? { endImageUrl: scene.end_frame_url }
            : {}),
          model: videoModel
        });
        await patchSceneRender(scene.id, {
          status: 'generating',
          fal_request_ids: { ...scene.fal_request_ids, video: requestId }
        });
        out.push({ sceneId: scene.id, ok: true, requestId, step: 'video' });
      } else {
        // dialog
        if (scene.fal_request_ids?.neutral_video || scene.neutral_video_url) {
          continue;
        }
        const requestId = await submitVideoJob({
          prompt: NEUTRAL_PORTRAIT_PROMPT,
          imageUrl: scene.image_url,
          duration: scene.duration <= 5 ? '5' : '10',
          model: videoModel
        });
        await patchSceneRender(scene.id, {
          status: 'generating',
          fal_request_ids: { ...scene.fal_request_ids, neutral_video: requestId }
        });
        out.push({
          sceneId: scene.id,
          ok: true,
          requestId,
          step: 'neutral_video'
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await patchSceneRender(scene.id, {
        status: 'error',
        error_message: `video-submit: ${msg}`
      }).catch(() => {});
      out.push({ sceneId: scene.id, ok: false, error: msg });
    }
  }
  return out;
}

// ---------- LipSync step enqueue (used by status route) ----------

export interface EnqueueLipSyncInput {
  scene: SceneRecord;
  neutralVideoUrl: string;
  lipsyncModel: FalLipSyncModel;
}

export async function enqueueLipSyncForScene(
  input: EnqueueLipSyncInput
): Promise<string> {
  if (!input.scene.audio_url) {
    throw new Error(
      `Cannot start LipSync — scene ${input.scene.id} has no audio_url`
    );
  }
  if (input.lipsyncModel === 'fal-ai/musetalk') {
    return submitMuseTalkJob({
      sourceVideoUrl: input.neutralVideoUrl,
      audioUrl: input.scene.audio_url
    });
  }
  return submitLipSyncJob({
    videoUrl: input.neutralVideoUrl,
    audioUrl: input.scene.audio_url
  });
}

// ---------- Retry helpers ----------

export interface RetryPlan {
  resetUrls: Array<'image_url' | 'audio_url' | 'neutral_video_url' | 'video_url'>;
  clearRequestKeys: Array<'image' | 'audio' | 'neutral_video' | 'lipsync' | 'video'>;
}

export function planRetryImage(_scene: SceneRecord): RetryPlan {
  return {
    resetUrls: ['image_url'],
    clearRequestKeys: ['image']
  };
}

/**
 * [Fix D5] Retry-Video Semantik:
 * - Wenn neutral_video_url vorhanden (Dialog mit fertigem Step 2):
 *   Nur Schritt 3 (LipSync) erneuern. Kein zweiter Kling-Call.
 * - Sonst (Action oder Dialog ohne neutral):
 *   Ab Step 2 (Kling) neu. neutral_video_url wird auch resettet.
 */
export function planRetryVideo(scene: SceneRecord): RetryPlan {
  if (scene.type === 'dialog' && scene.neutral_video_url !== null) {
    return {
      resetUrls: ['video_url'],
      clearRequestKeys: ['lipsync']
    };
  }
  return {
    resetUrls: ['video_url', 'neutral_video_url'],
    clearRequestKeys: ['video', 'neutral_video', 'lipsync']
  };
}

export function applyRetryPlanPatch(
  scene: SceneRecord,
  plan: RetryPlan
): {
  fal_request_ids: Record<string, string> | null;
  status: SceneRecord['status'];
  error_message: null;
  image_url?: string | null;
  audio_url?: string | null;
  neutral_video_url?: string | null;
  video_url?: string | null;
} {
  const remaining: Record<string, string> = { ...(scene.fal_request_ids ?? {}) };
  for (const k of plan.clearRequestKeys) delete remaining[k];
  const fal_request_ids = Object.keys(remaining).length === 0 ? null : remaining;
  const reset: Record<string, null> = {};
  for (const u of plan.resetUrls) reset[u] = null;
  return {
    fal_request_ids,
    status: 'pending',
    error_message: null,
    ...reset
  };
}
