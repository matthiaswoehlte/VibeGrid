import type { SceneRecord } from './types';

/**
 * Plan 8c — derived generation state.
 *
 * The DB does NOT carry a `generation_step` column. Instead the step is
 * derived from which URL fields are still null. See plan §[Fix W2].
 *
 * Order:
 *   1. image    — `image_url` missing (every non-endcard scene needs one)
 *   2. audio    — `audio_url` missing AND audio_type !== 'none'
 *   3. neutral_video — dialog scenes only, after image+audio
 *   4. lipsync  — action or dialog scenes, final video step
 *   5. done     — endcards (no fal calls) or video_url set
 */
export type GenerationStep =
  | 'image'
  | 'audio'
  | 'neutral_video'
  | 'lipsync'
  | 'done';

export function computeNextGenerationStep(
  scene: Pick<
    SceneRecord,
    | 'type'
    | 'audio_type'
    | 'image_url'
    | 'audio_url'
    | 'video_url'
    | 'neutral_video_url'
  >
): GenerationStep {
  // Endcards never need fal-generated assets.
  if (scene.type === 'endcard') return 'done';

  if (scene.image_url === null) return 'image';
  if (scene.audio_url === null && scene.audio_type !== 'none') return 'audio';
  if (scene.type === 'dialog' && scene.neutral_video_url === null) {
    return 'neutral_video';
  }
  if (scene.video_url === null) return 'lipsync';
  return 'done';
}
