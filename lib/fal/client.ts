import 'server-only';
import { fal } from '@fal-ai/client';

if (!process.env.FAL_KEY) {
  throw new Error('FAL_KEY is not set — required for SceneFlow fal.ai integration');
}

fal.config({ credentials: process.env.FAL_KEY });

// ---------- Model identifiers ----------

export type FalImageModel = 'fal-ai/flux/dev';

export type FalVideoModel = 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video';

export type FalLipSyncModel = 'fal-ai/sync-lipsync/v3' | 'fal-ai/musetalk';

export const DEFAULT_IMAGE_MODEL: FalImageModel = 'fal-ai/flux/dev';
export const DEFAULT_VIDEO_MODEL: FalVideoModel =
  'fal-ai/kling-video/v2.5-turbo/pro/image-to-video';
export const DEFAULT_LIPSYNC_MODEL: FalLipSyncModel = 'fal-ai/sync-lipsync/v3';

// ---------- Image sizing ----------

export type FalImageSize = 'landscape_16_9' | 'portrait_16_9' | 'landscape_4_3';

export type StoryFormatLike = '16:9' | '9:16' | '4:3';

export function storyFormatToImageSize(format: StoryFormatLike): FalImageSize {
  switch (format) {
    case '16:9':
      return 'landscape_16_9';
    case '9:16':
      return 'portrait_16_9';
    case '4:3':
      return 'landscape_4_3';
  }
}

// ---------- Camera control type (kept here to break dependency cycle with sceneflow types) ----------

export interface CameraControl {
  zoom: number;
  panX: number;
  panY: number;
  motionIntensity: number;
}

// ---------- generateImage (short, fal.subscribe) ----------

export interface FalImageGenInput {
  prompt: string;
  model?: FalImageModel;
  imageSize: FalImageSize;
  numInferenceSteps?: number;
  guidanceScale?: number;
  seed?: number;
}

export interface FalImageGenResult {
  url: string;
  seed?: number;
}

interface FluxResultData {
  images?: Array<{ url?: string }>;
  seed?: number;
}

export async function generateImage(
  input: FalImageGenInput
): Promise<FalImageGenResult> {
  const model = input.model ?? DEFAULT_IMAGE_MODEL;
  const result = (await fal.subscribe(model, {
    input: {
      prompt: input.prompt,
      image_size: input.imageSize,
      num_inference_steps: input.numInferenceSteps ?? 28,
      guidance_scale: input.guidanceScale ?? 3.5,
      ...(input.seed !== undefined ? { seed: input.seed } : {})
    }
  } as Parameters<typeof fal.subscribe>[1])) as { data: FluxResultData };

  const url = result.data.images?.[0]?.url;
  if (!url) {
    throw new Error('fal.ai generateImage: no image URL in response');
  }
  return { url, seed: result.data.seed };
}

// ---------- Queue submit helpers (long, fal.queue.submit) ----------

export interface SubmitVideoJobInput {
  prompt: string;
  imageUrl: string;
  duration: '5' | '10';
  endImageUrl?: string;
  negativePrompt?: string;
  cfgScale?: number;
  model?: FalVideoModel;
}

export async function submitVideoJob(
  input: SubmitVideoJobInput
): Promise<string> {
  const model = input.model ?? DEFAULT_VIDEO_MODEL;
  const enqueued = await fal.queue.submit(model, {
    input: {
      prompt: input.prompt,
      image_url: input.imageUrl,
      duration: input.duration,
      ...(input.endImageUrl ? { end_image_url: input.endImageUrl } : {}),
      ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
      ...(input.cfgScale !== undefined ? { cfg_scale: input.cfgScale } : {})
    }
  } as Parameters<typeof fal.queue.submit>[1]);
  return enqueued.request_id;
}

export interface SubmitLipSyncJobInput {
  videoUrl: string;
  audioUrl: string;
  syncMode?: 'cut_off' | 'loop' | 'remap';
}

export async function submitLipSyncJob(
  input: SubmitLipSyncJobInput
): Promise<string> {
  const enqueued = await fal.queue.submit('fal-ai/sync-lipsync/v3', {
    input: {
      video_url: input.videoUrl,
      audio_url: input.audioUrl,
      sync_mode: input.syncMode ?? 'remap'
    }
  } as Parameters<typeof fal.queue.submit>[1]);
  return enqueued.request_id;
}

export interface SubmitMuseTalkJobInput {
  sourceVideoUrl: string;
  audioUrl: string;
}

export async function submitMuseTalkJob(
  input: SubmitMuseTalkJobInput
): Promise<string> {
  const enqueued = await fal.queue.submit('fal-ai/musetalk', {
    input: {
      source_video_url: input.sourceVideoUrl,
      audio_url: input.audioUrl
    }
  } as Parameters<typeof fal.queue.submit>[1]);
  return enqueued.request_id;
}

// ---------- Status / result wrappers ----------

export type FalJobStatus = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED';

export interface JobRef {
  endpointId: string;
  requestId: string;
}

export async function getJobStatus(ref: JobRef): Promise<FalJobStatus> {
  const status = await fal.queue.status(ref.endpointId, {
    requestId: ref.requestId
  });
  return status.status as FalJobStatus;
}

export interface VideoResultData {
  video?: { url?: string };
}

export async function getVideoJobResult(ref: JobRef): Promise<string> {
  const result = (await fal.queue.result(ref.endpointId, {
    requestId: ref.requestId
  })) as { data: VideoResultData };
  const url = result.data.video?.url;
  if (!url) {
    throw new Error(`fal.ai ${ref.endpointId}: no video URL in result`);
  }
  return url;
}

export async function getImageJobResult(ref: JobRef): Promise<string> {
  const result = (await fal.queue.result(ref.endpointId, {
    requestId: ref.requestId
  })) as { data: FluxResultData };
  const url = result.data.images?.[0]?.url;
  if (!url) {
    throw new Error(`fal.ai ${ref.endpointId}: no image URL in result`);
  }
  return url;
}
