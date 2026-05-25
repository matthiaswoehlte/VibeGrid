import 'server-only';
import { settleReserve, refundReserve } from '@/lib/credits/credits';
import { COST_TABLE } from '@/lib/credits/cost-table';
import type { SceneRecord, StoryRecord } from './types';
import type { AdvanceSceneResult } from './render-pipeline';

/**
 * Plan 8.5 — single source of truth for "what did this scene actually
 * cost?". Used at settle time to compute the diff between what was
 * reserved and what was used.
 *
 * Endcard: 0. Action: kling only. Dialog: kling + lipsync (or musetalk).
 * The duration <= 5 cut-off matches the same split used at reserve-time
 * in generate-videos and retry-video routes so reserve/settle stay
 * symmetric.
 */
export function actualCostForScene(
  scene: SceneRecord,
  story: StoryRecord
): number {
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

/**
 * React to advanceSceneRender's creditEvent. Both the single-scene
 * /status route and the batch /status-all route call this so the
 * reserve→settle/refund accounting stays consistent across whichever
 * polling path the client uses.
 *
 * settle/refund are idempotent (settleReserve emits a marker that
 * getOpenReserveRows excludes; refundReserve early-returns on
 * empty open-reserve set), so re-firing during a parallel poll is
 * harmless.
 */
export async function handleCreditEvent(args: {
  userId: string;
  scene: SceneRecord;
  story: StoryRecord;
  result: AdvanceSceneResult;
}): Promise<void> {
  if (args.result.creditEvent === 'settle') {
    const actual = actualCostForScene(args.scene, args.story);
    await settleReserve(args.userId, args.scene.id, actual, {
      story_id: args.story.id,
      scene_id: args.scene.id,
      model_id: args.story.video_model
    });
  } else if (args.result.creditEvent === 'refund') {
    await refundReserve(args.userId, args.scene.id, {
      story_id: args.story.id,
      scene_id: args.scene.id,
      reason: 'fal_failed'
    });
  }
}
