import type {
  CharacterRecord,
  SceneRecord,
  StoryRecord
} from '@/lib/sceneflow/types';
import { COST_TABLE } from './cost-table';

/**
 * Plan 8.5 — pre-flight cost estimator.
 *
 * Mirrors validateScenesForGeneration's signature (scenes/story/characters)
 * so the same data the validation layer already has at submit-time can
 * feed straight in.
 *
 * Returns an integer credit amount inclusive of a 10% buffer for
 * billing variance (Kling sometimes invoices for 10 s on a 5-s request,
 * fal.ai pricing shifts mid-run, etc.).
 */

// 10% padding implemented as integer math to avoid IEEE 754 drift
// (90 * 1.1 = 99.00000000000001 in floats, ceil → 100 instead of 99).
function pad(n: number): number {
  return Math.ceil((n * 11) / 10);
}

function pickKlingCost(duration: number): number {
  // duration is an integer 1..8 in the SceneFlow domain; we charge the
  // next-up bracket. <=5 → 5-second clip, >5 → 10-second clip.
  return duration <= 5 ? COST_TABLE.kling_video_5s : COST_TABLE.kling_video_10s;
}

function pickLipSyncCost(duration: number, model: string): number {
  if (model === 'fal-ai/musetalk') return COST_TABLE.musetalk;
  return duration <= 5
    ? COST_TABLE.sync_lipsync_5s
    : COST_TABLE.sync_lipsync_10s;
}

export function estimatePhase1Cost(
  scenes: SceneRecord[],
  _story: StoryRecord,
  characters: CharacterRecord[]
): number {
  const charMap = new Map(characters.map((c) => [c.id, c]));
  let raw = 0;
  for (const scene of scenes) {
    if (scene.type !== 'endcard') raw += COST_TABLE.flux_image;
    if (scene.audio_type === 'none') continue;
    if (scene.speaking_character_id === null) continue;
    const character = charMap.get(scene.speaking_character_id);
    if (!character) continue;
    if (character.voice_provider === 'elevenlabs') {
      raw += COST_TABLE.elevenlabs_tts;
    }
    // edge_tts is 0; azure is blocked by validation upstream
  }
  return pad(raw);
}

export function estimatePhase2Cost(
  scenes: SceneRecord[],
  story: StoryRecord
): number {
  let raw = 0;
  for (const scene of scenes) {
    if (scene.type === 'endcard') continue;
    if (scene.type === 'action') {
      raw += pickKlingCost(scene.duration);
    } else if (scene.type === 'dialog') {
      raw += pickKlingCost(scene.duration);
      raw += pickLipSyncCost(scene.duration, story.lipsync_model);
    }
  }
  return pad(raw);
}
