export const runtime = 'nodejs';

import 'server-only';
import { getR2Config } from '@/lib/storage/env';

/**
 * Plan 5.9b — R2 Presigned PUT URL for direct browser → R2 video uploads.
 *
 * Why a separate route from `/api/upload`: the existing upload route
 * proxies the file through Vercel, which caps payloads at 4.5 MB on the
 * Hobby tier. Videos up to 500 MB blow past that. The browser POSTs
 * metadata here, gets a signed URL, and `PUT`s the file directly to R2.
 *
 * The actual AWS SDK presigner is dynamic-imported so it stays in the
 * server bundle only (Next.js can tree-shake server-only imports out
 * of the client bundle).
 */

const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
const MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB hard cap
const PRESIGN_EXPIRES_SECONDS = 3600; // 1 h

interface PresignErrorBody {
  error: string;
  code: string;
}

function errorResponse(
  status: number,
  code: string,
  message: string
): Response {
  return Response.json(
    { error: message, code } satisfies PresignErrorBody,
    { status }
  );
}

interface PresignRequest {
  filename?: unknown;
  contentType?: unknown;
  sizeBytes?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  let payload: PresignRequest;
  try {
    payload = (await request.json()) as PresignRequest;
  } catch {
    return errorResponse(400, 'BAD_JSON', 'Body is not valid JSON');
  }

  const { filename, contentType, sizeBytes } = payload;

  if (typeof filename !== 'string' || filename.length === 0) {
    return errorResponse(400, 'BAD_FILENAME', 'filename is required');
  }
  if (typeof contentType !== 'string') {
    return errorResponse(400, 'BAD_CONTENT_TYPE', 'contentType is required');
  }
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return errorResponse(400, 'BAD_SIZE', 'sizeBytes must be a positive number');
  }
  if (!ALLOWED_VIDEO_TYPES.includes(contentType)) {
    return errorResponse(
      400,
      'UNSUPPORTED_TYPE',
      `Only ${ALLOWED_VIDEO_TYPES.join(', ')} are supported`
    );
  }
  if (sizeBytes > MAX_SIZE_BYTES) {
    return errorResponse(413, 'TOO_LARGE', 'Video exceeds 500 MB limit');
  }

  // Mild filename sanitisation — keep the recognisable suffix but strip
  // anything that could confuse R2 key parsing downstream.
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
  const key = `videos/${crypto.randomUUID()}-${safeName}`;

  try {
    const cfg = getR2Config();
    // Dynamic imports — keeps the AWS SDK out of the client bundle.
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    const s3 = new S3Client({
      region: 'auto',
      endpoint: cfg.endpoint,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey
      }
    });
    const cmd = new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      ContentType: contentType
    });
    const presignedUrl = await getSignedUrl(s3, cmd, {
      expiresIn: PRESIGN_EXPIRES_SECONDS
    });
    const publicUrl = `${cfg.publicUrl.replace(/\/$/, '')}/${key}`;

    return Response.json({ presignedUrl, publicUrl, key });
  } catch (err) {
    return errorResponse(
      500,
      'PRESIGN_FAILED',
      err instanceof Error ? err.message : 'unknown error'
    );
  }
}
