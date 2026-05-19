# VibeGrid — Design Spec (v0.1)

**Date:** 2026-05-19
**Status:** Approved (brainstorming complete)
**Scope:** v0.1 — Canvas Renderer + Beat Sync + 4 Core FX + Local Export

## 1. Goal

VibeGrid is a music-animation studio: import an image and an audio track, place beat-synchronized visual effects on a timeline, preview them on a canvas stage, and export the result as a WebM video.

v0.1 priority: **the renderer works correctly and beats are in sync**. UI polish, mobile, cloud projects, and authoring quality-of-life come in v0.2.

## 2. Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript (strict)
- **Styling:** Tailwind CSS + CSS custom properties from the PicTune handoff (`--bg`, `--surface-*`, `--a1..a3`, etc.). Permanent dark mode (no toggle).
- **Fonts:** Space Grotesk + JetBrains Mono via `next/font/google` (variable, `display: 'swap'`).
- **State:** Zustand store with `persist` middleware (localStorage). Blobs never persisted — only `MediaRef.url` (R2).
- **Audio:** Web Audio API — `AudioContext` + `MediaElementAudioSourceNode` + `AnalyserNode` + `MediaStreamDestination` (for export).
- **Rendering:** Single `<canvas>`, 2D context, plugin-based FX stack.
- **Drag & Drop:** `@dnd-kit/core` for clip drag; custom Pointer-Event handler only for clip resize handles.
- **Toasts:** `sonner`, single `<Toaster>` in studio layout.
- **Storage:** Cloudflare R2 (EU Jurisdiction) via `@aws-sdk/client-s3` from Next.js API Routes. D1 schema prepared, not implemented in v0.1.
- **Deployment:** Vercel (Node.js Runtime). Migration path to Cloudflare Pages stays open.
- **Capacitor:** Prepared (`typeof window` guards everywhere, pointer events) — full mobile UI in v0.2.

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Next.js 14 App Router                                       │
│                                                              │
│  React UI Layer  ──►  Zustand Store (AppState + persist)     │
│       │                          │                           │
│       ▼                          ▼                           │
│  Canvas Renderer  ◄──  Beat Engine (BPM grid + detected)     │
│       │                          │                           │
│       ▼                          ▼                           │
│  FX Plugin Registry         Audio Engine (Web Audio)         │
│                                                              │
│  Storage Adapter ──► /api/upload ──► R2 (EU)                 │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 Module boundaries

| Module | Purpose |
|---|---|
| `lib/renderer/` | Canvas loop, FX plugin interface, FX registry. Exports `isClient()` guard. |
| `lib/fx/` | Individual FX plugins (contour, sweep, pulse, particles). Self-register on import. |
| `lib/audio/` | `AudioEngine`, beat detector (pure function + worker wrapper), grid math. Exports `isClient()` guard. |
| `lib/timeline/` | Types (`Clip`, `Track`, `PlayheadState`, `BeatGrid` mapping), selectors, operations. Pure. |
| `lib/store/` | Zustand store + persist middleware. Composes timeline + audio + ui state. |
| `lib/storage/` | `StorageAdapter` interface + `R2StorageAdapter` (client side caller of API routes). |
| `lib/export/` | `VideoExporter` (MediaRecorder wrapper + state machine). |
| `app/(studio)/` | Studio routes + layout (Toaster, fonts, error boundaries). |
| `app/api/upload/` | POST: multipart → R2. `runtime = 'nodejs'`. |
| `app/api/projects/` | Stub routes (GET/POST), D1 schema prepared. |
| `components/` | Pixel-perfect re-implementation of the PicTune prototype. |
| `db/schema.sql` | D1 schema, committed, not yet applied. |
| `KNOWN_LIMITATIONS.md` | Realtime-export caveats, iOS WebM, etc. |

### 3.2 Capacitor / SSR safety

Both `lib/audio/` and `lib/renderer/` must:
- Export `isClient()` returning `typeof window !== 'undefined'`.
- Never access `window`, `AudioContext`, `OffscreenCanvas`, `HTMLCanvasElement` at module top level.
- Lazy-init inside `useEffect` or behind `isClient()` checks.

This protects the Next.js SSR build and the later Capacitor wrapper.

## 4. FX Plugin Interface

The core abstraction. Inspector is **auto-generated** from `paramSchema` — no hardcoded UI per effect.

```ts
// lib/renderer/types.ts

export type ParamType =
  | { kind: 'slider'; min: number; max: number; step: number; default: number; unit?: string }
  | { kind: 'color'; default: string; palette?: string[] }
  | { kind: 'select'; options: { value: string; label: string }[]; default: string }
  | { kind: 'toggle'; default: boolean };

export type ParamSchema = Record<string, ParamType & { label: string }>;

export type TriggerMode = 'half-bar' | 'beat' | 'bar' | 'two-bar';

export type PreloadState = 'idle' | 'loading' | 'ready' | 'error';

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  time: number;            // seconds since playback start
  beatPhase: number;       // 0..1 between consecutive beats
  beatIndex: number;
  isOnBeat: boolean;       // window-based, see §5
  trigger: TriggerMode;
  /**
   * Guaranteed non-undefined when this `render()` is invoked.
   * The renderer does not call FX without an active image clip,
   * EXCEPT for plugins whose `kind === 'Pulse'`, which do not require an image.
   * All other plugins may assert `imageBitmap!` safely.
   */
  imageBitmap?: ImageBitmap;
}

export interface FxPlugin<Params = Record<string, unknown>> {
  readonly id: string;
  readonly name: string;
  readonly kind: 'Contour' | 'Pulse' | 'Sweep' | 'Particle';
  readonly defaultTrigger: TriggerMode;
  readonly paramSchema: ParamSchema;
  readonly preloadState: PreloadState;

  getDefaultParams(): Params;
  preload(imageBitmap: ImageBitmap, signal: AbortSignal): Promise<void>;
  render(rc: RenderContext, params: Params): void;
  dispose?(): void;
}
```

`preloadState` drives a loading indicator in the Inspector and on the FX clips in the timeline (Canny path tracing may take 200–500ms on large images).

### 4.1 FX plugins in v0.1

| id | kind | Algorithm |
|---|---|---|
| `contour` | Contour | Canny edge detection + marching-squares to traced SVG-like paths, cached on image preload. Beat triggers `stroke-dasharray`-style animation along cached paths. Threshold exposed via Inspector slider. |
| `sweep` | Sweep | Three radial-gradient orbs drifting across the canvas, timed to bar boundaries. |
| `pulse` | Pulse | Full-frame scale + glow on beat. No image required. |
| `particles` | Particle | Particle emitter rising from bottom, color-cycled through `--a1..--a3`. |

The `FX_LIBRARY` data structure from the prototype maps directly onto these plugins; additional plugins (glitch, shake, flare, sparkle) can be added later without UI refactor.

## 5. Audio Engine & Beat Detection

```ts
// lib/audio/engine.ts

export interface BeatGrid {
  bpm: number;
  source: 'manual' | 'detected';
  beatsPerBar: number;
  offsetMs: number;
  detectedBeats?: number[];
}

export interface AudioEngineState {
  status: 'idle' | 'loading' | 'ready' | 'playing' | 'error';
  duration: number;
  currentTime: number;
  beatGrid: BeatGrid;
}

export interface AudioEngine {
  load(file: File | string): Promise<void>;
  play(): Promise<void>;       // awaits AudioContext.resume() first
  pause(): void;
  seek(seconds: number): void;
  detectBPM(signal: AbortSignal, onProgress?: (p: number) => void): Promise<BeatGrid>;
  setBPM(bpm: number): void;
  getAnalyser(): AnalyserNode | null;
  destroy(): void;
}
```

### 5.1 Implementation rules

- Single `AudioContext`, lazy-initialized.
- `<audio>` element + `MediaElementAudioSourceNode` → `AnalyserNode` → `MediaStreamDestination` (for export) → `destination` (speakers).
- `currentTime` source of truth = `audioElement.currentTime` (no RAF drift).
- `play()` **must** `await audioContext.resume()` before `audioElement.play()`. If the context stays suspended (autoplay blocked), `status = 'error'`.

### 5.2 Beat detection

- Energy-based, on-demand, runs in a Web Worker so it can be invoked at any time (initial import **or** later via Inspector / Topbar button).
- Worker emits `progress` events 0–100% so the UI can show a determinate progress indicator (detection can take 2–3 s on >10-minute files).
- BPM remains manually overridable at any time.
- Detected BPM is clamped to `[60, 200]`. Octave selection picks the candidate nearest the median onset-interval BPM.
- The algorithmic core (`lib/audio/beat-detector.ts`) is a **pure function**, exported separately from the worker wrapper for unit testing.

### 5.3 Beat-window logic

```
BEAT_WINDOW_MS = 40                              // ±2 frames at 60fps

isOnBeat = |currentTime - nearestBeatTime| < BEAT_WINDOW_MS
        && lastFiredBeatIndex !== nearestBeatIndex
```

Both the window and the `lastFiredBeatIndex` guard are required to prevent double-firing within the same beat window.

### 5.4 Grid math (`lib/timeline/grid.ts`)

- `timeToBeats(seconds, grid)`
- `beatPhase(seconds, grid) → { beatIndex, phase, isOnBeat }`

## 6. Timeline Module

```ts
// lib/timeline/types.ts

export type TrackKind = 'image' | 'contour' | 'sweep' | 'pulse' | 'particles';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  order: number;
}

export interface Clip {
  id: string;
  trackId: string;
  kind: TrackKind;
  startBeat: number;
  lengthBeats: number;
  mediaId?: string;
  fxId?: string;
  params?: Record<string, unknown>;
  trigger?: TriggerMode;
  label: string;
}

export type SnapMode = 'beat' | 'half' | 'quarter' | 'off';

export interface PlayheadState {
  beats: number;
  playing: boolean;
}

export interface TimelineState {
  tracks: Track[];
  clips: Clip[];
  playhead: PlayheadState;
  zoom: number;
  snap: SnapMode;
}
```

### 6.1 Selectors (pure)

```ts
activeClipsAt(state, beats): Clip[]
activeImageClip(state, beats): Clip | null
activeFxClipsByKind(state, beats): Record<Exclude<TrackKind,'image'>, Clip[]>
snapBeats(beats, snap): number    // mapping: { beat: 1, half: 0.5, quarter: 0.25 }
totalBeats(state): number
beatsToTimecode(beats, bpm): string
hasOverlap(state, trackId, startBeat, lengthBeats, excludeClipId?): boolean
```

### 6.2 Operations (pure)

```ts
addClip(state, clip)             // throws OperationError on overlap
moveClip(state, clipId, newStartBeat)  // throws OperationError on overlap
resizeClip(state, clipId, newLengthBeats)
removeClip(state, clipId)
setClipParams(state, clipId, params)
setPlayhead(state, beats)
setMuted(state, trackId, muted)
```

`OperationError` is caught by the UI layer → toast "Clip overlaps existing clip" (no silent overwrite).

`Clip.mediaId` references entries in the `mediaRefs` collection of the Zustand store (see §10) — `MediaRef` itself is owned by the store, not by `TimelineState`.

## 7. Storage & API Layer

```ts
// lib/storage/types.ts

export interface MediaRef {
  id: string;
  kind: 'image' | 'audio';
  url: string;
  filename: string;
  width?: number; height?: number;
  duration?: number;
  uploadedAt: string;            // ISO 8601
}

export interface StorageAdapter {
  uploadImage(file: File): Promise<MediaRef>;
  uploadAudio(file: File): Promise<MediaRef>;
}
```

### 7.1 R2 + API

- **Deployment target:** Vercel + R2 as external S3-compatible store.
- API routes set `export const runtime = 'nodejs'`.
- R2 EU Jurisdiction: endpoint `https://${R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`.
- `@aws-sdk/client-s3` initialized with `region: 'auto'`, `endpoint: ...eu.r2...`, and `requestChecksumCalculation: 'WHEN_REQUIRED'` (no-op on Node runtime, kept as a forward-compat comment for later Cloudflare Pages migration).
- Server-side MIME validation via `file-type` (magic bytes, not Content-Type header). Whitelists:
  - Images: `image/jpeg`, `image/png`, `image/webp` (≤ 20 MB)
  - Audio: `audio/mpeg`, `audio/wav`, `audio/mp4` (≤ 50 MB)
- R2 key format: `{userId}/{projectId}/{kind}/{uuid}.{ext}` — v0.1 uses `anonymous` as `userId` and `default` as `projectId` (no auth and no project persistence in v0.1).

### 7.2 Env vars (`.env.example`)

```
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=vibegrid-media
R2_ENDPOINT=https://${R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com
R2_PUBLIC_URL=https://media.vibegrid.example.com
# D1 (v0.2):
D1_DATABASE_ID=
```

### 7.3 D1 schema (prepared, not applied in v0.1)

```sql
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

## 8. Export Pipeline

```ts
// lib/export/recorder.ts

export interface ExportOptions {
  filename: string;
  videoBitsPerSecond: number;          // default 6_000_000
  audioBitsPerSecond: number;          // default 128_000
  mimeType: string;                    // 'video/webm;codecs=vp9,opus' with vp8 fallback
  frameRate: 30 | 60;                  // default 30 (social-media standard)
}

export interface ExportState {
  status: 'idle' | 'preparing' | 'recording' | 'finalizing' | 'done' | 'error';
  progress: number;                    // 0..1
  elapsedSeconds: number;
  totalSeconds: number;
  warning?: 'performance-degraded' | 'tab-hidden';
}

export interface VideoExporter {
  start(opts: ExportOptions): Promise<void>;
  cancel(): void;
  getState(): ExportState;
  onStateChange(cb: (s: ExportState) => void): () => void;
}
```

### 8.1 Workflow (realtime, local download)

1. **Pre-check:**
   - Audio loaded, playhead at `beats === 0`, image clip active.
   - Codec support detected with `MediaRecorder.isTypeSupported(...)`; the chosen codec is shown to the user ("Export codec: VP9 + Opus" / "VP8 + Opus (Fallback)").
2. **Start:**
   - `canvas.captureStream(opts.frameRate)` → video track (default 30 fps).
   - `audioContext.createMediaStreamDestination()` → audio track (the destination is already wired in `AudioEngine`).
   - `MediaRecorder` on the combined stream, `ondataavailable` every 500 ms.
3. **REC indicator:** Topbar replaces transport with red pulsing dot + "REC ●" + `00:14 / 00:32` timecode (from `elapsedSeconds` / `totalSeconds`). Cancel button visible.
4. **Performance monitor:** Track RAF deltas during recording. If >5% of frames take >25 ms (drops below ~40 fps): set `warning = 'performance-degraded'` and show a non-blocking toast. No auto-stop.
5. **Tab-visibility guard:** On `recording`, attach `visibilitychange`. On `document.hidden`: set `warning = 'tab-hidden'`, show **persistent** toast "Tab im Hintergrund — Export-Qualität beeinträchtigt. Tab aktiv halten!". Remove listener in `cancel()` and after `done`.
6. **Stop:** Both `audioElement.addEventListener('ended', stop)` AND a `setInterval` safety-net polling every 200 ms for `currentTime >= duration - 0.1`. `cancel()` clears the interval too.
7. **Finalize:** Combine chunks → `Blob` → `URL.createObjectURL` → `<a download>` click. After 10 s `URL.revokeObjectURL(url)` to release memory.

### 8.2 Filename

```ts
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const filename = `vibegrid_export_${ts}.webm`;
```

### 8.3 Known limitations (documented in `KNOWN_LIMITATIONS.md`)

- WebM not natively playable in iOS Safari (relevant for the v0.2 Capacitor build).
- Realtime export — user must not switch tabs (browser throttles RAF in the background).
- Browser-specific codec support varies.

### 8.4 Out of scope for v0.1

- R2 upload of the resulting file.
- Offline render via `OffscreenCanvas` + Web Worker.
- MP4 output via `WebCodecs`.

## 9. UI Components & Layout

Visual style is **pixel-perfect to the PicTune handoff**. State now flows from the Zustand store instead of `useState` in the prototype.

```
app/(studio)/
  layout.tsx        // dark mode permanent, Toaster, fonts, ErrorBoundary anchors
  page.tsx          // TopBar + Workspace + MobileTabBar

components/
  TopBar/           // Transport, BPMBadge, ExportButton, RecIndicator
  Workspace/
    LeftPanel/      // MediaLibrary | FxLibrary | LayersList
    Stage/          // Stage + CanvasView (DPR-correct)
    Timeline/       // Toolbar, Ruler, Waveform, Tracks, Clips, Playhead
    Inspector/      // Auto-generated from FxPlugin.paramSchema
  Mobile/           // stubs in v0.1, full impl in v0.2
  ui/               // shared primitives (Button, Slider, ParamControl, etc.)
```

### 9.1 Canvas DPR handling

```ts
const observer = new ResizeObserver(([entry]) => {
  const { width, height } = entry.contentRect;
  const dpr = window.devicePixelRatio ?? 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  // ctx.scale(dpr, dpr) in renderer-init after this
});
```

CSS dimensions stay layout-controlled; canvas pixel dimensions follow DPR.

### 9.2 Waveform off main thread

`Waveform.tsx` does **not** call `decodeAudioData`. `AudioEngine` produces the `AudioBuffer`; `lib/audio/waveform-worker.ts` receives the channel data, returns downsampled min/max peaks; the component renders the SVG path from those peaks.

### 9.3 Inspector

Built entirely from `FxPlugin.paramSchema`. Adding a new FX automatically adds its controls. Header shows plugin name, kind, sync mode; Trigger segment (`½ Bar / Beat / Bar / 2 Bar`) backed by `clip.trigger`. Empty state: "Wähle einen Clip oder Effekt aus."

### 9.4 Error boundaries

Class components, at least:
- Around `<CanvasView>` + `<Stage>` — fallback: "Renderer error — reload to continue" with details.
- Around `<Timeline>` — fallback: "Timeline error — project state may be corrupted".

### 9.5 Responsive strategy

- `≥ 1024px` — full 3-column desktop layout.
- `640–1024px` — 2-column; Inspector becomes a slide-over from the right, toggled by a tab icon at the stage's right edge. `inspectorOpen` is local UI state.
- `< 640px` — stacked layout, `MobileTabBar` visible, basic crash-free behavior.

Touch readiness: pointer events on canvas and timeline. No pinch-zoom, no touch drag-reorder in v0.1.

### 9.6 Drag & resize

- **Clip drag (horizontal on timeline):** `@dnd-kit/core`. Touch-compatible, keyboard-accessible.
- **Clip resize (right-edge handle only in v0.1):** custom Pointer-Event handler — does not conflict with track-body click to seek.

## 10. State Management

- Zustand store + `persist` middleware.
- **Persistence rules:**
  - **Persist:** `timeline` state, `audioGrid` (BPM, source), `mediaRefs` (URL + metadata), UI tweaks (zoom, snap).
  - **Do NOT persist:** `AudioBuffer`, `ImageBitmap`, any `Blob`, any in-flight upload state, transient export state.
- On rehydration: missing keys must fall back to defaults (forward-compat across schema additions).

## 11. Testing & Verification

### 11.1 Stack

- **Vitest** (test runner) — `environment: 'jsdom'`, `resources: 'usable'`, `singleThread: true` (avoid jsdom + worker parallelism conflicts).
- **@testing-library/react** for component tests (no snapshot spam).
- **MSW** for API mocks in integration tests.
- **Playwright** for E2E (v0.1: one smoke test only).

### 11.2 Test layout

```
tests/
  unit/
    timeline/
      selectors.test.ts        // activeClipsAt, snapBeats, hasOverlap
      operations.test.ts       // immutability, overlap-throws
    audio/
      beat-detector.test.ts    // synthetic click track at known BPM
      grid.test.ts             // timeToBeats, beatPhase, isOnBeat window
    renderer/
      registry.test.ts
      plugin-contract.test.ts  // generator: every registered plugin satisfies FxPlugin
    storage/
      mime-validator.test.ts
    store/
      persist.test.ts          // blob exclusion, rehydration, partial state
  integration/
    upload.api.test.ts         // POST /api/upload with mocked R2
    export.test.ts             // state machine of VideoExporter
  e2e/
    smoke.spec.ts              // load app, upload, play, no FX crash
```

### 11.3 Synthetic click track helper

```ts
function createSyntheticClickTrack(bpm: number, bars: number): AudioBuffer {
  const sampleRate = 44100;
  const beatInterval = (60 / bpm) * sampleRate;
  const totalSamples = Math.ceil(beatInterval * bars * 4);
  const buffer = new AudioBuffer({ numberOfChannels: 1, length: totalSamples, sampleRate });
  const data = buffer.getChannelData(0);
  for (let beat = 0; beat < bars * 4; beat++) {
    const pos = Math.round(beat * beatInterval);
    if (pos < totalSamples) data[pos] = 1.0;
  }
  return buffer;
}
```

Test cases: 90 / 120 / 128 BPM, ±2 BPM tolerance (energy-based is heuristic).

### 11.4 isOnBeat window test (mandatory)

```ts
test('isOnBeat true within ±40ms window', () => {
  const grid = { bpm: 120, offsetMs: 0, beatsPerBar: 4 };
  expect(beatPhase(0.500, grid).isOnBeat).toBe(true);
  expect(beatPhase(0.520, grid).isOnBeat).toBe(true);
  expect(beatPhase(0.480, grid).isOnBeat).toBe(true);
  expect(beatPhase(0.545, grid).isOnBeat).toBe(false);
});

test('same beat does not fire twice within window', () => {
  // lastFiredBeatIndex prevents double trigger
});
```

### 11.5 Store persistence tests

- Audio/image blobs are NOT in `localStorage` (only `MediaRef.url`).
- Timeline state survives store rehydration unchanged.
- Missing keys in persisted state use defaults (no crash).

### 11.6 What we deliberately do not test in v0.1

- Pixel-level FX correctness (flaky in CI; manual visual review).
- Actual MediaRecorder audio quality (jsdom-mocked; revisit in Playwright in v0.2).
- WebAudio output sound.

### 11.7 Verification gates before v0.1 release

1. `npm run typecheck` — `tsc --noEmit` clean.
2. `npm run lint` — ESLint clean.
3. `npm test` — unit + integration green.
4. `npm run test:e2e` — smoke green.
5. Manual checklist (in `KNOWN_LIMITATIONS.md`):
   - Image upload → canvas shows image.
   - Audio upload → waveform visible.
   - "Detect BPM" → progress indicator, value applied.
   - Play → all 4 FX fire visibly at least once.
   - Inspector slider changes FX param live.
   - Export starts, REC indicator visible.
   - Exported WebM opens in VLC/Chrome.
   - Retina display: canvas output sharp (DPR fix verified).
   - Tab switch during recording: warning toast appears.
   - Export filename has correct timestamp (no `undefined`).
   - Memory not permanently elevated after export (object URL revoked).

### 11.8 CI

GitHub Actions: typecheck + lint + test on every PR. E2E only on push to `main`.

## 12. Out of Scope for v0.1

- Authentication / multi-user (R2 keys use `anonymous` as `userId`).
- D1 active read/write (schema only).
- Full mobile UI (sheets, tab bar). Stubs only.
- Capacitor build (preparation only).
- Pixel-compare visual tests.
- WebGL renderer.
- Glitch / Shake / Flare / Sparkle FX (registry supports them; not implemented).
- R2 upload of exported video.
- MP4 / WebCodecs export.

## 13. v0.2 Commitment

Immediately after v0.1, before any other feature work:

- Full mobile UI matching the PicTune mobile screens (sheets, tab bar).
- Capacitor build configured and App Store submission.
