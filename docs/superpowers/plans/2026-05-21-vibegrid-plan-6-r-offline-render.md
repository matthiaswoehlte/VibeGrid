# VibeGrid Plan 6-R — Offline Video Render Pipeline (WebCodecs)

> **Plan numbering note:** This plan was originally drafted as "Plan 7";
> renamed to **Plan 6-R** (Render Pipeline Rewrite) per Matthias's
> roadmap. Plan 7 stays reserved for Supabase Auth + Project Save.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project execution policy (overrides skill defaults):** direct-on-main, sequential, one commit per task. NO superpowers-subagent-ceremony — CC #1 implements straight, optional CC #2 review at the end.

---

## Context for the external reviewer

The post-Plan-6 + Flow-Mode-Hotfix baseline is **411 tests passing** at
commit `447691e`. Plan 6 shipped the realtime `MediaRecorder` +
`canvas.captureStream(30)` pipeline. The Flow-Mode Hotfix
(`44ab10d` → `447691e`) added a global Beat ↔ Flow toggle.

**Why Plan 6-R is needed**: live smoke testing exposed the structural
limit of the realtime export — when the renderer drops to 24 fps (e.g.
because multiple overlapping Contour clips saturate the canvas command
queue), the recorded WebM is recorded at exactly that frame rate. The
export is bounded by the slowest preview frame. The user described it
sharply: *"das ist mehr oder weniger Abfilmen vom Canvas. Warum machen
wir nicht so einen Ansatz, einen richtigen Video-Render Prozess."*

Industry standard for video editors (After Effects, Premiere, DaVinci):
**offline frame-by-frame render**. Each output frame is computed at a
deterministic time, encoded, and muxed — entirely decoupled from preview
performance. A frame that takes 200 ms of CPU does not produce a 5 fps
video; it just makes the render take a bit longer.

This plan introduces that pipeline using browser-native **WebCodecs API**
(`VideoEncoder` + `AudioEncoder`) plus **`mp4-muxer`** / **`webm-muxer`**
for container assembly. The realtime path stays alive as fallback for
browsers without WebCodecs (Firefox until ~v130, Safari < 16.4).

Notable state from Plan 6 + Hotfix that affects this plan:

1. **`ui.exportState`** is a patch-merged state machine
   (`lib/export/state-machine.ts`). Plan 6-R extends `ExportState` with
   `mode: 'realtime' | 'offline'` and progress fields; the realtime
   transitions stay identical.
2. **`AudioEngine.getAudioStream()`** (Plan 6) is for the realtime path.
   Plan 6-R adds a sibling `getDecodedBuffer()` returning the already-
   cached `AudioBuffer` (`engine.ts:45`) so the offline encoder doesn't
   re-decode.
3. **Renderer's `tick()` is already side-effect-controlled** via the
   `deps.getCurrentTime` closure (`loop.ts:94`). Plan 6-R adds a sibling
   `renderFrameAt(timeSec)` API that swaps that one input — no refactor
   of the plugin dispatch loop.
4. **`useRenderer` owns the ImageBitmap cache** (`useRenderer.ts:22`,
   `createImageBitmapCache()`). The offline orchestrator runs outside
   the hook — Plan 6-R exposes a `getBitmap()` method on the hook's
   return value so `useVideoExporter` can pass it through to the
   offline pipeline. No global state, no React Context.
5. **`fix-webm-duration`** (commit `7020a78`) is no longer needed in the
   offline path because the muxer writes the correct duration into the
   container header by construction. Keep it loaded for the realtime
   fallback.
6. **Particles is non-deterministic across runs** (uses `Math.random()`).
   This is an explicit v0.1 scope decision — two consecutive exports of
   the same project will produce slightly different particle positions,
   but the visual feel is identical and users never notice. Future
   plugins with stochasticity should follow the same convention.

---

**Goal**: From the running studio, the user clicks **Export** → the app
detects WebCodecs support, picks the offline path, and renders the
project frame-by-frame at **1920×1080 / 30 fps** with deterministic
output. The TopBar shows a progress bar with "Rendering frame X / Y
(N %)" and an ETA. When all frames are encoded the file downloads
automatically (`vibegrid_export_<ISO>.mp4` for the MP4 codec path,
`.webm` for the VP9 fallback). The user can cancel at any time;
cancel aborts the encoder, drops partial output, returns to idle.

On browsers without WebCodecs (Firefox stable < v130 at time of
writing — recheck before merge) the existing realtime MediaRecorder
path runs unchanged, with the same UI but a one-shot toast
("Realtime record — WebCodecs not available").

**Architecture**: five surfaces.

1. **Audio encoding layer** (`lib/export/audio-chunks.ts`,
   `AudioEngine.getDecodedBuffer`). A pure function chunks the decoded
   `AudioBuffer` into fixed-size frame windows (1024 frames per chunk
   at the buffer's native sample rate) and yields
   `{ timestampUs, channels: Float32Array[] }`. Zero React, zero DOM.
2. **WebCodecs config** (`lib/export/webcodecs.ts`). `isWebCodecsSupported()`
   feature-flag; `pickVideoEncoderConfig(w, h, fps)` walks a
   preference list (`avc1.42E01E` → `vp09.00.10.08`) against
   `VideoEncoder.isConfigSupported`; `pickAudioEncoderConfig(sr, ch)`
   does the same for `mp4a.40.2` → `opus`. Returns `null` when no
   compatible codec is found. Default bitrates: **8 Mbit/s video**
   (up from 6 Mbit/s in the realtime path — offline rendering removes
   the realtime constraint, so we spend a bit more on quality),
   128 kbit/s audio.
3. **Offline renderer** (`lib/renderer/offline-tick.ts`,
   `lib/hooks/useRenderer.ts` extension). Pure helper
   `makeOfflineRenderer({timeSec, canvas, ...deps})` invokes the
   existing `tick()` machinery on an explicit time. Shares plugin
   dispatch, `computeClipAlpha`, `resolveClipParams`, and `flowMode`
   handling with the live renderer — no plugin code changes.
   `useRenderer` is extended to return `{ getBitmap }` so the offline
   pipeline can borrow the same ImageBitmap cache instead of
   reloading bitmaps from R2.
4. **Pipeline orchestrator** (`lib/export/offline-render.ts`).
   `renderOffline({timeline, audio, beatGrid, getImageBitmap, options}):
   Promise<Blob>`. Sets up an `OffscreenCanvas(1920, 1080)` (or the
   configured target size), the `VideoEncoder`, the `AudioEncoder`,
   and the muxer. Runs the frame loop (synchronous render →
   `new VideoFrame(canvas, {timestamp})` → `encoder.encode()` →
   `videoFrame.close()`), then walks the audio buffer chunk-by-chunk
   into the `AudioEncoder`. Awaits `encoder.flush()` for both,
   finalizes the muxer, returns a Blob. Reports progress via callback;
   respects an `AbortSignal`. Encoder errors are captured into a
   shared flag (NOT `throw` inside the callback — that would land in
   an unrelated microtask and produce an unhandled rejection) and
   re-thrown synchronously at the next backpressure check.
5. **UI extension**. `ExportState` gains `mode`, `currentFrame`,
   `totalFrames`, `etaSeconds`. `RecIndicator` renders one of two
   layouts depending on `mode`: realtime keeps the existing red-dot +
   `MM:SS / MM:SS`; offline shows a teal progress bar with
   `Rendering 1234 / 5400 (23 %) · ETA 0:47`. Cancel button is shared.
   `ExportButton` checks `isWebCodecsSupported()`; on click, dispatches
   to either `renderOffline` or the existing `VideoExporter`.

**Tech Stack**: existing — Web Audio API (already wired, decoded buffer
already cached). Canvas 2D, OffscreenCanvas. **New deps**: `mp4-muxer`
(~10 KB gz, MIT, no runtime deps), `webm-muxer` (~10 KB gz, MIT, no
runtime deps). Both maintained by the same author (Vanilagy), same API
shape. No polyfills — feature-detect and fall back to MediaRecorder.

**Spec reference**: `docs/superpowers/specs/2026-05-19-vibegrid-design.md` §8
(Export Pipeline). This plan implements the v0.2 line "MP4 / WebCodecs
export" listed in Spec §8.4 — formerly "out of scope for v0.1."

**Verification gate (must pass before declaring Plan 6-R done):**

```
npm test -- audio/engine-decoded      # ≥ 2
npm test -- export/audio-chunks       # ≥ 4
npm test -- export/webcodecs          # ≥ 5
npm test -- export/muxer              # ≥ 3
npm test -- export/offline-render     # ≥ 6
npm test -- renderer/offline-tick     # ≥ 3
npm test -- hooks/useRenderer-getBitmap # ≥ 2
npm test -- store/export-state        # existing + 3 (mode, currentFrame, etaSeconds)
npm test -- components/TopBar         # existing + 3 RecIndicator offline-mode
npm test                              # full suite ≥ 439 (411 → +28)
npm run typecheck
npm run lint
npm run build                         # studio bundle within +15 % of 137 kB baseline
                                      # (muxers are heavy — explicit budget bump)
```

**Smoke gate (manual, before declaring Plan 6-R done):**

```
npm run dev
# - Upload image + 2-minute audio. Place image clip covering audio length.
# - Add a Pulse, ZoomPulse, and Particles clip. Beat detect → 120 BPM.
# - Click Export. Toast appears: "Offline render via WebCodecs".
# - RecIndicator shows "Rendering 0 / 3600 (0 %) · ETA …".
# - Progress climbs steadily (not necessarily monotone fast — ETA may
#   fluctuate in the first few seconds).
# - File downloads as vibegrid_export_<ISO>.mp4 (or .webm fallback).
# - Open in VLC + Chrome: plays cleanly. Audio + video are perfectly
#   synchronized for the entire duration (no drift at minute 2).
# - Open the same file twice in a hex dump → first 1 KB is identical
#   (deterministic muxer output for the same input).
# - Repeat with the FPS-killing project from the Hotfix smoke (4 overlapping
#   Contour clips). The realtime preview ruckers at 24 fps, but the
#   offline-rendered video is buttery-smooth 30 fps end-to-end.
# - Toggle Flow Mode on, re-export → no Pulse flashes, no ZoomPulse
#   punch, no Particle bursts in the output (continuous interpolation
#   carries the motion).
# - Cancel mid-render → progress bar disappears, no partial file written,
#   "Export cancelled" toast.
# - Open Firefox (or any browser without WebCodecs) → toast says
#   "Realtime record — WebCodecs not available", existing MediaRecorder
#   pipeline runs unchanged with the Plan-6 UX.
```

**Dependencies on prior plans:** Plan 2 (AudioEngine with cached
`AudioBuffer`). Plan 3 (renderer with `tick()`, plugin dispatch loop).
Plan 5.7-R (UI literal strict-TS, store patterns). Plan 6 (export state
machine, codec preference, filename helper, RecIndicator shape).
Hotfix Flow Mode (rc.flowMode, deterministic-curve Beat/Flow path).

**Out of scope (deferred to v0.2.x or later):**

- Higher resolutions (4K, 2K) — extension of the resolution picker,
  but the pipeline supports it; v0.1 ships 1080p only.
- Variable frame rates (24, 60 fps) — single fixed 30 fps for v0.1.
- HDR / wide-gamut output — sRGB only.
- Render queue (multiple exports in a row) — single render at a time.
- Server-side render — entirely browser-side for v0.1.
- iOS Safari (WebCodecs Audio only landed in 17.4) — works if available,
  falls back to MediaRecorder if not.
- Per-clip mute during export — what's on the timeline goes to the file.
- Background-tab continuation — RAF still throttles, same as realtime.
  The progress bar pauses but does not error.

---

## Architecture insights

These are the points where Plan 6-R leans on or extends Plan-6 / Hotfix
shape — they're called out so the reviewer can sanity-check the
fit without reading the whole code base.

### 1. The renderer doesn't need a refactor — it needs a sibling

`createRenderer()` already builds a closure around `deps.getCurrentTime`.
The live path passes `() => engine.getState().currentTime`. The offline
path passes `() => fixedTimeSec` — bound per frame. The plugin dispatch,
`activeImageClips`, `activeFxClipsByKind`, `computeClipAlpha`, and
`resolveClipParams` all work identically because they only read what
the renderer's tick computed for them. The diff is one new file
(`offline-tick.ts`) that constructs deps inline per frame and calls
`renderer.tick()`.

This avoids the temptation to refactor `tick()` into "pull current time
inline" — that would force every test fixture to change.

### 2. Why a separate OffscreenCanvas

The live Stage canvas is DPR-scaled by `attachDprObserver`
(`useRenderer.ts:82-86`). At DPR=2 with a CSS 1280×720 layout the
physical buffer is 2560×1440 — bigger than 1080p, in fact. But the
plugin math is anchored to `rc.width × rc.height` from the canvas's
physical buffer, so painting a 1920×1080 frame is just a matter of
giving the renderer a 1920×1080 canvas with no DPR transform applied
to its `2d` context. We allocate a fresh `OffscreenCanvas(1920, 1080)`
for the offline render and tear it down at the end. Zero interaction
with the on-screen canvas (which keeps running the live preview if
the user wants — though the offline render will saturate the main
thread enough that the preview won't be smooth either; that's fine,
it's not what gets recorded).

### 3. Sharing the ImageBitmap cache with the offline path

`useRenderer` owns the bitmap cache (`createImageBitmapCache()`,
`useRenderer.ts:22`). The cache is kept as a `useRef` and used by
the live renderer's `getImageBitmap` callback. The offline orchestrator
runs outside React's tree — it can't read that ref directly.

The fix is a small one: `useRenderer` now returns a `{ getBitmap }`
object whose `getBitmap(mediaId)` delegates to the same cache
instance. `useVideoExporter` captures it from the renderer hook (which
shares the canvas-ref owner — `app/(studio)/page.tsx`), and reaches
through that getter into `renderOffline`:

```ts
// useRenderer.ts (extended return type):
export function useRenderer(opts: UseRendererOptions): {
  getBitmap: (mediaId: string) => ImageBitmap | undefined;
}
// useVideoExporter.ts (consumer):
const { getBitmap } = useRenderer({ canvasRef, getCurrentTime, … });
// passed into the offline renderer:
renderOffline({ ..., getImageBitmap: getBitmap }, options);
```

Two lines on each end. No global singleton, no React Context, no
cache duplication. The live preview and the offline render share
exactly the same bitmap instances.

### 4. Audio encoding boundary

The decoded `AudioBuffer` is already in memory (`engine.ts:45`,
`cachedDecodedBuffer`). For a 3-minute song at 48 kHz / 2 ch that's
~70 MB of `Float32Array` — fine, we'll only ever hold one at a time.

The chunking helper walks the buffer's `getChannelData(i)` arrays and
emits 1024-frame windows (≈ 21 ms at 48 kHz — matches the typical
AAC frame size). Each chunk gets a microsecond timestamp computed
from the running frame index:

```ts
const FRAMES_PER_CHUNK = 1024;
for (let chunkIdx = 0; chunkIdx * FRAMES_PER_CHUNK < totalFrames; chunkIdx++) {
  const frameOffset = chunkIdx * FRAMES_PER_CHUNK;
  const frames = Math.min(FRAMES_PER_CHUNK, totalFrames - frameOffset);
  const timestampUs = Math.round((frameOffset / sampleRate) * 1_000_000);
  const channels = Array.from({length: numberOfChannels}, (_, ch) =>
    buffer.getChannelData(ch).subarray(frameOffset, frameOffset + frames)
  );
  yield { timestampUs, channels, frameCount: frames };
}
```

Pure function. Easy to test. The pipeline orchestrator wraps each
chunk into an `AudioData` and submits it.

### 5. Why two muxers (mp4-muxer + webm-muxer)

`mp4-muxer` only produces MP4 (avc1 + mp4a). `webm-muxer` only produces
WebM (vp9 + opus). Single-purpose libs, ~10 KB each. We pick one based
on which codec config came back from `pickVideoEncoderConfig` — they
share a near-identical surface, so a 30-LOC wrapper unifies them
behind:

```ts
interface OfflineMuxer {
  readonly ext: 'mp4' | 'webm';
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
  finalize(): Uint8Array;
}
```

The orchestrator depends only on this interface — switching muxers is
one factory call.

### 6. Backpressure

`VideoEncoder.encode()` is fire-and-forget; the encoder buffers
internally. On a fast machine we can push frames faster than the
encoder writes them — RAM grows. The Web spec guidance is to await
`encoder.flush()` periodically, but flush() is expensive. The simpler
guard:

```ts
while (encoder.encodeQueueSize > 4) {
  await new Promise<void>((r) => setTimeout(r, 0));
}
```

Yields the event loop until the encoder catches up. We do this before
every `encoder.encode()`. Same pattern for `AudioEncoder`.

### 7. The realtime path stays

`lib/export/recorder.ts` (Plan 6) is **untouched** structurally. The
`ExportButton` decides which path to call:

```ts
if (isWebCodecsSupported()) {
  await offlineRenderer.start();
} else {
  await exporter.start(); // existing realtime path
}
```

If WebCodecs is detected but `pickVideoEncoderConfig` returns null
(unusual — feature flag without a supported codec), fall back to
MediaRecorder too. One toast either way explains which path ran.

---

## File map

| File | Responsibility |
|---|---|
| `lib/audio/engine.ts` (modify) | New public getter `getDecodedBuffer(): AudioBuffer \| null`; reads existing private `cachedDecodedBuffer` |
| `tests/unit/audio/engine-decoded.test.ts` (create) | ≥ 2 tests: getter returns null before load, returns the cached buffer after a successful load |
| `lib/export/audio-chunks.ts` (create) | Pure `chunkAudioBuffer(buffer, framesPerChunk): Generator<{timestampUs, channels, frameCount}>`; constants `FRAMES_PER_CHUNK = 1024` |
| `tests/unit/export/audio-chunks.test.ts` (create) | ≥ 4 tests: yields expected chunk count for known buffer length; timestamps are monotone increasing; last chunk's frameCount handles non-multiples; mono + stereo both work |
| `lib/export/webcodecs.ts` (create) | `isWebCodecsSupported()`, `pickVideoEncoderConfig(width, height, fps)`, `pickAudioEncoderConfig(sampleRate, channels)`. Both pick functions return `{codec, ext}` or `null` |
| `tests/unit/export/webcodecs.test.ts` (create) | ≥ 5 tests: supported when both encoders exist, MP4 preferred, WebM fallback, audio MP4A preferred, returns null when nothing supported |
| `lib/hooks/useRenderer.ts` (modify) | Return `{ getBitmap: (id) => ImageBitmap \| undefined }` so the offline pipeline can borrow the same ImageBitmap cache via `useVideoExporter` |
| `tests/unit/hooks/useRenderer-getBitmap.test.tsx` (create) | ≥ 2 tests: hook returns getBitmap; calling getBitmap on an unmounted hook returns undefined safely |
| `lib/renderer/offline-tick.ts` (create) | `makeOfflineRenderer({canvas, timeSec, getBeatGrid, getTimelineState, getImageBitmap, getFlowMode}): {renderAt}` — constructs renderer deps inline and runs one tick per call; reuses one createRenderer across all frames in the orchestrator loop |
| `tests/unit/renderer/offline-tick.test.ts` (create) | ≥ 3 tests: identical timeSec → identical canvas calls; different timeSec → different calls; flow mode is propagated to plugins |
| `lib/export/muxer.ts` (create) | `createOfflineMuxer({video, audio, ext, width, height, fps, sampleRate, channels}): OfflineMuxer` factory; internally constructs `Mp4Muxer` or `WebmMuxer` depending on `ext`, exposes unified surface |
| `tests/unit/export/muxer.test.ts` (create) | ≥ 3 tests: factory picks mp4-muxer for `ext='mp4'`, webm-muxer for `ext='webm'`, finalize returns non-empty bytes (with stubbed chunks) |
| `lib/export/offline-render.ts` (create) | `renderOffline(deps, options, signal): Promise<{blob: Blob, ext: 'mp4' \| 'webm'}>`. Sets up OffscreenCanvas, encoders, muxer; runs frame loop + audio loop + finalize + progress reports |
| `tests/unit/export/offline-render.test.ts` (create) | ≥ 6 tests: total frame count = ceil(duration × fps); progress callback fires monotonically; cancel mid-render aborts encoder and resolves rejected; encoder errors propagate; correct ext returned per chosen codec; audio + video timestamps line up at frame boundaries |
| `lib/export/types.ts` (modify) | Extend `ExportState` with `mode: 'realtime' \| 'offline'`, `currentFrame?: number`, `totalFrames?: number`, `etaSeconds?: number`; new field added to all `EXPORT_INITIAL_STATE` etc. |
| `lib/export/state-machine.ts` (modify) | `reduceExportState` patch-merges the new fields; idle-reset clears them |
| `tests/unit/store/export-state.test.ts` (modify) | Add ≥ 3 tests: mode default, currentFrame patch, idle-reset clears progress |
| `lib/hooks/useVideoExporter.ts` (modify) | Branch: if `isWebCodecsSupported()`, build `offlineExporter.start()` instead of the existing realtime one; share the cancel/state-machine path |
| `components/TopBar/RecIndicator.tsx` (modify) | When `mode === 'offline'`: render progress bar + "Rendering X / Y (Z %) · ETA M:SS" + Cancel. Existing realtime layout untouched |
| `tests/unit/components/TopBar/RecIndicator.test.tsx` (modify) | Add 3 tests: offline-mode renders progress bar, percentage matches currentFrame/totalFrames, ETA renders correctly |
| `package.json` + `package-lock.json` | Add `"mp4-muxer": "^5.x"`, `"webm-muxer": "^5.x"` |
| `KNOWN_LIMITATIONS.md` (modify) | Update Export Pipeline section: offline render is primary path on WebCodecs browsers, realtime is fallback. Note 1080p/30fps fixed for v0.1 |

---

## Tasks

### Task 1: AudioEngine.getDecodedBuffer

**Files:**
- Modify: `lib/audio/engine.ts`
- Test: `tests/unit/audio/engine-decoded.test.ts`

- [ ] **Step 1 — Write the failing test** (re-use the existing
  `patchAudio` + `patchFetchAndDecode` pattern from `engine.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest';
import { createAudioEngine } from '@/lib/audio/engine';

describe('AudioEngine.getDecodedBuffer', () => {
  it('returns null before load()', () => {
    const engine = createAudioEngine();
    expect(engine.getDecodedBuffer()).toBeNull();
    engine.destroy();
  });

  it('returns the AudioBuffer after a successful load', async () => {
    // Patch fetch + decodeAudioData (see existing engine tests for pattern)
    // Load a fake file, assert getDecodedBuffer() !== null and has duration.
  });
});
```

- [ ] **Step 2 — Verify fail**

- [ ] **Step 3 — Implement**

```ts
// Inside the AudioEngine returned object:
getDecodedBuffer(): AudioBuffer | null {
  return cachedDecodedBuffer;
},
```

Plus the type addition in the `AudioEngine` interface:

```ts
getDecodedBuffer(): AudioBuffer | null;
```

- [ ] **Step 4 — Verify pass**

- [ ] **Step 5 — Commit**

```bash
git add lib/audio/engine.ts tests/unit/audio/engine-decoded.test.ts
git commit -m "feat(audio): expose cached decoded AudioBuffer via getter"
```

---

### Task 2: audio-chunks helper

**Files:**
- Create: `lib/export/audio-chunks.ts`
- Test: `tests/unit/export/audio-chunks.test.ts`

- [ ] **Step 1 — Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { chunkAudioBuffer, FRAMES_PER_CHUNK } from '@/lib/export/audio-chunks';

function makeBuffer(sampleRate: number, channels: number, frames: number): AudioBuffer {
  // Build an object with the AudioBuffer shape — vitest.setup stubs are fine.
  // The function only reads sampleRate, length, numberOfChannels, getChannelData.
  const data = Array.from({length: channels}, () => new Float32Array(frames).fill(0.5));
  return {
    sampleRate, length: frames, numberOfChannels: channels,
    getChannelData: (i: number) => data[i]
  } as unknown as AudioBuffer;
}

describe('chunkAudioBuffer', () => {
  it('emits ceil(length/FRAMES_PER_CHUNK) chunks', () => {
    const buf = makeBuffer(48000, 2, FRAMES_PER_CHUNK * 3 + 100);
    const chunks = [...chunkAudioBuffer(buf)];
    expect(chunks.length).toBe(4);
  });

  it('timestamps are monotone, start at 0, spaced by FRAMES_PER_CHUNK / sampleRate', () => { /* … */ });
  it('last chunk frameCount equals remainder', () => { /* … */ });
  it('mono and stereo both work', () => { /* … */ });
});
```

- [ ] **Step 2-4 — Implement, run, verify**

```ts
// lib/export/audio-chunks.ts
export const FRAMES_PER_CHUNK = 1024;

export function* chunkAudioBuffer(buffer: AudioBuffer): Generator<{
  timestampUs: number;
  channels: Float32Array[];
  frameCount: number;
}> {
  const totalFrames = buffer.length;
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const channelData = Array.from({length: numChannels}, (_, i) => buffer.getChannelData(i));

  for (let frameOffset = 0; frameOffset < totalFrames; frameOffset += FRAMES_PER_CHUNK) {
    const frameCount = Math.min(FRAMES_PER_CHUNK, totalFrames - frameOffset);
    const timestampUs = Math.round((frameOffset / sampleRate) * 1_000_000);
    const channels = channelData.map((ch) =>
      ch.subarray(frameOffset, frameOffset + frameCount)
    );
    yield { timestampUs, channels, frameCount };
  }
}
```

- [ ] **Step 5 — Commit**

```bash
git add lib/export/audio-chunks.ts tests/unit/export/audio-chunks.test.ts
git commit -m "feat(export): pure chunkAudioBuffer generator for AudioEncoder feed"
```

---

### Task 3: WebCodecs feature detection + codec config

**Files:**
- Create: `lib/export/webcodecs.ts`
- Test: `tests/unit/export/webcodecs.test.ts`

- [ ] **Step 1 — Write failing tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { isWebCodecsSupported, pickVideoEncoderConfig, pickAudioEncoderConfig } from '@/lib/export/webcodecs';

describe('isWebCodecsSupported', () => {
  it('true when both VideoEncoder and AudioEncoder exist on window', () => {
    (globalThis as Record<string, unknown>).VideoEncoder = class {};
    (globalThis as Record<string, unknown>).AudioEncoder = class {};
    expect(isWebCodecsSupported()).toBe(true);
  });
  it('false when either is missing', () => { /* … */ });
});

describe('pickVideoEncoderConfig', () => {
  it('prefers H.264 (avc1.42E01E) when supported', async () => {
    // Mock VideoEncoder.isConfigSupported to accept avc1 first.
  });
  it('falls back to VP9 when MP4 unsupported', async () => { /* … */ });
  it('returns null when no codec is supported', async () => { /* … */ });
});

describe('pickAudioEncoderConfig', () => {
  it('prefers AAC (mp4a.40.2) when supported, falls back to Opus', async () => { /* … */ });
});
```

- [ ] **Step 2-4 — Implement**

```ts
// lib/export/webcodecs.ts

export interface VideoCodecPick {
  config: VideoEncoderConfig;
  ext: 'mp4' | 'webm';
  label: string;
}

export interface AudioCodecPick {
  config: AudioEncoderConfig;
  codec: 'mp4a.40.2' | 'opus';
  label: string;
}

export function isWebCodecsSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';
}

const VIDEO_PREFS: Array<{codec: string; ext: 'mp4' | 'webm'; label: string}> = [
  // H.264 baseline profile level 4.0 — accepts up to 1080p / 30fps. Widest compat.
  { codec: 'avc1.42E01E', ext: 'mp4', label: 'MP4 (H.264 Baseline + AAC)' },
  // VP9 profile 0, level 4.0 — Firefox + WebM fallback.
  { codec: 'vp09.00.10.08', ext: 'webm', label: 'WebM (VP9 + Opus)' },
];

const AUDIO_PREFS: Array<{codec: 'mp4a.40.2' | 'opus'; label: string}> = [
  { codec: 'mp4a.40.2', label: 'AAC LC' },
  { codec: 'opus', label: 'Opus' },
];

export async function pickVideoEncoderConfig(
  width: number,
  height: number,
  fps: number
): Promise<VideoCodecPick | null> {
  if (!isWebCodecsSupported()) return null;
  for (const pref of VIDEO_PREFS) {
    const config: VideoEncoderConfig = {
      codec: pref.codec,
      width, height,
      framerate: fps,
      bitrate: 8_000_000,
      bitrateMode: 'variable',
    };
    try {
      const res = await VideoEncoder.isConfigSupported(config);
      if (res.supported) return { config: res.config ?? config, ext: pref.ext, label: pref.label };
    } catch { /* continue */ }
  }
  return null;
}

export async function pickAudioEncoderConfig(
  sampleRate: number,
  channels: number
): Promise<AudioCodecPick | null> {
  if (!isWebCodecsSupported()) return null;
  for (const pref of AUDIO_PREFS) {
    const config: AudioEncoderConfig = {
      codec: pref.codec,
      sampleRate,
      numberOfChannels: channels,
      bitrate: 128_000,
    };
    try {
      const res = await AudioEncoder.isConfigSupported(config);
      if (res.supported) return { config: res.config ?? config, codec: pref.codec, label: pref.label };
    } catch { /* continue */ }
  }
  return null;
}
```

- [ ] **Step 5 — Commit**

```bash
git add lib/export/webcodecs.ts tests/unit/export/webcodecs.test.ts
git commit -m "feat(export): WebCodecs feature detect + video/audio codec picker"
```

---

### Task 4: useRenderer exposes getBitmap

**Files:**
- Modify: `lib/hooks/useRenderer.ts`
- Test: `tests/unit/hooks/useRenderer-getBitmap.test.tsx`

The offline renderer needs the same `ImageBitmap` cache that drives
the live preview. Today, `useRenderer` keeps the cache in a `useRef`
that nothing outside the hook can reach. Architect resolution: extend
the hook's return type so the cache is reachable via a stable getter.

- [ ] **Step 1 — Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRenderer } from '@/lib/hooks/useRenderer';

describe('useRenderer().getBitmap', () => {
  it('returns undefined for an unknown mediaId', () => {
    const canvasRef = { current: document.createElement('canvas') };
    const { result } = renderHook(() => useRenderer({
      canvasRef, getCurrentTime: () => 0,
    }));
    expect(result.current.getBitmap('nonexistent')).toBeUndefined();
  });

  it('returns the cached bitmap after the cache populates', () => {
    // Mock the cache via mediaRefs subscription pattern (see useRenderer.ts:51).
    // Verify getBitmap returns a non-undefined ImageBitmap once the load
    // has completed.
  });
});
```

- [ ] **Step 2 — Run, verify fail**

- [ ] **Step 3 — Implement**

Change `useRenderer` to return its bitmap getter. The cache instance
lives in `cacheRef` already; we just add an exposed accessor:

```ts
// lib/hooks/useRenderer.ts
export interface UseRendererReturn {
  /** Returns the cached ImageBitmap for `mediaId`, or undefined if not
   *  loaded yet. Safe to call from any descendant component / hook —
   *  the cache is the same instance that drives the live preview. */
  getBitmap(mediaId: string): ImageBitmap | undefined;
}

export function useRenderer(opts: UseRendererOptions): UseRendererReturn {
  // ... existing setup ...
  return {
    getBitmap: (mediaId) => cacheRef.current.get(mediaId),
  };
}
```

Then update the one caller (`components/Workspace/Stage/CanvasView.tsx`)
to ignore the new return value if it doesn't need it. Plan 6-R Task 9
wires `useVideoExporter` to actually consume the getter.

- [ ] **Step 4 — Verify pass**

```
npx vitest run tests/unit/hooks/useRenderer-getBitmap.test.tsx
npx vitest run tests/unit/components/Workspace  # CanvasView still works
```

- [ ] **Step 5 — Commit**

```bash
git add lib/hooks/useRenderer.ts tests/unit/hooks/useRenderer-getBitmap.test.tsx
git commit -m "feat(renderer): useRenderer returns getBitmap accessor for offline pipeline"
```

---

### Task 5: Offline-tick renderer wrapper

**Files:**
- Create: `lib/renderer/offline-tick.ts`
- Test: `tests/unit/renderer/offline-tick.test.ts`

- [ ] **Step 1 — Write failing tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderFrameAt } from '@/lib/renderer/offline-tick';
import { makeMockCtx, grid120 } from './_helpers';
// … tests for: same timeSec → identical __calls; different timeSec → different;
// flowMode propagates; works on a fresh OffscreenCanvas …
```

- [ ] **Step 2-4 — Implement**

```ts
// lib/renderer/offline-tick.ts
import { createRenderer, type RendererDeps } from './loop';
import type { TimelineState } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';

export interface OfflineRenderDeps {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  beatGrid: BeatGrid;
  timeline: TimelineState;
  getImageBitmap: (mediaId: string) => ImageBitmap | undefined;
  flowMode: boolean;
}

/**
 * One-shot renderer: builds a synchronous tick() at exactly `timeSec`.
 * Cheap to call repeatedly — the underlying createRenderer call is
 * amortized by the caller (Plan-7 offline-render.ts builds it once and
 * reuses across all frames in the loop).
 */
export function makeOfflineRenderer(deps: OfflineRenderDeps) {
  let currentTime = 0;
  const renderer = createRenderer({
    canvas: deps.canvas as HTMLCanvasElement,
    getCurrentTime: () => currentTime,
    getBeatGrid: () => deps.beatGrid,
    getTimelineState: () => deps.timeline,
    getImageBitmap: deps.getImageBitmap,
    getFlowMode: () => deps.flowMode,
  });
  return {
    renderAt(timeSec: number): void {
      currentTime = timeSec;
      renderer.tick();
    },
  };
}
```

- [ ] **Step 5 — Commit**

```bash
git add lib/renderer/offline-tick.ts tests/unit/renderer/offline-tick.test.ts
git commit -m "feat(renderer): makeOfflineRenderer wraps tick() with explicit time source"
```

---

### Task 6: Install + wrap muxers

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `lib/export/muxer.ts`
- Test: `tests/unit/export/muxer.test.ts`

- [ ] **Step 1 — Install**

```
npm install mp4-muxer webm-muxer
```

Verify they're in `package.json` dependencies.

- [ ] **Step 2 — Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { createOfflineMuxer } from '@/lib/export/muxer';

describe('createOfflineMuxer', () => {
  it('returns ext=mp4 when codec is avc1', () => { /* … */ });
  it('returns ext=webm when codec is vp9', () => { /* … */ });
  it('finalize returns a non-empty Uint8Array after stub chunks added', () => { /* … */ });
});
```

- [ ] **Step 3 — Implement**

```ts
// lib/export/muxer.ts
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';

export interface OfflineMuxer {
  readonly ext: 'mp4' | 'webm';
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
  finalize(): Uint8Array;
}

export interface MuxerInit {
  ext: 'mp4' | 'webm';
  videoCodec: string;       // e.g. 'avc1.42E01E', 'vp09.00.10.08'
  audioCodec: 'mp4a.40.2' | 'opus';
  width: number;
  height: number;
  fps: number;
  sampleRate: number;
  channels: number;
}

export function createOfflineMuxer(init: MuxerInit): OfflineMuxer {
  if (init.ext === 'mp4') {
    const target = new Mp4Target();
    const muxer = new Mp4Muxer({
      target,
      video: { codec: 'avc', width: init.width, height: init.height },
      audio: { codec: 'aac', numberOfChannels: init.channels, sampleRate: init.sampleRate },
      fastStart: 'in-memory',
    });
    return {
      ext: 'mp4',
      addVideoChunk: (c, m) => muxer.addVideoChunk(c, m),
      addAudioChunk: (c, m) => muxer.addAudioChunk(c, m),
      finalize: () => { muxer.finalize(); return new Uint8Array(target.buffer); },
    };
  }
  // webm path
  const target = new WebmTarget();
  const muxer = new WebmMuxer({
    target,
    video: { codec: 'V_VP9', width: init.width, height: init.height },
    audio: { codec: 'A_OPUS', numberOfChannels: init.channels, sampleRate: init.sampleRate },
  });
  return {
    ext: 'webm',
    addVideoChunk: (c, m) => muxer.addVideoChunk(c, m),
    addAudioChunk: (c, m) => muxer.addAudioChunk(c, m),
    finalize: () => { muxer.finalize(); return new Uint8Array(target.buffer); },
  };
}
```

- [ ] **Step 4-5 — Verify + commit**

```bash
git add package.json package-lock.json lib/export/muxer.ts tests/unit/export/muxer.test.ts
git commit -m "feat(export): install mp4-muxer + webm-muxer, unify behind OfflineMuxer factory"
```

---

### Task 7: ExportState extension (mode + progress fields)

**Files:**
- Modify: `lib/export/types.ts`
- Modify: `lib/export/state-machine.ts`
- Modify: `tests/unit/store/export-state.test.ts`

- [ ] **Step 1 — Extend the type**

```ts
// lib/export/types.ts
export type ExportStatus = 'idle' | 'preparing' | 'recording' | 'finalizing' | 'done' | 'error';

export interface ExportState {
  status: ExportStatus;
  /** Realtime = MediaRecorder, Offline = WebCodecs. */
  mode: 'realtime' | 'offline';
  progress: number;
  elapsedSeconds: number;
  totalSeconds: number;
  /** Offline only — current frame index in the render loop. */
  currentFrame?: number;
  /** Offline only — total output frame count = ceil(duration × fps). */
  totalFrames?: number;
  /** Offline only — estimated seconds until completion (rolling avg). */
  etaSeconds?: number;
  warning?: string;
  errorCode?: string;
  codecLabel?: string;
}
```

- [ ] **Step 2 — `EXPORT_INITIAL_STATE`**

```ts
export const EXPORT_INITIAL_STATE: ExportState = {
  status: 'idle',
  mode: 'realtime',
  progress: 0,
  elapsedSeconds: 0,
  totalSeconds: 0,
};
```

- [ ] **Step 3 — `reduceExportState` patches the new fields** (no
  structural change; the existing patch-merge already covers them).
  Idle-reset clears `currentFrame`, `totalFrames`, `etaSeconds`.

- [ ] **Step 4 — Update store test** (extend existing test file)

- [ ] **Step 5 — Commit**

```bash
git add lib/export/types.ts lib/export/state-machine.ts tests/unit/store/export-state.test.ts
git commit -m "feat(store): export state gains mode + offline progress fields"
```

---

### Task 8: Offline render orchestrator

**Files:**
- Create: `lib/export/offline-render.ts`
- Test: `tests/unit/export/offline-render.test.ts`

- [ ] **Step 1 — Write failing tests**

Tests cover: total frame count, monotone progress, cancel mid-render,
encoder-error propagation (architect Bug 1 — fire the VideoEncoder
error callback mid-loop with a stubbed error and assert that
`renderOffline` rejects with that exact error), ext returned per
codec, audio + video timestamp alignment.

- [ ] **Step 2 — Implement**

Sketch (~150 LOC including comments):

```ts
// lib/export/offline-render.ts

import { makeOfflineRenderer } from '@/lib/renderer/offline-tick';
import { pickVideoEncoderConfig, pickAudioEncoderConfig } from './webcodecs';
import { chunkAudioBuffer, FRAMES_PER_CHUNK } from './audio-chunks';
import { createOfflineMuxer } from './muxer';
import type { TimelineState } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';

export interface OfflineRenderOptions {
  width?: number;
  height?: number;
  fps?: number;
  onProgress?: (p: {currentFrame: number; totalFrames: number; etaSeconds: number}) => void;
  signal?: AbortSignal;
}

export interface OfflineRenderDeps {
  timeline: TimelineState;
  beatGrid: BeatGrid;
  audioBuffer: AudioBuffer;
  getImageBitmap: (mediaId: string) => ImageBitmap | undefined;
  flowMode: boolean;
}

export interface OfflineRenderResult {
  blob: Blob;
  ext: 'mp4' | 'webm';
  codecLabel: string;
}

const DEFAULTS = { width: 1920, height: 1080, fps: 30 } as const;

export async function renderOffline(
  deps: OfflineRenderDeps,
  options: OfflineRenderOptions = {}
): Promise<OfflineRenderResult> {
  const width = options.width ?? DEFAULTS.width;
  const height = options.height ?? DEFAULTS.height;
  const fps = options.fps ?? DEFAULTS.fps;
  const durationSec = deps.audioBuffer.duration;
  const totalFrames = Math.ceil(durationSec * fps);

  // 1. Pick codecs
  const videoPick = await pickVideoEncoderConfig(width, height, fps);
  if (!videoPick) throw new Error('No supported video codec');
  const audioPick = await pickAudioEncoderConfig(deps.audioBuffer.sampleRate, deps.audioBuffer.numberOfChannels);
  if (!audioPick) throw new Error('No supported audio codec');

  // 2. Build the offscreen canvas + renderer
  const canvas = new OffscreenCanvas(width, height);
  const offlineRenderer = makeOfflineRenderer({
    canvas,
    beatGrid: deps.beatGrid,
    timeline: deps.timeline,
    getImageBitmap: deps.getImageBitmap,
    flowMode: deps.flowMode,
  });

  // 3. Build the muxer
  const muxer = createOfflineMuxer({
    ext: videoPick.ext,
    videoCodec: videoPick.config.codec,
    audioCodec: audioPick.codec,
    width, height, fps,
    sampleRate: deps.audioBuffer.sampleRate,
    channels: deps.audioBuffer.numberOfChannels,
  });

  // 4. Build the encoders. Architect-flagged bug fix: `throw` inside an
  //    encoder error callback lands in a separate microtask and turns
  //    into an unhandled rejection — the orchestrator never sees it,
  //    the UI never updates. Capture into a shared flag instead, then
  //    re-throw synchronously at the next backpressure / loop checkpoint
  //    so it propagates to renderOffline's caller.
  let videoError: Error | null = null;
  let audioError: Error | null = null;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { videoError = e; },
  });
  videoEncoder.configure(videoPick.config);

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => { audioError = e; },
  });
  audioEncoder.configure(audioPick.config);

  // 5. Render frames + encode video
  const startTime = performance.now();
  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (videoError) throw videoError;
    const timeSec = frameIdx / fps;
    offlineRenderer.renderAt(timeSec);
    while (videoEncoder.encodeQueueSize > 4) {
      await new Promise<void>((r) => setTimeout(r, 0));
      if (videoError) throw videoError;
    }
    const videoFrame = new VideoFrame(canvas as unknown as CanvasImageSource, {
      timestamp: Math.round((timeSec) * 1_000_000),
    });
    videoEncoder.encode(videoFrame, { keyFrame: frameIdx % fps === 0 });
    videoFrame.close();

    if (options.onProgress) {
      const elapsedMs = performance.now() - startTime;
      const fractionDone = (frameIdx + 1) / totalFrames;
      const etaSeconds = fractionDone > 0
        ? Math.max(0, Math.round((elapsedMs / fractionDone) * (1 - fractionDone) / 1000))
        : 0;
      options.onProgress({currentFrame: frameIdx + 1, totalFrames, etaSeconds});
    }
  }
  await videoEncoder.flush();

  // 6. Encode audio
  for (const chunk of chunkAudioBuffer(deps.audioBuffer)) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (audioError) throw audioError;
    while (audioEncoder.encodeQueueSize > 4) {
      await new Promise<void>((r) => setTimeout(r, 0));
      if (audioError) throw audioError;
    }
    // Build an AudioData. For multi-channel buffers we need interleaved Float32.
    const interleaved = new Float32Array(chunk.frameCount * chunk.channels.length);
    for (let f = 0; f < chunk.frameCount; f++) {
      for (let c = 0; c < chunk.channels.length; c++) {
        interleaved[f * chunk.channels.length + c] = chunk.channels[c][f];
      }
    }
    const audioData = new AudioData({
      format: 'f32',
      sampleRate: deps.audioBuffer.sampleRate,
      numberOfFrames: chunk.frameCount,
      numberOfChannels: chunk.channels.length,
      timestamp: chunk.timestampUs,
      data: interleaved,
    });
    audioEncoder.encode(audioData);
    audioData.close();
  }
  await audioEncoder.flush();

  // 7. Finalize muxer + return
  const bytes = muxer.finalize();
  const mime = videoPick.ext === 'mp4' ? 'video/mp4' : 'video/webm';
  const blob = new Blob([bytes], { type: mime });
  return { blob, ext: videoPick.ext, codecLabel: videoPick.label };
}
```

- [ ] **Step 3-5 — Verify, refine, commit**

```bash
git add lib/export/offline-render.ts tests/unit/export/offline-render.test.ts
git commit -m "feat(export): renderOffline orchestrator (frame loop + audio + muxer)"
```

---

### Task 9: Wire the hook + UI

**Files:**
- Modify: `lib/hooks/useVideoExporter.ts`
- Modify: `app/(studio)/page.tsx` (so the renderer-hook's getBitmap reaches the exporter)
- Modify: `components/TopBar/RecIndicator.tsx`
- Test: `tests/unit/components/TopBar/RecIndicator.test.tsx`

- [ ] **Step 1 — Plumb the bitmap getter**

`app/(studio)/page.tsx` owns both the renderer and the exporter via
the canvas ref. After Task 4 `useRenderer` returns `{ getBitmap }`.
Capture it and pass it to `useVideoExporter`:

```ts
// app/(studio)/page.tsx
const { getBitmap } = useRenderer({ canvasRef, getCurrentTime, getSeekCounter });
// ...
<TopBar engine={engine} canvasRef={canvasRef} getBitmap={getBitmap} />
```

`TopBar` already wires `useVideoExporter`; extend that hook's `deps`
to accept `getBitmap` and pass it into `renderOffline`.

- [ ] **Step 2 — Branch the hook**

The hook (Plan 6) currently always builds the realtime exporter. Add:

```ts
async function start() {
  if (isWebCodecsSupported()) {
    setExportState({ status: 'preparing', mode: 'offline' });
    try {
      const result = await renderOffline(
        {
          timeline: getTimeline(),
          beatGrid: getBeatGrid(),
          audioBuffer: audioEngine.getDecodedBuffer()!,
          getImageBitmap: deps.getBitmap,   // <- from useRenderer
          flowMode: useAppStore.getState().ui.flowMode,
        },
        {
          onProgress: (p) => setExportState({
            status: 'recording', mode: 'offline',
            currentFrame: p.currentFrame, totalFrames: p.totalFrames,
            etaSeconds: p.etaSeconds, progress: p.currentFrame / p.totalFrames,
          }),
          signal: cancelController.signal,
        },
      );
      // download anchor (same pattern as Plan 6)
      // ...
      setExportState({ status: 'done', mode: 'offline' });
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') {
        setExportState({ status: 'idle', mode: 'offline' });
      } else {
        setExportState({ status: 'error', mode: 'offline', errorCode: 'render-failed' });
      }
    }
  } else {
    setExportState({ status: 'preparing', mode: 'realtime' });
    realtimeExporter.start();   // existing path
  }
}
```

- [ ] **Step 3 — RecIndicator offline layout**

```tsx
// Inside RecIndicator, when status === 'recording':
if (mode === 'offline') {
  const percent = totalFrames ? Math.round((currentFrame / totalFrames) * 100) : 0;
  const eta = formatMmSs(etaSeconds ?? 0);
  return (
    <div className="…">
      <div className="text-xs">Rendering {currentFrame} / {totalFrames} ({percent}%) · ETA {eta}</div>
      <div className="w-32 h-1.5 bg-[var(--surface-3)]">
        <div className="h-full bg-[var(--a3)]" style={{width: `${percent}%`}} />
      </div>
      <button onClick={onCancel}>✕</button>
    </div>
  );
}
// Else realtime layout (existing).
```

- [ ] **Step 4 — Tests**

3 new RecIndicator tests for offline mode (progress text, bar width, ETA format).

- [ ] **Step 5 — Verify + smoke**

- [ ] **Step 6 — Commit**

```bash
git add lib/hooks/useVideoExporter.ts app/(studio)/page.tsx \
        components/TopBar/RecIndicator.tsx \
        tests/unit/components/TopBar/RecIndicator.test.tsx
git commit -m "feat(export): hook + RecIndicator switch to offline path on WebCodecs"
```

---

### Task 10: KNOWN_LIMITATIONS update + manual smoke gate

**Files:**
- Modify: `KNOWN_LIMITATIONS.md`

- [ ] **Step 1 — Update**

Rewrite the Export Pipeline section:

```markdown
## Export Pipeline (v0.2)

VibeGrid exports via two paths:

1. **Offline render (preferred, WebCodecs)** — frame-by-frame at
   1920×1080 / 30 fps / 8 Mbit/s video / 128 kbit/s audio, decoupled
   from preview FPS. H.264 + AAC MP4 by default; VP9 + Opus WebM
   fallback when MP4 codec config rejected. Render time depends on
   project complexity, typically 1-3× realtime on a modern desktop.
   Progress bar shows frame X / Y + ETA. Cancel returns to idle
   without partial output. Note: the video bitrate bumped from
   6 Mbit/s (realtime path) to 8 Mbit/s for offline — the realtime
   constraint is gone, so we spend a bit more on quality.
2. **Realtime record (fallback, MediaRecorder)** — exists for
   browsers without WebCodecs (Firefox < ~130, Safari < 16.4 audio).
   Same UX as v0.1: REC indicator with timecode, dual-trigger stop,
   `fix-webm-duration` patches the EBML header. Bound to preview
   FPS — a 24fps preview produces a 24fps video. 6 Mbit/s video.

Particles spawn positions are **non-deterministic across runs** —
two consecutive exports of the same project produce slightly different
particle layouts. Visually imperceptible; intentional v0.1 scope
decision to keep `Math.random()` rather than seeding a per-clip PRNG.

Both paths download the result automatically with a timestamped
filename. The browser must stay in the foreground; backgrounded tabs
throttle RAF.
```

- [ ] **Step 2 — Manual smoke**

Run the smoke gate from the top of this plan. Verify every bullet point.

- [ ] **Step 3 — Final verification gate**

```bash
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

- [ ] **Step 4 — Commit**

```bash
git add KNOWN_LIMITATIONS.md
git commit -m "docs(limitations): describe offline + realtime export paths"
```

---

## Risks + open questions for the reviewer

1. **mp4-muxer's `fastStart: 'in-memory'`** keeps the entire file in
   RAM until finalize. For a 5-minute 1080p video at 8 Mbit/s that's
   ~300 MB. Acceptable for v0.1. If we ever hit longer projects we'll
   swap to `StreamTarget` (writes chunks to a `WritableStream`).
2. **Audio encoder timestamp alignment.** AAC frames are 1024 samples;
   if the input duration isn't a multiple of 1024, the last frame is
   short. Both muxers handle this; we just need to make sure our
   `chunkAudioBuffer` reports the actual `frameCount` (not
   `FRAMES_PER_CHUNK`) for the last chunk so the muxer knows to pad.
3. **ImageBitmap cache shared with the offline path.** Resolved per
   architect: `useRenderer` now returns `{ getBitmap }`; the page
   component captures it and threads it through `useVideoExporter`
   into `renderOffline`. No global state, no Context. Implemented in
   Task 4 + plumbed through Task 9.
4. **Firefox WebCodecs status circa 2026-05-21.** Spec landed in
   Firefox 130 (October 2024). Safari WebCodecs Audio came in 17.4.
   Confirm current latest-release coverage before merge; if Firefox
   still lacks something, the feature-detect handles it cleanly.
5. **Particles spawn non-deterministic across multiple renders —
   intentional v0.1 scope decision, visually imperceptible.**
   `Math.random()` stays in `spawnGeometry`. Two consecutive exports
   of the same project produce slightly different particle layouts;
   nobody notices. If we ever add post-processing that needs frame-
   to-frame stability (motion blur, temporal AA, deflicker), revisit
   in a future plan with seed-per-frame PRNG.
6. **Tests using global `VideoEncoder` / `AudioEncoder` mocks.**
   `vitest.setup.ts` already stubs `MediaRecorder`. We'll add
   minimal mocks for both WebCodecs encoders — the orchestrator tests
   will exercise the pipeline with fakes that capture the
   configure/encode call sequence, including a stub that triggers the
   error callback for the architect-Bug-1 propagation test.

---

## What this plan deliberately does not do

- **No GPU acceleration** beyond what the browser does internally.
  Canvas 2D + WebCodecs is enough for v0.1 / v0.2.
- **No multi-pass / two-pass encoding** — variable bitrate single pass.
- **No render-to-disk streaming** — full Blob in memory.
- **No render-server.** Pure browser. Capacitor wrapper inherits the
  same pipeline. iOS-Safari support depends on WebCodecs Audio
  availability per OS version.
- **No render preset library** (low/medium/high). Fixed 1080p / 30 fps
  / 8 Mbit/s for v0.1. Add presets in v0.2.x once 4K + 60fps work.
