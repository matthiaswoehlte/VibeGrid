export const runtime = 'nodejs';

import type { MediaKind, MediaRef } from '@/lib/storage/types';
import { UploadValidationError, validateUpload } from '@/lib/storage/mime-validator';
import { buildR2Key } from '@/lib/storage/r2-key';
import { putToR2 } from '@/lib/storage/r2-client';
import { getR2Config } from '@/lib/storage/env';

// v0.1: no auth, no project persistence. Hardcoded per spec §7.1.
const ANONYMOUS_USER = 'anonymous';
const DEFAULT_PROJECT = 'default';

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface UploadErrorBody {
  error: string;
  code: string;
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: message, code } satisfies UploadErrorBody, { status });
}

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(400, 'INVALID_MULTIPART', 'Body is not multipart/form-data');
  }

  const file = formData.get('file');
  const kindValue = formData.get('kind');
  const idValue = formData.get('id');

  if (!(file instanceof File)) {
    return errorResponse(400, 'NO_FILE', 'Missing "file" part');
  }
  if (kindValue !== 'image' && kindValue !== 'audio') {
    return errorResponse(400, 'BAD_KIND', 'kind must be "image" or "audio"');
  }
  if (typeof idValue !== 'string' || !UUID_V4_RE.test(idValue)) {
    return errorResponse(400, 'BAD_ID', 'id must be a UUID v4');
  }
  // After the guard above, kindValue is narrowed to 'image' | 'audio'.
  // The wider MediaKind cast is for the downstream MediaRef construction
  // where 'video' is also a valid value (videos go through /api/presign,
  // not this route).
  const kind: 'image' | 'audio' = kindValue;
  const id = idValue;

  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const { mime, ext } = await validateUpload(bytes, kind);
    const key = buildR2Key({
      userId: ANONYMOUS_USER,
      projectId: DEFAULT_PROJECT,
      kind,
      id,
      ext
    });
    await putToR2(key, bytes, mime);

    const cfg = getR2Config();
    const url = `${cfg.publicUrl.replace(/\/$/, '')}/${key}`;

    const mediaRef: MediaRef = {
      id,
      kind,
      url,
      filename: file.name,
      uploadedAt: new Date().toISOString()
    };
    return Response.json(mediaRef, { status: 201 });
  } catch (err) {
    if (err instanceof UploadValidationError) {
      return errorResponse(400, err.code, err.message);
    }
    return errorResponse(
      500,
      'UPLOAD_FAILED',
      err instanceof Error ? err.message : 'unknown error'
    );
  }
}
