import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { uploadVideoToR2 } from '@/lib/storage/video-upload';

/**
 * MockXHR — minimal XMLHttpRequest stand-in for the PUT-to-R2 step.
 * We control onload/onerror manually and can fire upload.onprogress
 * to verify the progress callback wiring.
 */
class MockXHR {
  static instances: MockXHR[] = [];
  upload = { onprogress: null as ((e: ProgressEvent<XMLHttpRequestEventTarget>) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  method = '';
  url = '';
  body: BodyInit | null = null;
  headers: Record<string, string> = {};
  constructor() {
    MockXHR.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: BodyInit | null) {
    this.body = body;
  }
}

beforeEach(() => {
  MockXHR.instances = [];
  // @ts-expect-error — test-only swap.
  globalThis.XMLHttpRequest = MockXHR;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function presignSuccess() {
  return new Response(
    JSON.stringify({
      presignedUrl: 'https://r2.example/signed-put',
      publicUrl: 'https://cdn.example/videos/xyz.mp4',
      key: 'videos/xyz.mp4'
    }),
    { status: 200 }
  );
}

function fakeFile(): File {
  return new File([new Uint8Array(1024)], 'clip.mp4', { type: 'video/mp4' });
}

/** Wait until at least one MockXHR instance has been constructed. The presign
 *  fetch → json() chain involves multiple microtasks before XHR.send is hit. */
async function waitForXhr(): Promise<MockXHR> {
  for (let i = 0; i < 50; i++) {
    if (MockXHR.instances.length > 0) return MockXHR.instances[0];
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error('MockXHR never constructed within 50 ticks');
}

describe('uploadVideoToR2', () => {
  it('POSTs to /api/presign with filename, contentType, sizeBytes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(presignSuccess());
    const promise = uploadVideoToR2(fakeFile());
    // Flush the presign-fetch microtask.
    const xhr = await waitForXhr();
    xhr.onload?.();
    await promise;

    expect(fetchSpy).toHaveBeenCalledWith('/api/presign', expect.objectContaining({
      method: 'POST'
    }));
    const call = fetchSpy.mock.calls[0];
    const body = JSON.parse(((call[1] as RequestInit).body) as string);
    expect(body.filename).toBe('clip.mp4');
    expect(body.contentType).toBe('video/mp4');
    expect(body.sizeBytes).toBe(1024);
  });

  it('PUTs to the presigned URL with the file content-type header', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(presignSuccess());
    const promise = uploadVideoToR2(fakeFile());
    const xhr = await waitForXhr();
    xhr.onload?.();
    await promise;

    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('https://r2.example/signed-put');
    expect(xhr.headers['Content-Type']).toBe('video/mp4');
  });

  it('forwards xhr.upload.onprogress to onProgress callback', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(presignSuccess());
    const onProgress = vi.fn();
    const promise = uploadVideoToR2(fakeFile(), onProgress);
    const xhr = await waitForXhr();
    xhr.upload.onprogress?.(
      // Construct a minimal ProgressEvent-like object.
      { lengthComputable: true, loaded: 256, total: 1024 } as ProgressEvent<XMLHttpRequestEventTarget>
    );
    xhr.onload?.();
    await promise;

    expect(onProgress).toHaveBeenCalledWith({ loaded: 256, total: 1024, percent: 25 });
  });

  it('rejects when XHR reports status >= 300', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(presignSuccess());
    const promise = uploadVideoToR2(fakeFile());
    const xhr = await waitForXhr();
    xhr.status = 503;
    xhr.onload?.();
    await expect(promise).rejects.toThrow(/HTTP 503/);
  });

  it('rejects when /api/presign returns an error body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Video too large', code: 'TOO_LARGE' }), {
        status: 413
      })
    );
    await expect(uploadVideoToR2(fakeFile())).rejects.toThrow(/Video too large/);
  });

  it('returns publicUrl and key from the presign response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(presignSuccess());
    const promise = uploadVideoToR2(fakeFile());
    const xhr = await waitForXhr();
    xhr.onload?.();
    const result = await promise;
    expect(result.publicUrl).toBe('https://cdn.example/videos/xyz.mp4');
    expect(result.key).toBe('videos/xyz.mp4');
  });
});
