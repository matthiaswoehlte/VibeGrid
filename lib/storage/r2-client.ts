import 'server-only';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getR2Config } from './env';

let client: S3Client | null = null;

function getS3Client(): S3Client {
  if (client) return client;
  const cfg = getR2Config();
  client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey
    },
    // Spec §7.1: forward-compat for a later Cloudflare Pages migration.
    // No-op on the Node runtime.
    requestChecksumCalculation: 'WHEN_REQUIRED'
  });
  return client;
}

export interface PutOptions {
  /**
   * Plan 8.7b — optional `Cache-Control` header on the uploaded object.
   * Used by the admin sound-upload flow to set
   * `public, max-age=31536000, immutable` on the MP3 (one-year, content-
   * addressed by id) and `public, max-age=3600` on the manifest.
   */
  cacheControl?: string;
}

export async function putToR2(
  key: string,
  body: Uint8Array,
  contentType: string,
  opts?: PutOptions
): Promise<void> {
  const cfg = getR2Config();
  const cmd = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ...(opts?.cacheControl ? { CacheControl: opts.cacheControl } : {})
  });
  await getS3Client().send(cmd);
}

/**
 * Plan 8.7b — sibling of `putToR2`. Used by the admin sound-delete
 * flow to remove the MP3 after the manifest has been rewritten
 * (manifest-first ordering — orphan MP3 is preferable to a ghost entry
 * the user would see as a 404).
 */
export async function deleteFromR2(key: string): Promise<void> {
  const cfg = getR2Config();
  const cmd = new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key });
  await getS3Client().send(cmd);
}

/** For tests only — drops the cached client so a fresh mock can attach. */
export function _resetR2ClientForTests(): void {
  client = null;
}
