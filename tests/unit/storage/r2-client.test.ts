import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the latest send-payload via a module-level holder so tests
// can assert on bucket / key / command shape.
const sendMock = vi.fn(async (_cmd?: unknown) => undefined);
const lastCommand = { value: null as unknown };

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: vi.fn().mockImplementation(() => ({
      send: (cmd: unknown) => {
        lastCommand.value = cmd;
        return sendMock(cmd);
      }
    })),
    PutObjectCommand: vi
      .fn()
      .mockImplementation((args: unknown) => ({ kind: 'put', args })),
    DeleteObjectCommand: vi
      .fn()
      .mockImplementation((args: unknown) => ({ kind: 'delete', args }))
  };
});

vi.mock('@/lib/storage/env', () => ({
  getR2Config: () => ({
    accountId: 'a',
    accessKeyId: 'key',
    secretAccessKey: 'sec',
    bucket: 'vibegrid-eu',
    endpoint: 'https://r2.example',
    publicUrl: 'https://pub.example'
  })
}));

import {
  putToR2,
  deleteFromR2,
  _resetR2ClientForTests
} from '@/lib/storage/r2-client';

beforeEach(() => {
  sendMock.mockClear();
  lastCommand.value = null;
  _resetR2ClientForTests();
});

describe('putToR2', () => {
  it('sends a PutObjectCommand with the configured bucket + key + content-type', async () => {
    await putToR2('library/manifest.json', new Uint8Array([1, 2, 3]), 'application/json');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd = lastCommand.value as { kind: string; args: Record<string, unknown> };
    expect(cmd.kind).toBe('put');
    expect(cmd.args.Bucket).toBe('vibegrid-eu');
    expect(cmd.args.Key).toBe('library/manifest.json');
    expect(cmd.args.ContentType).toBe('application/json');
  });

  it('omits CacheControl when no opts are passed (back-compat)', async () => {
    await putToR2('library/foo.mp3', new Uint8Array(), 'audio/mpeg');
    const cmd = lastCommand.value as { args: Record<string, unknown> };
    expect(cmd.args.CacheControl).toBeUndefined();
  });

  it('forwards opts.cacheControl into the command payload', async () => {
    await putToR2('library/foo.mp3', new Uint8Array(), 'audio/mpeg', {
      cacheControl: 'public, max-age=31536000, immutable'
    });
    const cmd = lastCommand.value as { args: Record<string, unknown> };
    expect(cmd.args.CacheControl).toBe('public, max-age=31536000, immutable');
  });
});

describe('deleteFromR2', () => {
  it('sends a DeleteObjectCommand with the configured bucket + key', async () => {
    await deleteFromR2('library/sfx/braams/heavy-01.mp3');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd = lastCommand.value as { kind: string; args: Record<string, unknown> };
    expect(cmd.kind).toBe('delete');
    expect(cmd.args.Bucket).toBe('vibegrid-eu');
    expect(cmd.args.Key).toBe('library/sfx/braams/heavy-01.mp3');
  });
});
