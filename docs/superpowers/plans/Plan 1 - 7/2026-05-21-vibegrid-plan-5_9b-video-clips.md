# VibeGrid Plan 5.9b — Video-Clips

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project execution policy (overrides skill defaults):** direct-on-main, sequential, one commit per task. NO superpowers-subagent-ceremony — CC #1 implements straight.

---

## Context for the external reviewer

The post-Plan-5.9a baseline is **543 tests passing** at commit `13c489d`.
Plan 5.9a landed dynamic multi-track support: the `'video'` TrackKind
exists, the default Video lane is in `initialTimelineState`, the
TrackHeader + AddTrackButton UI handles it, and `canDropOnTrack`
validates the media-kind/track-kind match. **The video lane is empty
and the upload UI rejects videos** — that's exactly what 5.9b lights
up.

Notable state from 5.9a that affects this plan:

1. **`Clip.kind: TrackKind`** is used to distinguish clip types — for
   video clips it'll be `'video'`. No separate `mediaKind` field.
2. **Multi-track render loop** iterates `timeline.tracks` in array
   order, asks `activeClipOnTrack` per track. The image-rendering
   branch handles `kind === 'image'` only — 5.9b extends it to also
   handle `kind === 'video'` (same pattern, drawImage from a
   `HTMLVideoElement` instead of an `ImageBitmap`).
3. **`firstImageBitmap`** is the bitmap handed to FX plugins that need
   one (Contour edges, ZoomPulse scale). Video tracks **don't** feed
   into this — those FX skip when only video is active. Documented in
   KNOWN_LIMITATIONS.
4. **Store-Migration v5** is current. Plan 5.9b does NOT bump the
   version — it only extends `MediaRef` with the `'video'` kind, which
   is purely additive on the persisted shape.
5. **TimelineState.playhead** = `{ beats: number, playing: boolean }`.
   **AudioEngine grid** lives at `state.audio.grid` with `bpm` +
   `offsetMs`. (Architect's prompt initially used wrong paths like
   `state.ui.isPlaying` — corrected here.)

---

**Goal**: User imports an MP4 or WebM video (≤ 300 s) via the Mediathek,
gets a thumbnail in the asset list, drops the video onto a Video track
on the timeline, sees the video play synchronised with audio in the
live preview, and exports a perfect frame-accurate MP4 of the result
via the existing offline render pipeline.

**Architecture**: six surfaces.

1. **R2 Presigned Upload** (`app/api/presign/route.ts`,
   `lib/storage/video-upload.ts`). Videos are too large for the
   Vercel API-route 4.5 MB cap. Browser POSTs filename + content-type
   + size to `/api/presign` → gets a signed PUT URL valid 1 h →
   uploads directly to R2 via XHR (so we get `upload.onprogress`
   events for the UI fortschrittsbalken). Same R2 bucket as images;
   new env var `R2_ENDPOINT`.

2. **`MediaRef` extension + mock** (`lib/storage/types.ts`,
   `vitest.setup.ts`). `MediaRef.kind` gains `'video'`. Optional new
   field `thumbnailUrl: string` (data-URL JPEG). Test setup gains
   minimal `MockVideoElement` (scoped, NOT a global
   `document.createElement` override — per the W3 architect-feedback).

3. **`VideoEngine` + `useVideoEngine`** (`lib/video/engine.ts`,
   `lib/hooks/useVideoEngine.ts`). Owns the per-mediaId
   `HTMLVideoElement` pool. Methods: `load / unload / seekTo /
   seekAllTo / play / pause / getElement / destroy`. Seeks prefer
   `requestVideoFrameCallback` on Chrome/Edge, fall back to the
   `seeked` event. Video elements are `muted: true` and `playsInline:
   true` — audio comes exclusively from the AudioEngine (no two-source
   sync problem). The hook lazy-loads only videos that are referenced
   by an active clip in the timeline.

4. **Live preview**: extend the multi-track render loop so the image-
   render branch ALSO handles `kind === 'video'` tracks. For a video
   track's active clip: `deps.getVideoElement(clip.mediaId)` →
   `drawImage(videoEl, …)` with the same `drawImageContain` math.
   Video doesn't feed `firstImageBitmap` (Contour / ZoomPulse skip
   when only video is on-screen — limitation noted).

5. **Offline render** (`lib/export/offline-render.ts`). When the
   project has at least one video clip, the orchestrator awaits
   `videoEngine.seekAllTo(timeSec)` before each frame's
   `renderAt(timeSec)`. The async seek is the source of "5-15× longer
   than realtime" — the muxer doesn't care, the result is frame-
   accurate. Projects without video are unchanged.

6. **Mediathek UI**: drag-drop + click-pick accept `video/mp4` and
   `video/webm`. Client-side pre-validation runs
   `getVideoDuration(file)` and rejects > 300 s before upload starts.
   While uploading: progress bar fed from `onProgress`. After upload:
   `generateVideoThumbnail()` grabs the first second and stores it as
   a data-URL JPEG in `MediaRef.thumbnailUrl`. Library tile shows the
   thumbnail with a `▶` badge + duration.

**Tech Stack**: existing — Web Audio API, Canvas 2D, WebCodecs
(unchanged from Plan 6-R), OffscreenCanvas, mp4-muxer / webm-muxer.
**New deps**: `@aws-sdk/s3-request-presigner` (server-side only;
dynamic-imported in the API route to keep it out of the client bundle).
`@aws-sdk/client-s3` is already installed.

**Spec reference**: matches Plan 5.9 spec — split into 5.9a (already
shipped, dynamic tracks) + 5.9b (this plan, video media kind).

**Verification gate (must pass before declaring 5.9b done):**

```
npm test -- export/video-upload       # ≥ 4 (presign route + uploader)
npm test -- storage/video-mediaref    # ≥ 2 (extended MediaRef shape)
npm test -- video/engine              # ≥ 5 (VideoEngine pool + seek)
npm test -- hooks/useVideoEngine      # ≥ 3 (lazy load + play/pause subscribe)
npm test -- renderer/video-track      # ≥ 3 (drawImage from videoEl)
npm test -- export/offline-video      # ≥ 3 (async seekAllTo per frame)
npm test -- components/MediaLibrary   # existing + 4 (video upload UI)
npm test                              # full suite ≥ 568 (543 → +25)
npm run typecheck
npm run lint
npm run build                         # studio bundle within +10 % of 158 kB
                                      # (~174 kB ceiling; VideoEngine + UI)
```

**Smoke gate (manual, before declaring 5.9b done):**

```
npm run dev
# 1. Upload a 30 s MP4 (H.264) → progress bar appears, fills, thumbnail
#    renders in the library tile with a ▶ badge + "0:30".
# 2. Drag the video onto the Video track → clip lands with the right
#    length (lengthBeats = round(duration × bpm / 60)).
# 3. Drag the same video onto the Image track → toast: "Video kann
#    nicht auf 'image'-Track — nur auf Video-Tracks".
# 4. Press play → audio plays, video frames advance in the stage,
#    A/V stays in sync for the full 30 s.
# 5. Scrub the playhead during pause → video seeks to that frame.
# 6. Add a Pulse + Sweep FX track over the video → FX overlay the
#    video correctly (z-order: image-or-video first, then FX, exactly
#    as Plan 5.9a's render loop sorts).
# 7. Export → progress bar reads "Rendering N / M (X %)" but is
#    visibly slower than a no-video export. Resulting MP4 plays
#    cleanly in VLC, A/V locked.
# 8. Upload a .mov file → toast rejects ("Nur MP4 und WebM").
# 9. Upload a 6-minute video → toast rejects ("Video zu lang
#    (max. 5 Minuten)").
# 10. Reload the page → existing v5 projects rehydrate, video
#     clip + thumbnail are still there (MediaRef persisted).
```

**Dependencies on prior plans:**
- **Plan 4**: R2 bucket already provisioned, CORS configured for image
  uploads. 5.9b needs the same CORS entry to also allow `PUT` from
  the browser origin.
- **Plan 5.9a**: dynamic tracks, `'video'` TrackKind, canDropOnTrack,
  activeClipOnTrack — all in place.
- **Plan 6-R**: offline-render pipeline. 5.9b adds an async pre-step
  before each `renderAt`.

**Out of scope (v0.2 or later):**

- **Video-Audio extraction** to a separate audio track. v0.1: video
  is `muted: true`, audio runs through the AudioEngine only.
- **Video trimming / in-out points**. The clip uses the full video
  from t=0. Lengthening is via `lengthBeats` resize like any clip.
- **MOV format**. QuickTime container hosts codecs browsers often
  can't decode (ProRes). Rejected at upload.
- **4K video**. Pipeline is resolution-agnostic but only tested with
  1080p sources.
- **Reorder-UI for tracks** (drag-rearrange in the lane header). 5.9a
  shipped the `reorderTracks` action; the UI is v0.2.
- **Auto-Preset for video**. ✨-button stays image-focused. Documented.

---

## Architecture insights

### 1. `'video'` joins the image-render branch — not a new pass

After 5.9a the render loop already iterates `timeline.tracks` per
kind. The image branch handles `kind === 'image'`; 5.9b's one-line
diff is `(t.kind === 'image' || t.kind === 'video')`. For video the
draw call becomes `drawImage(videoEl, …)` instead of
`drawImage(bitmap, …)`. `drawImageContain` math (aspect-preserving
fit) is the same.

This keeps z-order correct: tracks render in array order, so a Video
track BELOW an Image track in the user's lane stack renders FIRST,
and the Image overlays it. Same rule for `[Image, Video, Image2]` —
the second Image overlays the Video which overlays the first Image.

### 2. FX plugins that need a bitmap ignore video tracks

Contour does Canny edge-detection on an `ImageBitmap` (via the
existing `imageBitmap` field in `RenderContext`). ZoomPulse re-draws
the `imageBitmap` with a scale transform. Neither can operate on a
`HTMLVideoElement` without extra plumbing (offscreen-canvas dump,
`getImageData`, …) — well outside the v0.1 scope.

So `firstImageBitmap` continues to track only `kind === 'image'`. A
project with ONLY video clips and an active Contour or ZoomPulse
clip simply skips those FX (existing `if (!imageBitmap) continue;`
guard in `loop.ts:183` handles it). KNOWN_LIMITATIONS notes this.

### 3. Lazy video loading — only load what the timeline references

`<video>` elements cost real memory (per-frame decoded buffer queue).
A project with 5 unused video uploads should NOT eagerly load them
all. `useVideoEngine` subscribes to the store and computes the set
of mediaIds referenced by clips with `kind === 'video'`:

```ts
const activeVideoMediaIds = useAppStore(s =>
  new Set(s.timeline.clips.filter(c => c.kind === 'video').map(c => c.mediaId!))
);
```

For each new id appearing in the set: `engine.load(id, url)`. For
each id removed: `engine.unload(id)`. Switching the active project,
deleting a clip, or removing a media ref all eventually free the
elements.

### 4. Sync model is dead simple in v0.1

```ts
// useVideoEngine subscribes:
useAppStore.subscribe((state, prev) => {
  const engine = videoEngineRef.current;
  if (!engine) return;
  const wasPlaying = prev.timeline.playhead.playing;
  const isPlaying = state.timeline.playhead.playing;
  if (isPlaying && !wasPlaying) engine.play();
  if (!isPlaying && wasPlaying) engine.pause();
  // Seek-only (paused): when playhead jumps without playback.
  if (!isPlaying && state.timeline.playhead.beats !== prev.timeline.playhead.beats) {
    const grid = state.audio.grid;
    const sec = (state.timeline.playhead.beats * 60) / grid.bpm + grid.offsetMs / 1000;
    void engine.seekAllTo(sec);
  }
});
```

No periodic resync drift-compensation in v0.1. Modern browsers' video
clocks are tight enough at minute-scale clip lengths that a 5-minute
clip stays within ±100 ms — well below the perceptual threshold for
"out of sync" with the audio. If drift becomes an issue, v0.2 can
add a 1 Hz `seekAllTo(audioCurrentTime)` reconciler.

### 5. Offline render — one extra await per frame

The Plan-6-R orchestrator's frame loop becomes:

```ts
for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (videoError) throw videoError;
  const timeSec = frameIdx / fps;

  if (deps.videoEngine) {
    await deps.videoEngine.seekAllTo(timeSec);  // <- new
  }

  offlineRenderer.renderAt(timeSec);
  // ... existing VideoFrame.encode path ...
}
```

The await is the heavy lifter — each frame must wait for the video
to actually settle at `timeSec` before the canvas snapshot is taken.
On Chrome/Edge with `requestVideoFrameCallback`: ~10-30 ms per frame.
On Firefox/Safari with `seeked`-event fallback: ~50-100 ms per frame.
That's where the 5-15× longer render times come from.

Without video clips the offline path is unchanged — `deps.videoEngine`
is null and the await never runs.

---

## File map

| File | Action |
|---|---|
| `app/api/presign/route.ts` (create) | POST `/api/presign` — validates contentType+size, issues a 1 h signed PUT URL, returns `{ presignedUrl, publicUrl, key }` |
| `lib/storage/video-upload.ts` (create) | `uploadVideoToR2(file, onProgress)` via XHR; `getVideoDuration(file)` via `<video>.preload='metadata'` |
| `lib/storage/types.ts` (modify) | `MediaRef.kind` gains `'video'`; new optional `thumbnailUrl?: string` |
| `lib/video/engine.ts` (create) | `createVideoEngine()` factory + `VideoEngine` interface. SSR-safe (returns null when `typeof window === 'undefined'`). Seek prefers `requestVideoFrameCallback`, falls back to `seeked` event. |
| `lib/hooks/useVideoEngine.ts` (create) | Hook owns the engine ref. Lazy-loads videos referenced by current clips. Subscribes to playhead.playing + playhead.beats for play/pause/seek sync. |
| `lib/renderer/loop.ts` (modify) | `RendererDeps` gains `getVideoElement: (mediaId: string) => HTMLVideoElement \| null`. Image-render branch extended for `kind === 'video'` tracks. |
| `lib/renderer/types.ts` | Unchanged. `getVideoElement` is on `RendererDeps`, **NOT** on `RenderContext` (plugins don't see videos). |
| `lib/export/offline-render.ts` (modify) | `OfflineRenderDeps` gains optional `videoEngine?: VideoEngine \| null`. Frame loop awaits `seekAllTo` when provided. |
| `lib/hooks/useVideoExporter.ts` (modify) | Plumb `videoEngine` from `useVideoEngine` through to `renderOffline`. |
| `components/MediaLibrary/MediaLibrary.tsx` (modify) | Accept video MIME types in drop + file picker; pre-validate duration; show upload progress; render thumbnail tile with ▶ + duration badge |
| `components/MediaLibrary/utils.ts` or inline (create) | `generateVideoThumbnail(url)` — `<video>` + seek to 1s + `canvas.toDataURL('image/jpeg', 0.7)` |
| `app/(studio)/page.tsx` (modify) | Mount `useVideoEngine`, thread its `getElement` into the existing canvas-ref wiring so the renderer can reach `getVideoElement` |
| `components/Workspace/Stage/CanvasView.tsx` (modify) | Pass `getVideoElement` down to `useRenderer` |
| `lib/hooks/useRenderer.ts` (modify) | Wire the new `getVideoElement` dep into `createRenderer` |
| `vitest.setup.ts` (modify) | `MockVideoElement` constructor — used by tests that opt into it via `vi.spyOn(document, 'createElement')` PER TEST (NOT globally). |
| `.env.example` (modify) | Add `R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `package.json` | `@aws-sdk/s3-request-presigner` (new dep; server-side only) |
| `KNOWN_LIMITATIONS.md` (modify) | Video constraints section (5 min cap, MP4/WebM only, FX-bitmap-deps skip video, offline render 5-15× slower, AutoPreset ignores video) |

---

## Tasks

### Task 0 — Baseline check

```powershell
npm test -- --run     # 543 passing expected
npm run typecheck
npm run lint
npm run build         # First Load JS ~158 kB
```

Note the numbers for the verification gate.

---

### Task 1 — `@aws-sdk/s3-request-presigner` + `/api/presign` route

**Files:**
- Create: `app/api/presign/route.ts`
- Modify: `package.json`, `package-lock.json`, `.env.example`

- [ ] **Step 1 — Install**

```
npm install @aws-sdk/s3-request-presigner
```

- [ ] **Step 2 — Env variable**

In `.env.example`:
```
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```
Existing variables (`R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`) are unchanged.

- [ ] **Step 3 — Write the failing test**

`tests/integration/presign.api.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/presign/route';

describe('POST /api/presign', () => {
  beforeEach(() => {
    process.env.R2_BUCKET_NAME = 'test';
    process.env.R2_ACCESS_KEY_ID = 'k';
    process.env.R2_SECRET_ACCESS_KEY = 's';
    process.env.R2_ENDPOINT = 'https://x.r2.cloudflarestorage.com';
    process.env.R2_PUBLIC_URL = 'https://x.example';
  });

  it('rejects unsupported MIME types', async () => {
    const req = new Request('http://localhost/api/presign', {
      method: 'POST',
      body: JSON.stringify({ filename: 'x.mov', contentType: 'video/quicktime', sizeBytes: 1000 })
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unsupported-type');
  });

  it('rejects files larger than 500 MB', async () => { /* … */ });
  it('rejects files with non-positive size', async () => { /* … */ });
  it('returns presignedUrl + publicUrl + key on a valid request', async () => { /* … */ });
});
```

- [ ] **Step 4 — Implement the route**

```ts
// app/api/presign/route.ts
import 'server-only';

const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
const MAX_SIZE_BYTES = 500 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  let payload: { filename?: string; contentType?: string; sizeBytes?: number };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: 'bad-json' }, { status: 400 });
  }
  const { filename, contentType, sizeBytes } = payload;
  if (!filename || !contentType || typeof sizeBytes !== 'number' || sizeBytes <= 0) {
    return Response.json({ error: 'bad-request' }, { status: 400 });
  }
  if (!ALLOWED_VIDEO_TYPES.includes(contentType)) {
    return Response.json({ error: 'unsupported-type' }, { status: 400 });
  }
  if (sizeBytes > MAX_SIZE_BYTES) {
    return Response.json({ error: 'too-large' }, { status: 400 });
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `videos/${crypto.randomUUID()}-${safeName}`;

  // Dynamic imports keep these out of the client bundle.
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

  const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!
    }
  });
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType
  });
  const presignedUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
  return Response.json({ presignedUrl, publicUrl, key });
}
```

- [ ] **Step 5 — Verify tests pass + bundle stays small**

```
npx vitest run tests/integration/presign.api.test.ts
npm run build  # presign route appears as ƒ /api/presign 0 B (server-only)
```

- [ ] **Step 6 — Commit**

```bash
git add app/api/presign/route.ts package.json package-lock.json .env.example tests/integration/presign.api.test.ts
git commit -m "feat(api): R2 presigned PUT route for video uploads"
```

---

### Task 2 — `uploadVideoToR2` + `getVideoDuration` helpers

**Files:**
- Create: `lib/storage/video-upload.ts`
- Test: `tests/unit/storage/video-upload.test.ts`

- [ ] **Step 1 — Write failing tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { uploadVideoToR2 } from '@/lib/storage/video-upload';

describe('uploadVideoToR2', () => {
  it('POSTs to /api/presign with filename, contentType, sizeBytes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        presignedUrl: 'https://r2/sig',
        publicUrl: 'https://cdn/key',
        key: 'k'
      }))
    );
    // Mock XMLHttpRequest with .upload.onprogress
    // ... assert fetch called with presign payload
  });

  it('uploads via PUT with the Content-Type header', async () => { /* … */ });
  it('reports progress via onProgress callback', async () => { /* … */ });
  it('rejects when the XHR returns >= 300', async () => { /* … */ });
});
```

- [ ] **Step 2 — Implement**

```ts
// lib/storage/video-upload.ts

export interface VideoUploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface VideoUploadResult {
  publicUrl: string;
  key: string;
}

export async function uploadVideoToR2(
  file: File,
  onProgress?: (p: VideoUploadProgress) => void
): Promise<VideoUploadResult> {
  const presignRes = await fetch('/api/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size
    })
  });
  if (!presignRes.ok) {
    const body = await presignRes.json().catch(() => ({}));
    throw new Error(`Presign failed: ${body.error ?? presignRes.statusText}`);
  }
  const { presignedUrl, publicUrl, key } = await presignRes.json();

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presignedUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percent: (e.loaded / e.total) * 100
        });
      };
    }
    xhr.onload = () => {
      xhr.status < 300
        ? resolve()
        : reject(new Error(`R2 upload failed: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Network error during R2 upload'));
    xhr.send(file);
  });

  return { publicUrl, key };
}

/**
 * Reads `video.duration` after the metadata loads. Returns seconds.
 * Used for client-side pre-validation before we even hit the presign route.
 */
export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const d = video.duration;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to read video metadata'));
    };
    video.src = url;
  });
}
```

- [ ] **Step 3 — Verify tests pass**

- [ ] **Step 4 — Commit**

```bash
git add lib/storage/video-upload.ts tests/unit/storage/video-upload.test.ts
git commit -m "feat(storage): uploadVideoToR2 + getVideoDuration helpers"
```

---

### Task 3 — `MediaRef` extension + `MockVideoElement`

**Files:**
- Modify: `lib/storage/types.ts`
- Modify: `vitest.setup.ts`
- Test: `tests/unit/storage/video-mediaref.test.ts`

- [ ] **Step 1 — Extend `MediaRef`**

```ts
// lib/storage/types.ts
export type MediaKind = 'image' | 'audio' | 'video';

export interface MediaRef {
  id: string;
  kind: MediaKind;
  url: string;
  // … existing fields (filename, duration, width, height, uploadedAt) …
  thumbnailUrl?: string;  // Plan 5.9b — first-frame JPEG data URL
}
```

- [ ] **Step 2 — `MockVideoElement` (NOT globally injected)**

Add to `vitest.setup.ts` AT THE END (after the existing media stubs):

```ts
/**
 * MockVideoElement — minimal stand-in for HTMLVideoElement in tests
 * that exercise VideoEngine / useVideoEngine / video upload.
 *
 * Per the W3 architect-feedback this is NOT spy-injected globally
 * into document.createElement. Tests opt in per case:
 *
 *   const orig = document.createElement.bind(document);
 *   vi.spyOn(document, 'createElement').mockImplementation((tag) =>
 *     tag === 'video' ? new MockVideoElement() as unknown as HTMLVideoElement : orig(tag)
 *   );
 *
 * Restored in afterEach via vi.restoreAllMocks().
 */
class MockVideoElement extends EventTarget {
  currentTime = 0;
  duration = 60;
  muted = true;
  playsInline = true;
  src = '';
  preload = '';
  onloadedmetadata: (() => void) | null = null;
  onloadeddata: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play() { return Promise.resolve(); }
  pause() {}
  load() {
    queueMicrotask(() => {
      this.onloadedmetadata?.();
      this.onloadeddata?.();
    });
  }
}
// @ts-expect-error — test-only global.
globalThis.MockVideoElement = MockVideoElement;
```

- [ ] **Step 3 — Write failing test**

```ts
// tests/unit/storage/video-mediaref.test.ts
import { describe, it, expect } from 'vitest';
import type { MediaRef } from '@/lib/storage/types';

describe('MediaRef — video kind', () => {
  it('accepts kind === "video"', () => {
    const ref: MediaRef = {
      id: '1',
      kind: 'video',
      url: 'https://x/v.mp4',
      filename: 'v.mp4',
      uploadedAt: '2026-05-21T00:00:00Z',
      duration: 30,
      thumbnailUrl: 'data:image/jpeg;base64,abc'
    };
    expect(ref.kind).toBe('video');
    expect(ref.thumbnailUrl?.startsWith('data:')).toBe(true);
  });

  it('thumbnailUrl is optional', () => {
    const ref: MediaRef = {
      id: '1', kind: 'video', url: 'x', filename: 'v.mp4',
      uploadedAt: '2026-05-21T00:00:00Z', duration: 30
    };
    expect(ref.thumbnailUrl).toBeUndefined();
  });
});
```

- [ ] **Step 4 — Commit**

```bash
git add lib/storage/types.ts vitest.setup.ts tests/unit/storage/video-mediaref.test.ts
git commit -m "feat(storage): MediaRef video kind + thumbnailUrl + MockVideoElement"
```

---

### Task 4 — `VideoEngine`

**Files:**
- Create: `lib/video/engine.ts`
- Test: `tests/unit/video/engine.test.ts`

- [ ] **Step 1 — Write failing tests**

Cover: load adds element, unload removes element, seekTo with
`requestVideoFrameCallback` when available, seekTo with `seeked`-event
fallback, seekTo no-op when delta < 0.01 s, seekAllTo on multiple
elements, play / pause propagate, SSR returns null.

- [ ] **Step 2 — Implement**

```ts
// lib/video/engine.ts
import { isClient } from '@/lib/utils/is-client';

export interface VideoEngine {
  load(mediaId: string, url: string): Promise<void>;
  unload(mediaId: string): void;
  seekTo(mediaId: string, timeSec: number): Promise<void>;
  seekAllTo(timeSec: number): Promise<void>;
  play(): void;
  pause(): void;
  getElement(mediaId: string): HTMLVideoElement | null;
  destroy(): void;
}

const SEEK_EPS = 0.01;  // seconds — skip seek when already on the frame

export function createVideoEngine(): VideoEngine | null {
  if (!isClient()) return null;

  const elements = new Map<string, HTMLVideoElement>();

  function seekElement(el: HTMLVideoElement, timeSec: number): Promise<void> {
    if (Math.abs(el.currentTime - timeSec) < SEEK_EPS) return Promise.resolve();
    return new Promise<void>((resolve) => {
      // Chrome / Edge: frame-accurate, finishes when the requested frame
      // is actually painted. Significantly faster than the `seeked` event
      // (10-30 ms vs 50-100 ms).
      const elAny = el as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
      if (typeof elAny.requestVideoFrameCallback === 'function') {
        elAny.requestVideoFrameCallback(() => resolve());
      } else {
        const onSeeked = () => {
          el.removeEventListener('seeked', onSeeked);
          resolve();
        };
        el.addEventListener('seeked', onSeeked, { once: true });
      }
      el.currentTime = timeSec;
    });
  }

  return {
    async load(mediaId, url) {
      if (elements.has(mediaId)) return;
      const el = document.createElement('video');
      el.src = url;
      el.preload = 'auto';
      el.muted = true;
      el.playsInline = true;
      await new Promise<void>((resolve, reject) => {
        el.onloadeddata = () => resolve();
        el.onerror = () => reject(new Error(`Video load failed: ${url}`));
        el.load();
      });
      elements.set(mediaId, el);
    },
    unload(mediaId) {
      const el = elements.get(mediaId);
      if (!el) return;
      el.pause();
      el.src = '';
      elements.delete(mediaId);
    },
    async seekTo(mediaId, timeSec) {
      const el = elements.get(mediaId);
      if (el) await seekElement(el, timeSec);
    },
    async seekAllTo(timeSec) {
      await Promise.all([...elements.values()].map((el) => seekElement(el, timeSec)));
    },
    play() {
      elements.forEach((el) => {
        el.play().catch(() => { /* autoplay-blocked is OK — preview only */ });
      });
    },
    pause() {
      elements.forEach((el) => el.pause());
    },
    getElement(mediaId) {
      return elements.get(mediaId) ?? null;
    },
    destroy() {
      elements.forEach((el) => {
        el.pause();
        el.src = '';
      });
      elements.clear();
    }
  };
}
```

- [ ] **Step 3 — Verify + commit**

```bash
git add lib/video/engine.ts tests/unit/video/engine.test.ts
git commit -m "feat(video): VideoEngine — HTMLVideoElement pool + seek helpers"
```

---

### Task 5 — `useVideoEngine` hook (lazy load + sync subscriptions)

**Files:**
- Create: `lib/hooks/useVideoEngine.ts`
- Test: `tests/unit/hooks/useVideoEngine.test.tsx`

- [ ] **Step 1 — Write failing tests**

Cover: hook returns a `getElement` accessor stable across re-renders,
videos referenced by active clips are loaded, unreferenced videos are
unloaded, play/pause propagates on `playhead.playing` change,
seekAllTo runs on playhead-beat change while paused.

- [ ] **Step 2 — Implement**

```ts
// lib/hooks/useVideoEngine.ts
'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { createVideoEngine, type VideoEngine } from '@/lib/video/engine';

export interface UseVideoEngineReturn {
  getElement: (mediaId: string) => HTMLVideoElement | null;
  engine: VideoEngine | null;
}

export function useVideoEngine(): UseVideoEngineReturn {
  const engineRef = useRef<VideoEngine | null>(null);
  if (engineRef.current === null && typeof window !== 'undefined') {
    engineRef.current = createVideoEngine();
  }

  // Lazy load: track the set of video mediaIds referenced by active clips.
  const activeIdsKey = useAppStore((s) =>
    [...new Set(s.timeline.clips
      .filter((c) => c.kind === 'video' && c.mediaId)
      .map((c) => c.mediaId!))].sort().join(',')
  );
  const mediaRefs = useAppStore((s) => s.media.mediaRefs);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const wanted = new Set(activeIdsKey.split(',').filter(Boolean));
    // Load newly-referenced videos.
    for (const id of wanted) {
      const ref = mediaRefs.find((m) => m.id === id && m.kind === 'video');
      if (ref) {
        void engine.load(id, ref.url).catch((err) =>
          // eslint-disable-next-line no-console
          console.warn('[useVideoEngine] load failed:', err)
        );
      }
    }
    // Unload videos that are no longer referenced.
    // (We track loaded ids inside the engine — re-derive from getElement.)
    // For simplicity in v0.1 we don't re-unload on clip removal here; videos
    // stay loaded until the engine is destroyed on hook unmount.
  }, [activeIdsKey, mediaRefs]);

  // Sync subscription: playhead.playing + playhead.beats.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const unsub = useAppStore.subscribe((state, prev) => {
      const wasPlaying = prev.timeline.playhead.playing;
      const isPlaying = state.timeline.playhead.playing;
      if (isPlaying && !wasPlaying) engine.play();
      if (!isPlaying && wasPlaying) engine.pause();
      if (
        !isPlaying &&
        state.timeline.playhead.beats !== prev.timeline.playhead.beats
      ) {
        const grid = state.audio.grid;
        const sec = (state.timeline.playhead.beats * 60) / grid.bpm
          + grid.offsetMs / 1000;
        void engine.seekAllTo(sec);
      }
    });
    return () => {
      unsub();
    };
  }, []);

  // Destroy on unmount.
  useEffect(() => {
    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  return useMemo(
    () => ({
      getElement: (id: string) => engineRef.current?.getElement(id) ?? null,
      engine: engineRef.current
    }),
    []
  );
}
```

- [ ] **Step 3 — Verify + commit**

```bash
git add lib/hooks/useVideoEngine.ts tests/unit/hooks/useVideoEngine.test.tsx
git commit -m "feat(video): useVideoEngine hook — lazy load + playhead sync"
```

---

### Task 6 — Renderer: video-track rendering

**Files:**
- Modify: `lib/renderer/loop.ts`
- Modify: `lib/hooks/useRenderer.ts`
- Modify: `components/Workspace/Stage/CanvasView.tsx`
- Modify: `app/(studio)/page.tsx`
- Test: `tests/unit/renderer/video-track.test.ts`

- [ ] **Step 1 — Add `getVideoElement` to `RendererDeps`**

```ts
// lib/renderer/loop.ts
export interface RendererDeps {
  // … existing …
  /** Plan-5.9b: video-frame source per mediaId. Returns null when no
   *  element is loaded yet (video still pending) — the renderer skips
   *  that frame's video draw rather than throwing. */
  getVideoElement?: (mediaId: string) => HTMLVideoElement | null;
}
```

- [ ] **Step 2 — Extend the image-render branch**

```ts
// In tick(), the existing image loop:
for (const track of timeline.tracks) {
  const isImage = track.kind === 'image';
  const isVideo = track.kind === 'video';
  if (!isImage && !isVideo) continue;
  if (track.muted) continue;
  const clip = activeClipOnTrack(track.id, timeline.clips, beats);
  if (!clip || !clip.mediaId) continue;

  let source: CanvasImageSource | undefined;
  if (isImage) {
    const bm = deps.getImageBitmap(clip.mediaId);
    if (!bm) continue;
    source = bm;
    if (!firstImageBitmap) firstImageBitmap = bm;
  } else {
    // isVideo
    const el = deps.getVideoElement?.(clip.mediaId);
    if (!el) continue;
    source = el;
  }

  const alpha = computeClipAlpha(timeline, clip, beats);
  const usesAlpha = alpha < 1;
  if (usesAlpha) {
    ctx!.save();
    ctx!.globalAlpha *= alpha;
  }
  // drawImageContain works with both ImageBitmap and HTMLVideoElement.
  drawImageContain(ctx!, source, w, h);
  if (usesAlpha) ctx!.restore();
}
```

`drawImageContain` already accepts `CanvasImageSource`; verify the type
signature in `loop.ts` matches.

- [ ] **Step 3 — Plumb `getVideoElement` from page to renderer**

`app/(studio)/page.tsx`:
```ts
const { getElement: getVideoElement } = useVideoEngine();
// existing canvasRef + getBitmap plumbing extended:
<CanvasView ... getVideoElement={getVideoElement} />
```

`CanvasView.tsx` + `useRenderer.ts`: thread the callback through.

- [ ] **Step 4 — Tests + commit**

Cover: a video track with an active clip + a loaded element produces a
`drawImage` call; a video track with a NULL element from `getVideoElement`
is silently skipped; a muted video track is skipped; FX tracks render
ABOVE the video.

```bash
git add lib/renderer/loop.ts lib/hooks/useRenderer.ts components/Workspace/Stage/CanvasView.tsx app/\(studio\)/page.tsx tests/unit/renderer/video-track.test.ts
git commit -m "feat(renderer): draw active video clips via VideoEngine"
```

---

### Task 7 — Offline render: async seek per frame

**Files:**
- Modify: `lib/export/offline-render.ts`
- Modify: `lib/hooks/useVideoExporter.ts`
- Test: `tests/unit/export/offline-video.test.ts`

- [ ] **Step 1 — Extend `OfflineRenderDeps`**

```ts
import type { VideoEngine } from '@/lib/video/engine';

export interface OfflineRenderDeps {
  // … existing …
  videoEngine?: VideoEngine | null;
}
```

- [ ] **Step 2 — Await seek in the frame loop**

Inside the `for (let frameIdx = 0; …)` loop, BEFORE
`offlineRenderer.renderAt(timeSec)`:

```ts
if (deps.videoEngine) {
  await deps.videoEngine.seekAllTo(timeSec);
  // Also check abort + videoError between the await and the encode
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (videoError) throw videoError;
}
```

- [ ] **Step 3 — Wire `videoEngine` through `useVideoExporter`**

```ts
// In useVideoExporter.ts where renderOffline is invoked:
const { engine: videoEngine } = useVideoEngine();
// … inside start():
await renderOffline(
  {
    timeline,
    beatGrid,
    audioBuffer,
    getImageBitmap: getBitmap,
    videoEngine,            // <- new
    flowMode: useAppStore.getState().ui.flowMode
  },
  // … options
);
```

Projects without video clips: `videoEngine` exists but `seekAllTo`
resolves immediately (empty Map). Zero overhead.

- [ ] **Step 4 — Tests + commit**

Cover: `seekAllTo` invoked once per frame, AbortError between seek and
encode propagates, projects without video are unchanged in timing.

```bash
git add lib/export/offline-render.ts lib/hooks/useVideoExporter.ts tests/unit/export/offline-video.test.ts
git commit -m "feat(export): async seekAllTo before each offline frame"
```

---

### Task 8 — Mediathek UI: video upload + thumbnail

**Files:**
- Modify: `components/MediaLibrary/MediaLibrary.tsx`
- Create or inline: `generateVideoThumbnail(url)` helper
- Test: `tests/unit/components/MediaLibrary.test.tsx` (extend)

- [ ] **Step 1 — Accept video MIME types in drop + file picker**

The existing handler that processes image uploads is extended:

```ts
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

async function handleFile(file: File) {
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return handleImageUpload(file); // existing path
  }
  if (ALLOWED_VIDEO_TYPES.includes(file.type)) {
    return handleVideoUpload(file); // new
  }
  toast.error('Nur PNG / JPEG / WebP Bilder oder MP4 / WebM Videos');
}
```

- [ ] **Step 2 — `handleVideoUpload` flow**

```ts
async function handleVideoUpload(file: File) {
  // 1. Duration pre-check (cheap, no upload yet)
  let duration: number;
  try {
    duration = await getVideoDuration(file);
  } catch {
    toast.error('Konnte Video-Metadaten nicht lesen');
    return;
  }
  if (duration > 300) {
    toast.error('Video zu lang (max. 5 Minuten)');
    return;
  }

  // 2. Optimistic placeholder for the progress bar in the library tile
  const tempId = crypto.randomUUID();
  setUploadProgress({ [tempId]: 0 });

  try {
    const { publicUrl, key } = await uploadVideoToR2(file, (p) => {
      setUploadProgress({ [tempId]: p.percent });
    });

    // 3. Thumbnail from the uploaded URL
    const thumbnailUrl = await generateVideoThumbnail(publicUrl).catch(() => undefined);

    // 4. Register MediaRef
    addMediaRef({
      id: crypto.randomUUID(),
      kind: 'video',
      url: publicUrl,
      filename: file.name,
      uploadedAt: new Date().toISOString(),
      duration,
      thumbnailUrl
    });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Video-Upload fehlgeschlagen');
  } finally {
    setUploadProgress((p) => {
      const next = { ...p };
      delete next[tempId];
      return next;
    });
  }
}
```

- [ ] **Step 3 — Thumbnail helper**

```ts
async function generateVideoThumbnail(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    video.src = url;
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, video.duration / 2);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2D context');
        ctx.drawImage(video, 0, 0, 160, 90);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      } catch (err) {
        reject(err);
      }
    };
    video.onerror = () => reject(new Error('Thumbnail load failed'));
  });
}
```

- [ ] **Step 4 — Library tile rendering**

For `mediaRef.kind === 'video'`:
```tsx
<div className="relative">
  <img src={ref.thumbnailUrl ?? FALLBACK} alt={ref.filename} />
  <div className="absolute bottom-1 right-1 bg-black/70 px-1.5 py-0.5 rounded text-xs">
    ▶ {formatDuration(ref.duration ?? 0)}
  </div>
</div>
```

`formatDuration(s)` returns `M:SS`.

- [ ] **Step 5 — Tests + commit**

Cover: drop on the library accepts MP4, rejects MOV with the toast,
rejects > 300 s with the toast, calls `addMediaRef` with `kind: 'video'`
+ `thumbnailUrl`.

```bash
git add components/MediaLibrary/MediaLibrary.tsx tests/unit/components/MediaLibrary.test.tsx
git commit -m "feat(media): video upload UI — progress + thumbnail"
```

---

### Task 9 — `KNOWN_LIMITATIONS.md` + final gate

**Files:**
- Modify: `KNOWN_LIMITATIONS.md`

- [ ] **Step 1 — New section**

```markdown
## Video-Clips (Plan 5.9b)

- **Max. 5 Minuten pro Video-Clip** — client-side pre-check rejects
  longer files before upload.
- **Unterstützte Formate**: MP4 (H.264) and WebM (VP9). MOV is
  rejected — its codec landscape (ProRes, HEVC variants, …) breaks
  browser decoding too often to support in v0.1.
- **Max. 500 MB upload size** — server-side check in `/api/presign`.
- **Video-Audio wird ignoriert**. The `<video>` element runs muted.
  Audio comes exclusively from the AudioEngine — the user has to add
  the audio track separately if they want the video's soundtrack.
- **Contour / ZoomPulse FX skip video tracks**. Both need an
  `ImageBitmap`; the video element doesn't provide one without
  expensive offscreen extraction. A project with ONLY video clips
  active and a Contour/ZoomPulse clip on top will render those FX
  as no-ops.
- **Offline export with video is 5-15× slower than realtime**. Each
  frame must async-await `seekAllTo` so the video is settled at the
  exact frame time before encoding. `requestVideoFrameCallback` on
  Chrome/Edge keeps it on the lower end of that range; Firefox/Safari
  use the `seeked` event and are slower.
- **R2 CORS must allow PUT** for the browser origin (Presigned upload).
  Add the origin to the Cloudflare R2 bucket's CORS settings under
  AllowedMethods.
- **Auto-Preset (✨) ignores video clips**. The Claude prompt has no
  awareness of video; it suggests FX for image clips only.
- **Multi-Audio-Tracks** are a v0.2 feature (the `'audio'` TrackKind
  exists in 5.9a as a forward-compat stub).
- **Reorder-UI for tracks** is a v0.2 feature (the `reorderTracks`
  store action exists, but no drag-rearrange in the lane header).
```

- [ ] **Step 2 — Final verification gate**

```
npm test -- --run    # ≥ 568 tests, 0 failing
npm run typecheck
npm run lint
npm run build        # Studio First Load JS ≤ 174 kB (158 + 10%)
```

- [ ] **Step 3 — Manual smoke gate**

Run the 10-step smoke list from the top of this plan. Every step must
pass before 5.9b is declared done.

- [ ] **Step 4 — Commit**

```bash
git add KNOWN_LIMITATIONS.md
git commit -m "docs(limitations): video clip constraints + 5.9b done"
```

---

## Risks + open questions

1. **R2 CORS for PUT**: needs a one-time configuration tweak at the
   Cloudflare R2 dashboard (existing image uploads only need GET).
   Documented in KNOWN_LIMITATIONS. If a user encounters CORS errors
   on upload, the fix is dashboard-side, not code-side.

2. **`requestVideoFrameCallback` browser coverage**: Firefox 130+ has
   it as of 2026-05; older Firefox falls back to `seeked` event. The
   fallback is correct, just slower.

3. **Long-clip drift**: video clock vs audio clock can drift over
   minutes. v0.1 ships without periodic resync — if user reports
   "video runs ahead/behind at minute 4", v0.2 adds a 1 Hz reconciler.

4. **`crossOrigin = 'anonymous'`** on the thumbnail video element
   requires the R2 bucket to return `Access-Control-Allow-Origin` on
   GET (already configured for images). If not, `canvas.toDataURL`
   will throw with a SecurityError — caught and resolved to "no
   thumbnail", just a fallback icon.

5. **Memory**: a 5-minute 1080p H.264 video at ~6 Mbps is ~225 MB
   download + decoded buffer queue. Browser caps the decoded buffer
   at a few seconds typically. Three concurrent video clips on
   different tracks = ~3 GB peak in degenerate cases. Documented;
   v0.2 may add an in-engine LRU cap.

6. **Test mocks**: `MockVideoElement` doesn't simulate frame-accurate
   currentTime. Tests assert call sequence + arguments, not the
   pixel-level result. Real video decoding is browser-only.

---

## What this plan deliberately does not do

- **Video-Audio extraction** to a separate audio track (v0.2).
- **In-out trimming** of video clips (v0.2).
- **Speed control** for video clips (v0.2).
- **MOV format** (v0.2 if browser decoding catches up).
- **Render queue** with multiple concurrent exports (no change from
  Plan 6-R).
- **Server-side video encoding** (entirely browser-side).
- **Inspector params for video clips** — clip has none in v0.1, the
  Inspector pane is empty when a video clip is selected.
