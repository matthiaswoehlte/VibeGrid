// @vitest-environment node
//
// The route handler uses `Request.formData()` which jsdom does not implement
// correctly for multipart bodies — Node's native undici does. We're testing a
// server route, not a browser, so node is the right environment here.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AWS SDK BEFORE importing the route — the route imports r2-client
// which constructs an S3Client at first putToR2() call.
// `vi.hoisted()` is required: vitest hoists `vi.mock()` factories above any
// `const` declarations, so a plain `const sendMock` would be in the temporal
// dead zone when the factory closure runs (ReferenceError at module init).
const sendMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  PutObjectCommand: vi.fn().mockImplementation((args: unknown) => ({ __cmd: 'put', args }))
}));

// Stub env so getR2Config() doesn't throw.
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
process.env.R2_BUCKET = 'vibegrid-media-test';
process.env.R2_ENDPOINT = 'https://test-account.eu.r2.cloudflarestorage.com';
process.env.R2_PUBLIC_URL = 'https://media.test.example.com';

import { POST } from '@/app/api/upload/route';
import { _resetR2ClientForTests } from '@/lib/storage/r2-client';
import { _resetR2ConfigForTests } from '@/lib/storage/env';
import { jpegBytes, bogusBytes } from '../unit/storage/_fixtures';

function makeRequest(parts: { file: File; kind: string; id: string }): Request {
  const fd = new FormData();
  fd.append('file', parts.file);
  fd.append('kind', parts.kind);
  fd.append('id', parts.id);
  return new Request('http://localhost/api/upload', { method: 'POST', body: fd });
}

describe('POST /api/upload', () => {
  beforeEach(() => {
    sendMock.mockClear();
    _resetR2ClientForTests();
    _resetR2ConfigForTests();
  });

  it('uploads a JPEG and returns a MediaRef with a public URL', async () => {
    const file = new File([jpegBytes()], 'cover.jpg', { type: 'image/jpeg' });
    const res = await POST(
      makeRequest({
        file,
        kind: 'image',
        id: '11111111-2222-4333-8444-555555555555'
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kind).toBe('image');
    expect(body.filename).toBe('cover.jpg');
    expect(body.url).toBe(
      'https://media.test.example.com/anonymous/default/image/11111111-2222-4333-8444-555555555555.jpg'
    );
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a bogus payload with 400 UNSUPPORTED_MIME or UNDETECTABLE_TYPE', async () => {
    const file = new File([bogusBytes()], 'evil.jpg', { type: 'image/jpeg' });
    const res = await POST(
      makeRequest({
        file,
        kind: 'image',
        id: '11111111-2222-4333-8444-555555555555'
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toMatch(/UNSUPPORTED_MIME|UNDETECTABLE_TYPE/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects a missing id', async () => {
    const file = new File([jpegBytes()], 'x.jpg', { type: 'image/jpeg' });
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', 'image');
    // no id
    const req = new Request('http://localhost/api/upload', { method: 'POST', body: fd });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('BAD_ID');
  });

  it('rejects a wrong kind', async () => {
    const file = new File([jpegBytes()], 'x.jpg', { type: 'image/jpeg' });
    const res = await POST(
      makeRequest({
        file,
        kind: 'video', // not allowed
        id: '11111111-2222-4333-8444-555555555555'
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('BAD_KIND');
  });
});
