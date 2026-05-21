// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hoisted mock — replaces the AWS SDK presigner so tests don't hit R2.
// vi.mock() calls are hoisted to the top of the file by vitest's transformer,
// so the import below resolves to the mocked module.
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://test.r2.cloudflarestorage.com/signed-stub')
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(_cfg: unknown) { void _cfg; }
  },
  PutObjectCommand: class {
    constructor(_cfg: unknown) { void _cfg; }
  }
}));

import { POST } from '@/app/api/presign/route';
import { _resetR2ConfigForTests } from '@/lib/storage/env';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

beforeEach(() => {
  _resetR2ConfigForTests();
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
  process.env.R2_BUCKET = 'test-bucket';
  process.env.R2_ENDPOINT = 'https://test.r2.cloudflarestorage.com';
  process.env.R2_PUBLIC_URL = 'https://media.test.example';
});

afterEach(() => {
  _resetR2ConfigForTests();
});

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('POST /api/presign', () => {
  it('rejects unsupported MIME types (MOV)', async () => {
    const res = await POST(
      makeRequest({
        filename: 'x.mov',
        contentType: 'video/quicktime',
        sizeBytes: 1000
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UNSUPPORTED_TYPE');
  });

  it('rejects files larger than 500 MB', async () => {
    const res = await POST(
      makeRequest({
        filename: 'big.mp4',
        contentType: 'video/mp4',
        sizeBytes: 600 * 1024 * 1024
      })
    );
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.code).toBe('TOO_LARGE');
  });

  it('rejects non-positive or non-numeric sizes', async () => {
    const r1 = await POST(
      makeRequest({ filename: 'x.mp4', contentType: 'video/mp4', sizeBytes: 0 })
    );
    expect(r1.status).toBe(400);
    expect((await r1.json()).code).toBe('BAD_SIZE');
    const r2 = await POST(
      makeRequest({ filename: 'x.mp4', contentType: 'video/mp4', sizeBytes: 'huge' })
    );
    expect(r2.status).toBe(400);
    expect((await r2.json()).code).toBe('BAD_SIZE');
  });

  it('rejects missing fields', async () => {
    const noFilename = await POST(
      makeRequest({ contentType: 'video/mp4', sizeBytes: 100 })
    );
    expect(noFilename.status).toBe(400);
    expect((await noFilename.json()).code).toBe('BAD_FILENAME');

    const noContentType = await POST(
      makeRequest({ filename: 'x.mp4', sizeBytes: 100 })
    );
    expect(noContentType.status).toBe(400);
    expect((await noContentType.json()).code).toBe('BAD_CONTENT_TYPE');
  });

  it('rejects malformed JSON', async () => {
    const req = new Request('http://localhost/api/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json'
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('BAD_JSON');
  });

  it('returns presignedUrl + publicUrl + key on a valid MP4 request', async () => {
    const res = await POST(
      makeRequest({
        filename: 'clip.mp4',
        contentType: 'video/mp4',
        sizeBytes: 10_000_000
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presignedUrl).toBe('https://test.r2.cloudflarestorage.com/signed-stub');
    expect(body.publicUrl).toMatch(/^https:\/\/media\.test\.example\/videos\//);
    expect(body.key).toMatch(/^videos\/[0-9a-f-]+-clip\.mp4$/);
    expect(getSignedUrl).toHaveBeenCalled();
  });

  it('accepts WebM', async () => {
    const res = await POST(
      makeRequest({
        filename: 'clip.webm',
        contentType: 'video/webm',
        sizeBytes: 5_000_000
      })
    );
    expect(res.status).toBe(200);
  });

  it('sanitises problematic filename characters', async () => {
    const res = await POST(
      makeRequest({
        filename: 'my video (1).mp4',
        contentType: 'video/mp4',
        sizeBytes: 100
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Spaces + parens stripped, dots kept for the extension.
    expect(body.key).toMatch(/^videos\/[0-9a-f-]+-my_video__1_\.mp4$/);
  });
});
