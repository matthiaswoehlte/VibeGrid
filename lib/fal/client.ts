import 'server-only';

if (!process.env.FAL_KEY) {
  throw new Error('FAL_KEY is not set — required for SceneFlow fal.ai integration');
}

export type FalImageModel =
  | 'fal-ai/flux/dev'
  | 'fal-ai/seedream-3'
  | 'fal-ai/ideogram-v3';

export type FalVideoModel =
  | 'fal-ai/kling-video/v1.5/pro/image-to-video'
  | 'fal-ai/kling-video/v2.1/pro/image-to-video'
  | 'fal-ai/minimax-video-01-live';

export type FalLipSyncModel =
  | 'fal-ai/sync-lipsync'
  | 'fal-ai/omnihuman-lite';

export interface CameraControl {
  zoom: number;
  panX: number;
  panY: number;
  motionIntensity: number;
}

export interface FalImageGenInput {
  prompt: string;
  model: FalImageModel;
  imageSize?: '16:9' | '9:16' | '4:3';
  referenceImageUrl?: string;
}

export interface FalVideoGenInput {
  imageUrl: string;
  motionPrompt: string;
  model: FalVideoModel;
  duration: number;
  cameraControl?: CameraControl;
}

export interface FalLipSyncInput {
  referenceImageUrl: string;
  audioUrl: string;
  backgroundImageUrl?: string;
  model: FalLipSyncModel;
}

const NOT_IMPL_MSG = (fn: string): string =>
  `fal.ai ${fn}: not implemented until Plan 8c`;

export async function generateImage(_input: FalImageGenInput): Promise<string> {
  throw new Error(NOT_IMPL_MSG('generateImage'));
}

export async function generateVideo(_input: FalVideoGenInput): Promise<string> {
  throw new Error(NOT_IMPL_MSG('generateVideo'));
}

export async function generateLipSync(_input: FalLipSyncInput): Promise<string> {
  throw new Error(NOT_IMPL_MSG('generateLipSync'));
}
