# VibeGrid Plan 4 — Storage & API Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the upload pipeline end-to-end — client-side `StorageAdapter` posting multipart to `/api/upload`, server-side route handler with **magic-byte MIME validation** and size limits, R2 (S3-compatible, EU jurisdiction) put via `@aws-sdk/client-s3`, plus a persisted `mediaRefs` Zustand slice that the renderer consumes. D1 schema is committed but not applied in v0.1.

**Architecture:** Three sharply separated layers. (1) Pure helpers — `r2-key.ts` (key builder), `mime-validator.ts` (file-type magic-byte check) — unit-tested without any I/O. (2) Server runtime — `r2-client.ts` (lazy S3 client), `env.ts` (env-var validation), `app/api/upload/route.ts` (`runtime = 'nodejs'`, multipart parsing, validate → put → return `MediaRef`). (3) Client adapter — `r2-adapter.ts` implements the `StorageAdapter` interface by posting `FormData` to `/api/upload`. The Zustand `media` slice persists `MediaRef[]` (URLs + metadata only, never blobs).

**Tech Stack:** Next.js 14 route handlers (App Router, Node.js runtime), `@aws-sdk/client-s3` v3, `file-type` v19 for magic-byte detection, `crypto.randomUUID()` for IDs (no extra dep). Vitest mocks the S3 client per-test via `vi.mock`.

**Spec reference:** `docs/superpowers/specs/2026-05-19-vibegrid-design.md` §7 (Storage & API), §7.1 (R2 + API), §7.2 (env vars), §7.3 (D1 schema), §10 (mediaRefs persistence), §11.2 (test layout).

**Verification gate (must pass before Plan 5 starts):**

```
npm test -- storage          # ≥ 18 tests across mime-validator + r2-key + r2-adapter
npm test -- integration      # upload.api.test.ts with mocked S3
npm test -- store            # mediaRefs slice + regression of timeline/audio slices
npm run typecheck            # clean
npm run lint                 # clean
npm run build                # clean — exercises route bundling
```

**Dependencies on prior plans:** Plan 0 (scaffold, Zustand store + persist, vitest). Plan 3 (`ImageBitmapCache` will consume `MediaRef.url` in Plan 5 — not in scope here, but the contract must match).

---

## File map

| File | Purpose |
|---|---|
| `lib/storage/types.ts` | `MediaRef`, `MediaKind`, `StorageAdapter` |
| `lib/storage/r2-key.ts` | Pure: `buildR2Key({ userId, projectId, kind, id, ext })` |
| `lib/storage/mime-validator.ts` | Server-side: `validateUpload(buffer, kind)` → `{ ok, mime, ext }` or throws `UploadValidationError` |
| `lib/storage/env.ts` | Server-side: `getR2Config()` reads env vars, validates non-empty, returns typed object. Lazy — throws on first call if misconfigured. |
| `lib/storage/r2-client.ts` | Server-side: `getS3Client()` — lazy singleton. `putToR2(key, body, contentType)` wrapper. |
| `lib/storage/r2-adapter.ts` | Client-side: `R2StorageAdapter` implementing `StorageAdapter`. `uploadImage(File)` / `uploadAudio(File)` post multipart to `/api/upload`. |
| `app/api/upload/route.ts` | POST handler — `runtime = 'nodejs'`. Parses multipart, validates MIME + size, puts to R2, returns `MediaRef`. |
| `app/api/projects/route.ts` | Stub: GET (empty list), POST (echo back) — `runtime = 'nodejs'`. |
| `app/api/projects/[id]/route.ts` | Stub: GET (404 in v0.1) — `runtime = 'nodejs'`. |
| `db/schema.sql` | D1 schema (Spec §7.3 verbatim). Not applied in v0.1. |
| `.env.example` | R2 + D1 env keys (Spec §7.2 verbatim). |
| `lib/store/media-slice.ts` | Zustand slice: `mediaRefs: MediaRef[]`, `addMediaRef`, `removeMediaRef`, `getMediaRef`. |
| `lib/store/types.ts` (modify) | Append `MediaState` + `MediaActions` to `AppState`. |
| `lib/store/index.ts` (modify) | Compose `createMediaSlice` + extend `partialize`. |
| `tests/unit/storage/mime-validator.test.ts` | Magic-byte acceptance + rejection + size cap |
| `tests/unit/storage/r2-key.test.ts` | Key shape, special-char escaping, ext from MIME |
| `tests/unit/storage/r2-adapter.test.ts` | Client adapter posts correct multipart, parses response |
| `tests/integration/upload.api.test.ts` | Full route handler with mocked S3 client |
| `tests/unit/store/media-slice.test.ts` | Slice actions, persistence-exclusion sanity |

---

## Conventions

- **Server-only modules** (`r2-client.ts`, `env.ts`, route handlers) MUST NOT be imported from client code. The boundary is enforced by file location — files under `app/api/` are server-only by Next.js convention; `lib/storage/r2-client.ts` and `env.ts` are also server-only but live in `lib/` for testability. The client adapter does NOT import these; the route handler does.
- **MediaRef.id is generated client-side** via `crypto.randomUUID()` before posting. The server validates the format (UUID v4 regex) but does not regenerate. Rationale: keeps optimistic UI updates simple — the client can insert the `MediaRef` into the store before the upload completes (status flag in Plan 5).
- **MIME validation is magic-byte ONLY.** The `Content-Type` header from the browser is never trusted. `file-type` reads the first ~256 bytes of the buffer and returns `{ mime, ext }`. The server then matches against the kind-specific whitelist.
- **Size limits enforced at the route boundary**, before reading the full body when possible. v0.1 uses `request.formData()` which buffers the whole body — size check happens AFTER parse. Note in `KNOWN_LIMITATIONS.md`: Vercel hobby tier caps payloads at 4.5 MB; the 50 MB audio cap requires Pro. Documented, not blocked.
- **`requestChecksumCalculation: 'WHEN_REQUIRED'`** is set on the S3 client per Spec §7.1 — a no-op on the current Node runtime, but kept as forward-compat for a later Cloudflare Pages migration.
- **`crypto.randomUUID()`** is available in Node 16.17+ and all evergreen browsers. No `uuid` package needed.

---

## Task 0: Install deps + magic-byte fixtures

**Files:**
- Modify: `package.json`
- Create: `tests/unit/storage/_fixtures.ts`

> Add runtime deps (`@aws-sdk/client-s3`, `file-type`) and pure test fixtures for magic-byte payloads (JPEG, PNG, WebP, MP3, WAV, MP4 headers). Tests stay deterministic without real files on disk.

- [ ] **Step 1: Install deps**

```bash
npm install @aws-sdk/client-s3@^3.658.0 file-type@^19.5.0
```

Expected: both packages added to `dependencies`. `file-type` is ESM-only — Next.js 14 App Router routes are ESM, so this works under both `next build` and vitest.

- [ ] **Step 2: Write `tests/unit/storage/_fixtures.ts`**

```ts
/**
 * Minimal magic-byte prefixes for `file-type` detection. Each helper returns
 * a Uint8Array padded out so `fileTypeFromBuffer` has enough bytes to identify.
 */

function pad(prefix: number[], targetLen = 64): Uint8Array {
  const buf = new Uint8Array(targetLen);
  buf.set(prefix);
  return buf;
}

// JPEG: FF D8 FF E0 ... 'JFIF'
export function jpegBytes(): Uint8Array {
  return pad([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
}

// PNG: 89 50 4E 47 0D 0A 1A 0A
export function pngBytes(): Uint8Array {
  return pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

// WebP: 'RIFF' .... 'WEBP'
export function webpBytes(): Uint8Array {
  const buf = new Uint8Array(64);
  buf.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  buf.set([0x20, 0x00, 0x00, 0x00], 4); // size (arbitrary)
  buf.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  buf.set([0x56, 0x50, 0x38, 0x20], 12); // VP8 (space)
  return buf;
}

// MP3 (with ID3v2 tag): 'ID3' .. 03 00 00 ..
export function mp3Bytes(): Uint8Array {
  const buf = new Uint8Array(64);
  buf.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], 0);
  return buf;
}

// WAV: 'RIFF' .... 'WAVE'
export function wavBytes(): Uint8Array {
  const buf = new Uint8Array(64);
  buf.set([0x52, 0x49, 0x46, 0x46], 0);
  buf.set([0x20, 0x00, 0x00, 0x00], 4);
  buf.set([0x57, 0x41, 0x56, 0x45], 8);
  buf.set([0x66, 0x6d, 0x74, 0x20], 12);
  return buf;
}

// MP4 audio (ftyp box, 'M4A '): 00 00 00 20 'ftyp' 'M4A '
export function m4aBytes(): Uint8Array {
  const buf = new Uint8Array(64);
  buf.set([0x00, 0x00, 0x00, 0x20], 0);
  buf.set([0x66, 0x74, 0x79, 0x70], 4); // 'ftyp'
  buf.set([0x4d, 0x34, 0x41, 0x20], 8); // 'M4A '
  buf.set([0x00, 0x00, 0x00, 0x00], 12);
  buf.set([0x4d, 0x34, 0x41, 0x20], 16); // compat brand
  return buf;
}

// Bogus content masquerading as image — payload starts with 'NOTAFILE'
export function bogusBytes(): Uint8Array {
  return pad([0x4e, 0x4f, 0x54, 0x41, 0x46, 0x49, 0x4c, 0x45]);
}
```

- [ ] **Step 3: Run tests — confirm 138 prior tests still pass**

```
npm test
```

Expected: 138 green.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tests/unit/storage/_fixtures.ts
git commit -m "chore(storage): add @aws-sdk/client-s3 + file-type, magic-byte fixtures"
```

---

## Task 1: Storage types

**Files:**
- Create: `lib/storage/types.ts`

> Restate the spec §7 types verbatim. `MediaKind = 'image' | 'audio'` is reused by both server and client modules.

- [ ] **Step 1: Write `lib/storage/types.ts`**

```ts
export type MediaKind = 'image' | 'audio';

export interface MediaRef {
  id: string;
  kind: MediaKind;
  url: string;
  filename: string;
  width?: number;
  height?: number;
  duration?: number;
  uploadedAt: string; // ISO 8601
}

export interface StorageAdapter {
  uploadImage(file: File): Promise<MediaRef>;
  uploadAudio(file: File): Promise<MediaRef>;
}

/** Size caps per spec §7.1 (bytes). */
export const SIZE_LIMITS = {
  image: 20 * 1024 * 1024,
  audio: 50 * 1024 * 1024
} as const satisfies Record<MediaKind, number>;

/** Whitelisted MIME types per kind (spec §7.1). */
export const MIME_WHITELIST = {
  image: ['image/jpeg', 'image/png', 'image/webp'] as const,
  audio: ['audio/mpeg', 'audio/wav', 'audio/mp4'] as const
} as const satisfies Record<MediaKind, readonly string[]>;
```

- [ ] **Step 2: Verify typecheck**

```
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add lib/storage/types.ts
git commit -m "feat(storage): types (MediaRef, StorageAdapter, SIZE_LIMITS, MIME_WHITELIST)"
```

---

## Task 2: MIME magic-byte validator

**Files:**
- Create: `lib/storage/mime-validator.ts`
- Create: `tests/unit/storage/mime-validator.test.ts`

> Pure server-side function — never trusts the browser's `Content-Type` header. Reads the buffer with `file-type`, returns the detected mime/ext or throws `UploadValidationError`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { validateUpload, UploadValidationError } from '@/lib/storage/mime-validator';
import { jpegBytes, pngBytes, webpBytes, mp3Bytes, wavBytes, m4aBytes, bogusBytes } from './_fixtures';

describe('validateUpload — images', () => {
  it('accepts JPEG and returns mime + ext', async () => {
    const r = await validateUpload(jpegBytes(), 'image');
    expect(r.mime).toBe('image/jpeg');
    expect(r.ext).toBe('jpg');
  });

  it('accepts PNG', async () => {
    const r = await validateUpload(pngBytes(), 'image');
    expect(r.mime).toBe('image/png');
    expect(r.ext).toBe('png');
  });

  it('accepts WebP', async () => {
    const r = await validateUpload(webpBytes(), 'image');
    expect(r.mime).toBe('image/webp');
  });

  it('rejects audio bytes when image is expected', async () => {
    await expect(validateUpload(mp3Bytes(), 'image')).rejects.toBeInstanceOf(UploadValidationError);
  });

  it('rejects bogus content', async () => {
    await expect(validateUpload(bogusBytes(), 'image')).rejects.toBeInstanceOf(
      UploadValidationError
    );
  });
});

describe('validateUpload — audio', () => {
  it('accepts MP3', async () => {
    const r = await validateUpload(mp3Bytes(), 'audio');
    expect(r.mime).toBe('audio/mpeg');
  });

  it('accepts WAV', async () => {
    const r = await validateUpload(wavBytes(), 'audio');
    expect(r.mime).toBe('audio/wav');
  });

  it('accepts M4A as audio/mp4', async () => {
    const r = await validateUpload(m4aBytes(), 'audio');
    expect(r.mime).toBe('audio/mp4');
  });

  it('rejects image bytes when audio is expected', async () => {
    await expect(validateUpload(jpegBytes(), 'audio')).rejects.toBeInstanceOf(
      UploadValidationError
    );
  });
});

describe('validateUpload — size cap', () => {
  it('rejects an oversize image (> 20 MB)', async () => {
    const oversize = new Uint8Array(20 * 1024 * 1024 + 1);
    oversize.set(jpegBytes(), 0);
    await expect(validateUpload(oversize, 'image')).rejects.toBeInstanceOf(UploadValidationError);
  });

  it('rejects an oversize audio (> 50 MB)', async () => {
    const oversize = new Uint8Array(50 * 1024 * 1024 + 1);
    oversize.set(mp3Bytes(), 0);
    await expect(validateUpload(oversize, 'audio')).rejects.toBeInstanceOf(UploadValidationError);
  });

  it('error carries a code discriminator', async () => {
    try {
      await validateUpload(bogusBytes(), 'image');
    } catch (e) {
      expect(e).toBeInstanceOf(UploadValidationError);
      expect((e as UploadValidationError).code).toBe('UNSUPPORTED_MIME');
    }
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
import { fileTypeFromBuffer } from 'file-type';
import { MIME_WHITELIST, SIZE_LIMITS, type MediaKind } from './types';

export type UploadValidationCode =
  | 'SIZE_EXCEEDED'
  | 'UNSUPPORTED_MIME'
  | 'UNDETECTABLE_TYPE';

export class UploadValidationError extends Error {
  readonly code: UploadValidationCode;
  constructor(code: UploadValidationCode, message: string) {
    super(message);
    this.name = 'UploadValidationError';
    this.code = code;
    Object.setPrototypeOf(this, UploadValidationError.prototype);
  }
}

export interface ValidationResult {
  mime: string;
  ext: string;
}

export async function validateUpload(
  bytes: Uint8Array,
  kind: MediaKind
): Promise<ValidationResult> {
  // 1. Size cap first — cheaper than running file-type on huge buffers.
  if (bytes.byteLength > SIZE_LIMITS[kind]) {
    throw new UploadValidationError(
      'SIZE_EXCEEDED',
      `${kind} upload exceeds ${SIZE_LIMITS[kind]} bytes (got ${bytes.byteLength})`
    );
  }

  // 2. Magic-byte detection — never trust the browser's Content-Type.
  const detected = await fileTypeFromBuffer(bytes);
  if (!detected) {
    throw new UploadValidationError(
      'UNDETECTABLE_TYPE',
      'file-type could not identify the buffer'
    );
  }

  // 3. Whitelist match for the requested kind.
  const allowed = MIME_WHITELIST[kind] as readonly string[];
  if (!allowed.includes(detected.mime)) {
    throw new UploadValidationError(
      'UNSUPPORTED_MIME',
      `${detected.mime} is not allowed for kind=${kind} (whitelist: ${allowed.join(', ')})`
    );
  }

  return { mime: detected.mime, ext: detected.ext };
}
```

- [ ] **Step 4: Run — expect PASS (12 tests)**

- [ ] **Step 5: Commit**

```bash
git add lib/storage/mime-validator.ts tests/unit/storage/mime-validator.test.ts
git commit -m "feat(storage): magic-byte MIME validator (size cap + file-type whitelist)"
```

---

## Task 3: R2 key builder

**Files:**
- Create: `lib/storage/r2-key.ts`
- Create: `tests/unit/storage/r2-key.test.ts`

> Pure function — no I/O. Key format per spec §7.1: `{userId}/{projectId}/{kind}/{id}.{ext}`. v0.1 callers pass `userId='anonymous'` and `projectId='default'`. The builder accepts them as parameters so v0.2 (auth) needs no refactor.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildR2Key } from '@/lib/storage/r2-key';

describe('buildR2Key', () => {
  it('produces the v0.1 anonymous/default shape', () => {
    const key = buildR2Key({
      userId: 'anonymous',
      projectId: 'default',
      kind: 'image',
      id: '11111111-2222-3333-4444-555555555555',
      ext: 'png'
    });
    expect(key).toBe('anonymous/default/image/11111111-2222-3333-4444-555555555555.png');
  });

  it('embeds audio kind', () => {
    const key = buildR2Key({
      userId: 'u1',
      projectId: 'p1',
      kind: 'audio',
      id: 'aaaa',
      ext: 'mp3'
    });
    expect(key).toBe('u1/p1/audio/aaaa.mp3');
  });

  it('throws on empty id', () => {
    expect(() =>
      buildR2Key({ userId: 'u', projectId: 'p', kind: 'image', id: '', ext: 'jpg' })
    ).toThrow(/id/);
  });

  it('throws on empty ext', () => {
    expect(() =>
      buildR2Key({ userId: 'u', projectId: 'p', kind: 'image', id: 'x', ext: '' })
    ).toThrow(/ext/);
  });

  it('rejects path-traversal segments', () => {
    expect(() =>
      buildR2Key({ userId: '../etc', projectId: 'p', kind: 'image', id: 'x', ext: 'jpg' })
    ).toThrow(/segment/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
import type { MediaKind } from './types';

export interface BuildR2KeyInput {
  userId: string;
  projectId: string;
  kind: MediaKind;
  id: string;
  ext: string;
}

function assertSafeSegment(segment: string, fieldName: string): void {
  if (segment.length === 0) {
    throw new Error(`buildR2Key: ${fieldName} must not be empty`);
  }
  if (segment.includes('/') || segment.includes('..') || segment.includes('\\')) {
    throw new Error(`buildR2Key: ${fieldName} segment contains unsafe characters: ${segment}`);
  }
}

export function buildR2Key(input: BuildR2KeyInput): string {
  const { userId, projectId, kind, id, ext } = input;
  assertSafeSegment(userId, 'userId');
  assertSafeSegment(projectId, 'projectId');
  assertSafeSegment(id, 'id');
  assertSafeSegment(ext, 'ext');
  return `${userId}/${projectId}/${kind}/${id}.${ext}`;
}
```

- [ ] **Step 4: Run — expect PASS (5 tests)**

- [ ] **Step 5: Commit**

```bash
git add lib/storage/r2-key.ts tests/unit/storage/r2-key.test.ts
git commit -m "feat(storage): R2 key builder (segment-safe, kind-namespaced)"
```

---

## Task 4: Env config + `.env.example`

**Files:**
- Create: `lib/storage/env.ts`
- Create: `.env.example`

> `getR2Config()` reads env vars on first call, validates non-empty, returns a typed object. Lazy because Next.js evaluates route modules at build time — we want errors at request time, not build time, so the dev experience stays clean.

- [ ] **Step 1: Write `.env.example`** (spec §7.2 verbatim)

```env
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=vibegrid-media
R2_ENDPOINT=https://${R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com
R2_PUBLIC_URL=https://media.vibegrid.example.com
# D1 (v0.2):
D1_DATABASE_ID=
```

- [ ] **Step 2: Write `lib/storage/env.ts`**

```ts
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  publicUrl: string;
}

let cached: R2Config | null = null;

function require(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

/**
 * Lazy. Throws on first call if any required var is missing. Intentionally NOT
 * cached across module reloads in tests — call _resetR2ConfigForTests().
 */
export function getR2Config(): R2Config {
  if (cached) return cached;
  cached = {
    accountId: require('R2_ACCOUNT_ID'),
    accessKeyId: require('R2_ACCESS_KEY_ID'),
    secretAccessKey: require('R2_SECRET_ACCESS_KEY'),
    bucket: require('R2_BUCKET'),
    endpoint: require('R2_ENDPOINT'),
    publicUrl: require('R2_PUBLIC_URL')
  };
  return cached;
}

/** For tests only. */
export function _resetR2ConfigForTests(): void {
  cached = null;
}
```

- [ ] **Step 3: Verify typecheck**

```
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add lib/storage/env.ts .env.example
git commit -m "feat(storage): R2 env config (lazy, fail-loudly)"
```

---

## Task 5: R2 client wrapper

**Files:**
- Create: `lib/storage/r2-client.ts`

> Lazy S3 client. `putToR2(key, body, contentType)` is the single mutation primitive. Server-only — imported by the route handler.

- [ ] **Step 1: Write `lib/storage/r2-client.ts`**

```ts
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
```

- [ ] **Step 2: Verify typecheck**

- [ ] **Step 3: Commit**

```bash
git add lib/storage/r2-client.ts
git commit -m "feat(storage): R2 S3 client wrapper (lazy, requestChecksumCalculation set)"
```

---

## Task 6: `/api/upload` route handler

**Files:**
- Create: `app/api/upload/route.ts`

> POST handler. Parses multipart, validates MIME, builds R2 key, puts to R2, returns `MediaRef`.

- [ ] **Step 1: Write `app/api/upload/route.ts`**

```ts
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
  const kind = kindValue as MediaKind;
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
```

- [ ] **Step 2: Verify typecheck**

```
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add app/api/upload/route.ts
git commit -m "feat(api): POST /api/upload — validate, key, put, return MediaRef"
```

---

## Task 7: `/api/upload` integration test

**Files:**
- Create: `tests/integration/upload.api.test.ts`

> Imports `POST` directly, constructs a `Request` with `FormData`, asserts the response. R2 client is mocked via `vi.mock('@aws-sdk/client-s3')`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AWS SDK BEFORE importing the route — the route imports r2-client
// which constructs an S3Client at first putToR2() call.
const sendMock = vi.fn().mockResolvedValue({});
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

  it('rejects a bogus payload with 400 UNSUPPORTED_MIME', async () => {
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
```

- [ ] **Step 2: Make sure `vitest.config.ts` picks up `tests/integration/**`.** Already does (`include: ['tests/**/*.test.ts']`). No change needed.

- [ ] **Step 3: Run — expect PASS (4 tests)**

```
npm test -- integration
```

- [ ] **Step 4: Commit**

```bash
git add tests/integration/upload.api.test.ts
git commit -m "test(api): integration test for POST /api/upload with mocked S3"
```

---

## Task 8: `/api/projects` stub routes

**Files:**
- Create: `app/api/projects/route.ts`
- Create: `app/api/projects/[id]/route.ts`

> Spec §3.1 says D1 schema is prepared but not active in v0.1. The stubs return shape-correct responses so the client can be wired without changing the contract in v0.2.

- [ ] **Step 1: Write `app/api/projects/route.ts`**

```ts
export const runtime = 'nodejs';

/** GET /api/projects — list. v0.1: always empty until D1 is active. */
export async function GET(): Promise<Response> {
  return Response.json({ projects: [] }, { status: 200 });
}

/** POST /api/projects — create. v0.1: echo back with a generated id; no persistence. */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }
  return Response.json(
    {
      ...(body as Record<string, unknown>),
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      note: 'v0.1 stub — not persisted'
    },
    { status: 201 }
  );
}
```

- [ ] **Step 2: Write `app/api/projects/[id]/route.ts`**

```ts
export const runtime = 'nodejs';

/** GET /api/projects/:id — v0.1: 404. Active in v0.2 when D1 is wired. */
export async function GET(
  _request: Request,
  { params: _params }: { params: { id: string } }
): Promise<Response> {
  return Response.json(
    { error: 'not found', note: 'v0.1 stub — D1 not yet active' },
    { status: 404 }
  );
}
```

- [ ] **Step 3: Verify build (catches route bundling errors)**

```
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add app/api/projects/route.ts app/api/projects/\[id\]/route.ts
git commit -m "feat(api): /api/projects stub routes (D1 not yet active)"
```

---

## Task 9: D1 schema

**Files:**
- Create: `db/schema.sql`

> Spec §7.3 verbatim. Not applied in v0.1 — committed for v0.2.

- [ ] **Step 1: Write `db/schema.sql`**

```sql
-- VibeGrid D1 schema (prepared, not applied in v0.1).
-- Applied in v0.2 via `wrangler d1 execute vibegrid --file=db/schema.sql`.

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bpm INTEGER NOT NULL,
  duration_beats INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT CHECK (kind IN ('image','audio')) NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  width INTEGER, height INTEGER, duration_ms INTEGER,
  uploaded_at INTEGER NOT NULL
);

CREATE TABLE clips (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  track_kind TEXT NOT NULL,
  fx_id TEXT,
  media_id TEXT REFERENCES media(id),
  start_beat REAL NOT NULL,
  length_beats REAL NOT NULL,
  params_json TEXT,        -- serialized Record<string, unknown> matching FxPlugin.paramSchema
  trigger TEXT
);

CREATE INDEX idx_clips_project ON clips(project_id);
CREATE INDEX idx_media_project ON media(project_id);
```

- [ ] **Step 2: Commit**

```bash
git add db/schema.sql
git commit -m "feat(db): D1 schema (projects, media, clips) — prepared for v0.2"
```

---

## Task 10: Client-side R2 storage adapter

**Files:**
- Create: `lib/storage/r2-adapter.ts`
- Create: `tests/unit/storage/r2-adapter.test.ts`

> Client-side. Posts multipart to `/api/upload`. Generates the id client-side so optimistic UI updates can insert the `MediaRef` before the response comes back.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createR2StorageAdapter } from '@/lib/storage/r2-adapter';
import type { MediaRef } from '@/lib/storage/types';

describe('R2StorageAdapter', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const mediaRef: MediaRef = {
      id: '11111111-2222-4333-8444-555555555555',
      kind: 'image',
      url: 'https://media.example.com/anonymous/default/image/x.jpg',
      filename: 'cover.jpg',
      uploadedAt: '2026-05-19T12:00:00.000Z'
    };
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mediaRef), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      })
    );
  });

  it('posts a multipart request to /api/upload with kind=image', async () => {
    const adapter = createR2StorageAdapter();
    const file = new File([new Uint8Array([1, 2, 3])], 'cover.jpg', { type: 'image/jpeg' });
    const result = await adapter.uploadImage(file);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/upload');
    expect((init as RequestInit).method).toBe('POST');
    const fd = (init as RequestInit).body as FormData;
    expect(fd.get('kind')).toBe('image');
    expect(typeof fd.get('id')).toBe('string');
    expect(fd.get('file')).toBeInstanceOf(File);
    expect(result.url).toMatch(/^https:/);
  });

  it('posts with kind=audio for uploadAudio', async () => {
    const adapter = createR2StorageAdapter();
    const file = new File([new Uint8Array([1, 2, 3])], 'song.mp3', { type: 'audio/mpeg' });
    await adapter.uploadAudio(file);
    const fd = (fetchSpy.mock.calls[0][1] as RequestInit).body as FormData;
    expect(fd.get('kind')).toBe('audio');
  });

  it('throws when the server returns 4xx', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'bad mime', code: 'UNSUPPORTED_MIME' }), {
        status: 400
      })
    );
    const adapter = createR2StorageAdapter();
    const file = new File([new Uint8Array([1])], 'x.txt', { type: 'text/plain' });
    await expect(adapter.uploadImage(file)).rejects.toThrow(/UNSUPPORTED_MIME|bad mime/);
  });

  it('generates a UUID v4 id per call', async () => {
    const adapter = createR2StorageAdapter();
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' });
    await adapter.uploadImage(file);
    await adapter.uploadImage(file);
    const id1 = (fetchSpy.mock.calls[0][1] as RequestInit).body as FormData;
    const id2 = (fetchSpy.mock.calls[1][1] as RequestInit).body as FormData;
    expect(id1.get('id')).not.toBe(id2.get('id'));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
import type { MediaKind, MediaRef, StorageAdapter } from './types';

interface CreateAdapterOptions {
  /** Override the endpoint — used by tests. */
  endpoint?: string;
}

export function createR2StorageAdapter(options: CreateAdapterOptions = {}): StorageAdapter {
  const endpoint = options.endpoint ?? '/api/upload';

  async function upload(file: File, kind: MediaKind): Promise<MediaRef> {
    const id = crypto.randomUUID();
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    fd.append('id', id);

    const res = await fetch(endpoint, { method: 'POST', body: fd });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string; code?: string };
        if (body.code) detail = body.code;
        else if (body.error) detail = body.error;
      } catch {
        // ignore — keep the HTTP detail
      }
      throw new Error(`Upload failed: ${detail}`);
    }
    return (await res.json()) as MediaRef;
  }

  return {
    uploadImage: (file) => upload(file, 'image'),
    uploadAudio: (file) => upload(file, 'audio')
  };
}
```

- [ ] **Step 4: Run — expect PASS (4 tests)**

- [ ] **Step 5: Commit**

```bash
git add lib/storage/r2-adapter.ts tests/unit/storage/r2-adapter.test.ts
git commit -m "feat(storage): client R2 adapter (multipart POST, client-generated UUID)"
```

---

## Task 11: `mediaRefs` Zustand slice

**Files:**
- Create: `lib/store/media-slice.ts`
- Modify: `lib/store/types.ts`
- Modify: `lib/store/index.ts`
- Create: `tests/unit/store/media-slice.test.ts`

> Per spec §10 — `mediaRefs` is persisted (URL + metadata only, never blobs). Slice exposes `addMediaRef`, `removeMediaRef`, `getMediaRef(id)`.

- [ ] **Step 1: Modify `lib/store/types.ts`**

```ts
import type { TimelineState, Clip } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';
import type { MediaRef } from '@/lib/storage/types';

export interface UIState {
  zoom: number;
  inspectorOpen: boolean;
}

export interface TimelineActions {
  addClip(clip: Clip): void;
  moveClip(clipId: string, newStartBeat: number): void;
  resizeClip(clipId: string, newLengthBeats: number): void;
  removeClip(clipId: string): void;
  setClipParams(clipId: string, params: Record<string, unknown>): void;
  setPlayhead(beats: number): void;
  setMuted(trackId: string, muted: boolean): void;
}

export interface AudioState {
  grid: BeatGrid;
}

export interface AudioActions {
  setBPM(bpm: number): void;
  setDetectedGrid(grid: BeatGrid): void;
  resetGrid(): void;
}

export interface MediaState {
  mediaRefs: MediaRef[];
}

export interface MediaActions {
  addMediaRef(ref: MediaRef): void;
  removeMediaRef(id: string): void;
  getMediaRef(id: string): MediaRef | undefined;
}

export interface AppState {
  ui: UIState;
  setZoom(zoom: number): void;
  setInspectorOpen(open: boolean): void;
  timeline: TimelineState;
  timelineActions: TimelineActions;
  audio: AudioState;
  audioActions: AudioActions;
  media: MediaState;
  mediaActions: MediaActions;
}
```

- [ ] **Step 2: Write `lib/store/media-slice.ts`**

```ts
import type { StateCreator } from 'zustand';
import type { AppState } from './types';
import type { MediaRef } from '@/lib/storage/types';

export const initialMediaState = { mediaRefs: [] as MediaRef[] };

export const createMediaSlice: StateCreator<
  AppState,
  [],
  [],
  Pick<AppState, 'media' | 'mediaActions'>
> = (set, get) => ({
  media: { mediaRefs: [] },
  mediaActions: {
    addMediaRef: (ref) => {
      const existing = get().media.mediaRefs.find((m) => m.id === ref.id);
      if (existing) return; // dedupe by id — second add is a no-op
      set({ media: { mediaRefs: [...get().media.mediaRefs, ref] } });
    },
    removeMediaRef: (id) => {
      set({
        media: { mediaRefs: get().media.mediaRefs.filter((m) => m.id !== id) }
      });
    },
    getMediaRef: (id) => get().media.mediaRefs.find((m) => m.id === id)
  }
});
```

- [ ] **Step 3: Modify `lib/store/index.ts`** to compose the slice + extend `partialize`

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppState } from './types';
import { createTimelineSlice } from './timeline-slice';
import { createAudioSlice } from './audio-slice';
import { createMediaSlice } from './media-slice';

export const useAppStore = create<AppState>()(
  persist(
    (set, get, store) => ({
      ui: { zoom: 1, inspectorOpen: true },
      setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
      setInspectorOpen: (open) => set((s) => ({ ui: { ...s.ui, inspectorOpen: open } })),
      ...createTimelineSlice(set, get, store),
      ...createAudioSlice(set, get, store),
      ...createMediaSlice(set, get, store)
    }),
    {
      name: 'vibegrid-store',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        ui: state.ui,
        timeline: {
          ...state.timeline,
          playhead: {
            ...state.timeline.playhead,
            playing: false
          }
        },
        audio: state.audio,
        media: state.media
      })
    }
  )
);
```

- [ ] **Step 4: Write the slice test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { initialMediaState } from '@/lib/store/media-slice';
import type { MediaRef } from '@/lib/storage/types';

const sampleRef = (id: string): MediaRef => ({
  id,
  kind: 'image',
  url: `https://media.example.com/${id}.jpg`,
  filename: `${id}.jpg`,
  uploadedAt: '2026-05-19T12:00:00.000Z'
});

describe('media store slice', () => {
  beforeEach(() => {
    useAppStore.setState({ media: { ...initialMediaState } });
  });

  it('starts with an empty mediaRefs array', () => {
    expect(useAppStore.getState().media.mediaRefs).toEqual([]);
  });

  it('addMediaRef appends a new ref', () => {
    useAppStore.getState().mediaActions.addMediaRef(sampleRef('a'));
    expect(useAppStore.getState().media.mediaRefs).toHaveLength(1);
  });

  it('addMediaRef is idempotent (same id is dedupe)', () => {
    useAppStore.getState().mediaActions.addMediaRef(sampleRef('a'));
    useAppStore.getState().mediaActions.addMediaRef(sampleRef('a'));
    expect(useAppStore.getState().media.mediaRefs).toHaveLength(1);
  });

  it('removeMediaRef drops the matching ref', () => {
    const { mediaActions } = useAppStore.getState();
    mediaActions.addMediaRef(sampleRef('a'));
    mediaActions.addMediaRef(sampleRef('b'));
    mediaActions.removeMediaRef('a');
    expect(useAppStore.getState().media.mediaRefs.map((m) => m.id)).toEqual(['b']);
  });

  it('getMediaRef returns the matching ref or undefined', () => {
    const { mediaActions } = useAppStore.getState();
    mediaActions.addMediaRef(sampleRef('a'));
    expect(mediaActions.getMediaRef('a')?.id).toBe('a');
    expect(mediaActions.getMediaRef('missing')).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run — expect PASS**

```
npm test -- store
```

- [ ] **Step 6: Commit**

```bash
git add lib/store/media-slice.ts lib/store/types.ts lib/store/index.ts tests/unit/store/media-slice.test.ts
git commit -m "feat(store): integrate media slice (mediaRefs persistence, dedupe by id)"
```

---

## Task 12: Final verification gate

- [ ] **Step 1: Typecheck**

```
npm run typecheck
```

- [ ] **Step 2: Lint**

```
npm run lint
```

- [ ] **Step 3: Storage tests**

```
npm test -- storage
```

Expected: ≥ 18 tests across `mime-validator`, `r2-key`, `r2-adapter`.

- [ ] **Step 4: Integration test**

```
npm test -- integration
```

Expected: 4 tests in `upload.api.test.ts`.

- [ ] **Step 5: Store tests (regression + new slice)**

```
npm test -- store
```

- [ ] **Step 6: Full suite**

```
npm test
```

Expected: every prior test still passes; total ≥ 165.

- [ ] **Step 7: Production build (catches route bundling errors)**

```
npm run build
```

Expected: build PASS. The `app/api/upload/route.js` chunk appears in the build output; `runtime: nodejs` is honored.

---

## Done condition

All 12 tasks committed, all seven verification steps green. The full upload pipeline works end-to-end against a mocked S3 client. The client adapter, route handler, MIME validator, and media slice are all unit/integration tested. **Plan 5 (UI Components) can start.**

## Open questions for review

1. **`@aws-sdk/client-s3` bundle size** — the full SDK adds ~600 KB to the server bundle. Acceptable for the upload route (server-side only, not shipped to client), but worth knowing. Alternative: `aws4fetch` (smaller, fetch-based) — confirm SDK is fine.
2. **Upload-progress reporting** — the client adapter posts via `fetch` and gets no progress events. For v0.1 we show only "uploading…" / "done" in the UI (Plan 5). Progress events would require `XMLHttpRequest` — defer to v0.2 if at all. Confirm.
3. **Client-generated ID semantics** — the client mints the UUID before posting. Server validates the format but trusts the value. Trade-off: simpler optimistic UI vs. a tiny window where a malicious client could reuse an existing object key. v0.1 acceptable (no auth, no multi-user). Confirm.
4. **Vercel hobby tier 4.5 MB payload limit** — affects audio uploads (cap is 50 MB). Document in `KNOWN_LIMITATIONS.md` as a deployment constraint, or block uploads above 4.5 MB by default? Default: document only.
5. **`requestChecksumCalculation: 'WHEN_REQUIRED'`** — spec §7.1 specifies it. SDK v3.658 may have renamed/deprecated the option (check the type signature in this version). If TS complains, leave a comment explaining the spec source and remove the option.
6. **R2 public URL pattern** — the route uses `${publicUrl}/{key}` to build the returned `MediaRef.url`. This assumes a CDN/custom domain in front of R2 (R2 itself doesn't serve over HTTPS without one). Confirm operator setup, or fall back to a signed-URL flow in a follow-up plan.
7. **`/api/projects` GET filter parameters** — v0.1 always returns `[]`. v0.2 will need filtering. Stub leaves room — confirm.
