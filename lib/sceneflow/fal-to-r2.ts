import 'server-only';
import { putToR2 } from '@/lib/storage/r2-client';
import { getR2Config } from '@/lib/storage/env';

/**
 * Plan 8c — pipe a fal.ai temporary output URL into our own R2 bucket.
 *
 * fal.ai outputs are short-lived (~1h) — every generated asset must be
 * mirrored into R2 immediately and only the R2 URL persisted to DB.
 * Never store a fal-domain URL.
 */

export type SceneflowAssetKind =
  | 'image'
  | 'audio'
  | 'neutral-video'
  | 'video';

const EXT: Record<SceneflowAssetKind, string> = {
  image: 'jpg',
  audio: 'mp3',
  'neutral-video': 'mp4',
  video: 'mp4'
};

const CONTENT_TYPE: Record<SceneflowAssetKind, string> = {
  image: 'image/jpeg',
  audio: 'audio/mpeg',
  'neutral-video': 'video/mp4',
  video: 'video/mp4'
};

export interface SceneflowKeyInput {
  userId: string;
  storyId: string;
  sceneId: string;
  kind: SceneflowAssetKind;
}

function assertSafe(segment: string, field: string): void {
  if (
    segment.length === 0 ||
    segment.includes('/') ||
    segment.includes('..') ||
    segment.includes('\\')
  ) {
    throw new Error(`sceneflow R2 key: ${field} segment is unsafe: ${segment}`);
  }
}

export function sceneflowR2Key(input: SceneflowKeyInput): string {
  assertSafe(input.userId, 'userId');
  assertSafe(input.storyId, 'storyId');
  assertSafe(input.sceneId, 'sceneId');
  return `sceneflow/${input.userId}/${input.storyId}/${input.sceneId}/${input.kind}.${EXT[input.kind]}`;
}

export interface UploadAssetInput extends SceneflowKeyInput {
  body: Uint8Array;
}

/** Upload an in-memory buffer (e.g. TTS bytes) to R2 and return the public URL. */
export async function uploadAssetToR2(input: UploadAssetInput): Promise<string> {
  const key = sceneflowR2Key(input);
  await putToR2(key, input.body, CONTENT_TYPE[input.kind]);
  const { publicUrl } = getR2Config();
  return `${publicUrl.replace(/\/$/, '')}/${key}`;
}

/** Fetch a fal.ai URL and mirror it into R2. Returns the R2 public URL. */
export async function falUrlToR2(
  falUrl: string,
  meta: SceneflowKeyInput
): Promise<string> {
  const res = await fetch(falUrl);
  if (!res.ok) {
    throw new Error(`fal.ai asset fetch failed: HTTP ${res.status} ${falUrl}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return uploadAssetToR2({ ...meta, body: buf });
}
