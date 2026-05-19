import 'server-only';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

export async function putToR2(
  key: string,
  body: Uint8Array,
  contentType: string
): Promise<void> {
  const cfg = getR2Config();
  const cmd = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    Body: body,
    ContentType: contentType
  });
  await getS3Client().send(cmd);
}

/** For tests only — drops the cached client so a fresh mock can attach. */
export function _resetR2ClientForTests(): void {
  client = null;
}
