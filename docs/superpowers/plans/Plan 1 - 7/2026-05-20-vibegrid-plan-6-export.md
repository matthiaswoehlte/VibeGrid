# VibeGrid Plan 6 — Export Pipeline (Realtime WebM via MediaRecorder)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project execution policy (overrides skill defaults):** direct-on-main, sequential, one commit per task. Final CC #2 review at the end.

---

## Context for the external reviewer

The post-Plan-5.7-R baseline is **358 tests passing** at commit `df0c4f8`.
The CC #1 prompt (`2026-05-20-vibegrid-cc1-prompt-plan-6.md`) was
architect-expanded with 7 Spec §8 details before this plan was written —
all are addressed below.

Notable state from Plan 5.7-R that affects this plan:

1. **`ui.automationEditorClipId`** (renamed from `expandedAutomationClipId`).
   No interaction with export — just don't confuse it with this plan's new
   `exportState` UI field.
2. **`AudioEngine.streamDest`** is private in the closure (line 36 of
   `lib/audio/engine.ts`). No public getter exists yet — Plan 6 adds one
   (Task 2).
3. **`vitest.setup.ts`** already mocks `AudioContext`, `ResizeObserver`,
   `createImageBitmap`, and silences `HTMLMediaElement` calls. Plan 6
   extends this with `MediaRecorder` and the migrated `URL.createObjectURL`
   / `File.arrayBuffer` stubs.
4. **Test pattern conventions:** native `MouseEvent` for pointer events
   (jsdom strips clientX from `fireEvent.pointer*`), one commit per task,
   strict TS catches every UI-literal change to `ui: { ... }`.

---

**Goal:** From the running studio, the user clicks **Export**, sees a REC
indicator with live timecode, the audio plays through to the end, and a
WebM file with the correct timestamped filename is downloaded automatically.
Tab switching keeps the export running but shows a persistent warning;
dropped frames produce a one-time toast; the user can cancel at any time.

**Architecture:** Five surfaces.

1. **Pure helpers (`lib/export/`)** — `pickCodec()` walks a preference list
   against `MediaRecorder.isTypeSupported()`; `makeFilename()` formats
   `vibegrid_export_<ISO-no-colons>.webm`; `ExportState` and `ExportOptions`
   types. Zero React, zero DOM-side-effects.
2. **`AudioEngine.getAudioStream()`** — new public method on the existing
   engine that returns `streamDest?.stream ?? null`. Lets the exporter
   grab the audio track without reaching into engine internals.
3. **`VideoExporter` class (`lib/export/recorder.ts`)** — orchestrator.
   Runs the pre-checks, picks the codec, builds the combined MediaStream
   (`canvas.captureStream(30)` + audio track), starts the `MediaRecorder`
   with `start(500)`, drives the state machine (`idle → preparing →
   recording → finalizing → done`), manages the dual stop-trigger
   (audio `ended` + 200 ms safety interval), assembles the Blob,
   triggers download, and revokes the object URL after 10 s.
4. **Store extension** — `ui.exportState: ExportState` (transient), top-level
   `setExportState(patch)` patch-merge action. Cleanup is automatic on
   `cancel()` and on the `done`-state auto-reset after 2 s.
5. **TopBar UI** — `ExportButton` (disabled when `status !== 'idle'` OR
   no audio MediaRef OR no active image clip at beat 0), `RecIndicator`
   (red dot + `MM:SS / MM:SS` timecode + ✕ cancel button, visible for
   `status === 'recording'`), tab-visibility listener (persistent toast),
   RAF-based FPS monitor (one-shot warning toast at < 24 fps avg).

**Tech Stack:** existing — Web Audio API (already wired to streamDest),
Canvas 2D + `captureStream`, MediaRecorder. New dep: none.

**Spec reference:** `docs/superpowers/specs/2026-05-19-vibegrid-design.md` §8
(Export Pipeline). Acceptance Criteria AC-13, AC-14, AC-15, QAC-03.

**Verification gate (must pass before declaring Plan 6 done):**

```
npm test -- export/codec               # ≥ 4
npm test -- export/filename            # ≥ 3
npm test -- export/state-machine       # ≥ 4
npm test -- export/VideoExporter       # ≥ 8
npm test -- audio/engine-stream        # ≥ 2
npm test -- components/TopBar          # existing + 4 ExportButton + 3 RecIndicator
npm test -- store/export-state         # ≥ 4
npm test                               # full suite ≥ 385 (Plan 5.7-R = 358; ~27 new)
npm run typecheck
npm run lint
npm run build                          # studio bundle within +5% of 130 kB baseline
```

**Smoke gate (manual, before declaring Plan 6 done):**

```
npm run dev
# - Upload image + audio. Place image clip on Image track covering audio length.
# - Click Export → REC indicator appears in TopBar, timecode counts up.
#   Codec toast shows ("Export codec: VP9 + Opus" or "VP8 + Opus (Fallback)").
# - Wait for the audio to end — recording auto-stops within ~200 ms of the
#   audio `ended` event; download dialog opens with vibegrid_export_<ts>.webm.
# - Open the downloaded file in VLC and Chrome → plays cleanly, no black
#   opening frame, audio + video in sync.
# - Repeat. During recording, switch tabs — persistent toast appears, recording
#   continues. Tab back → toast disappears.
# - Repeat. During recording, hit Cancel → REC indicator disappears, no
#   download, "Export cancelled" toast.
# - Try Export with no image clip → button is disabled, tooltip explains.
# - Try Export with no audio → button is disabled.
```

**Dependencies on prior plans:** Plan 2 (AudioEngine with private streamDest).
Plan 3 (canvas renderer). Plan 5.7-R (`activeImageClips` selector, store
patterns, UI-literal-strict TS).

**Out of scope (v0.2 or later):**

- R2 upload of the exported file (Plan 8 or v0.2).
- MP4 / WebCodecs export (v0.2, iOS-Capacitor).
- Stems export (separate audio tracks — needs Plan 5.9 multi-track first).
- Percent progress bar (real-time export → only elapsed/total timecode
  makes sense).
- Bitrate / FPS / codec UI controls (fixed values for v0.1).
- Background-tab continuation (browser RAF throttling — out of our reach).

---

## File map

### Pure helpers (no DOM, no React)

| File | Purpose |
|---|---|
| `lib/export/types.ts` (create) | `ExportStatus`, `ExportState`, `ExportErrorCode`, `ExportWarning`, `ExportOptions` |
| `lib/export/codec.ts` (create) | `pickCodec(supportedCheck?)` walks a preference list (vp9+opus → vp8+opus → default webm), returns `{ mimeType, label }`. Pure — accepts a `(type: string) => boolean` for testability |
| `lib/export/filename.ts` (create) | `makeFilename(now: Date = new Date())` → `vibegrid_export_2026-05-20T14-30-00.webm` |
| `lib/export/state-machine.ts` (create) | `EXPORT_INITIAL_STATE` + a small `reduceExportState(state, patch)` helper that applies patch + enforces transitions (e.g. `cancel` from `recording` returns to `idle`) |

### Audio engine extension

| File | Purpose |
|---|---|
| `lib/audio/types.ts` (modify) | Add `getAudioStream(): MediaStream \| null` to `AudioEngine` interface |
| `lib/audio/engine.ts` (modify) | Implement `getAudioStream` — returns `streamDest?.stream ?? null` |

### Exporter

| File | Purpose |
|---|---|
| `lib/export/recorder.ts` (create) | `createVideoExporter(deps)` factory. Owns the state machine, MediaRecorder, dual-stop trigger, FPS monitor, blob assembly, download trigger, URL.revoke after 10 s. Inputs via deps: `canvas`, `audioEngine`, `getTimeline()`, `getAudioMediaRef()`, `setExportState`. Both timeline + media-ref are GETTER functions (not captured values) so the exporter reads fresh state at `start()` time — see Risk table. SSR-safe (factory returns null when `!isClient()`) |
| `lib/hooks/useVideoExporter.ts` (create) | Owns one VideoExporter instance per Workspace mount. Provides `start()` / `cancel()` callbacks. Wires the tab-visibility listener (persistent toast) + the one-shot FPS-warning toast |

### Store

| File | Purpose |
|---|---|
| `lib/store/types.ts` (modify) | Add `exportState: ExportState` to `UIState`. Add top-level `setExportState(patch: Partial<ExportState>): void` next to `setAutomationEditorClipId` |
| `lib/store/index.ts` (modify) | Inline UI literal gains `exportState: EXPORT_INITIAL_STATE`. New top-level `setExportState` patch-merge action. Partialize comment lists the new transient field |
| Files with full `ui: {…}` literals (modify) | `components/TopBar/ClearProjectButton.tsx`, `tests/unit/components/Inspector.test.tsx`, `tests/unit/components/AutoPresetButton.test.tsx`, `tests/unit/components/Timeline/Clip.test.tsx`, `tests/unit/store/ui-state-automation.test.ts` — each grows `exportState: EXPORT_INITIAL_STATE` (strict TS will flag any miss) |

### TopBar UI

| File | Purpose |
|---|---|
| `components/TopBar/ExportButton.tsx` (rewrite) | Replaces the Plan-5 stub. Computes `disabled` from `exportState.status !== 'idle'` ∪ no-audio ∪ no-image-clip. Click calls the `useVideoExporter().start()` |
| `components/TopBar/RecIndicator.tsx` (rewrite) | Replaces the Plan-5 stub. Visible when `status === 'recording'`. Red dot + `MM:SS / MM:SS` (elapsed / total) + ✕ cancel button. Timecode derived from `elapsedSeconds` (live), `totalSeconds` (frozen at start) |
| `components/TopBar/index.tsx` (modify) | Render `RecIndicator` next to `ExportButton`; pass the `useVideoExporter` callbacks through |

### Tests setup

| File | Purpose |
|---|---|
| `vitest.setup.ts` (modify) | Pull the `URL.createObjectURL` / `URL.revokeObjectURL` + `File.arrayBuffer` stubs out of `media-meta.test.ts` into the global setup. Add a `MockMediaRecorder` stub that backs `globalThis.MediaRecorder` + `MediaRecorder.isTypeSupported` |
| `tests/unit/storage/media-meta.test.ts` (modify) | Remove the inline stubs — they now live in the global setup |

### Docs

| File | Purpose |
|---|---|
| `KNOWN_LIMITATIONS.md` (modify) | Fill in the Export section: realtime constraint, tab-switch warning, WebM/iOS incompatibility, codec browser variance |

### Tests (≥ 27 new)

| File | Tests |
|---|---|
| `tests/unit/export/codec.test.ts` (create) | ≥ 4: picks vp9+opus when supported, falls through to vp8+opus, falls through to default webm, returns label string matching the picked mime |
| `tests/unit/export/filename.test.ts` (create) | ≥ 3: format matches `vibegrid_export_<ISO>.webm`, colons/dots replaced with `-`, never contains `undefined` |
| `tests/unit/export/state-machine.test.ts` (create) | ≥ 4: initial state has `idle` + zeroed timecodes, patch-merge preserves untouched keys, transition `recording → idle` resets elapsedSeconds, warning fields can be set without changing status |
| `tests/unit/export/VideoExporter.test.ts` (create) | ≥ 8: start with all pre-checks satisfied transitions to `recording`, start without audio MediaRef fails with `errorCode: 'no-audio'`, start without active image clip fails with `errorCode: 'no-image'`, stop via `audioEl.ended` calls `mediaRecorder.stop()`, stop via safety interval also fires, cancel clears interval + removes 'ended' listener, codec-fallback picks vp8 when vp9 unsupported, filename in download anchor has correct format |
| `tests/unit/audio/engine-stream.test.ts` (create) | ≥ 2: `getAudioStream()` returns null before load, returns `MediaStream` after load |
| `tests/unit/store/export-state.test.ts` (create) | ≥ 4: `setExportState({status:'recording'})` patch-merges (other fields unchanged), `exportState` not in localStorage after persist, `cancel`-emulating reset returns to status idle + zeroed times, warning field updates without overwriting status |
| `tests/unit/components/TopBar/ExportButton.test.tsx` (create) | ≥ 4: disabled when no audio MediaRef, disabled when no active image clip, disabled when status !== 'idle', click calls the injected start() prop |
| `tests/unit/components/TopBar/RecIndicator.test.tsx` (create) | ≥ 3: not rendered when status === 'idle', visible + shows MM:SS timecode when status === 'recording', ✕ button calls cancel callback |

---

## Conventions

- **`isClient()` guard everywhere.** `MediaRecorder`, `canvas.captureStream`,
  `AudioContext` are browser-only. `createVideoExporter` is a factory that
  returns null in SSR.
- **State-machine patches, not replacements.** Every `setExportState`
  caller passes only the fields they're changing. The store action
  merges. This keeps `progress` / `elapsedSeconds` updates from clobbering
  the `warning` flag (and vice versa).
- **Dual stop-trigger cleanup is critical.** Whichever trigger fires
  first MUST tear down the other (event listener removal + clearInterval).
  Without that, after audio ends both fire and `mediaRecorder.stop()`
  is called twice → second call throws "InvalidStateError".
- **`mediaRecorder.start(500)`** — never start without the timeslice arg.
  See the prompt's "MediaRecorder Chunk-Timing" rationale.
- **URL.revoke after 10 s** — `setTimeout(() => URL.revokeObjectURL(url),
  10_000)`. Plain `URL.revokeObjectURL(url)` immediately after the click
  can abort slow downloads in Chromium.
- **Codec toast on success.** After `pickCodec` returns, fire
  `toast.info('Export codec: <label>')` once. User wants visibility.
- **`tests/__stubs__/MockMediaRecorder.ts`** (or inline in vitest.setup.ts)
  must back `globalThis.MediaRecorder` AND `MediaRecorder.isTypeSupported`.
  The mock fires `ondataavailable` synchronously on `requestData()` and
  `onstop` on `stop()` — keeps tests deterministic without fake timers.
- **One commit per task** with `type(scope): description`. Scopes:
  `chore`, `audio`, `export`, `store`, `topbar`, `docs`, `tests`.

---

## Task 0: Baseline verification

**Files:** none

- [ ] **Step 1: Confirm Plan 5.7-R baseline is green**

```bash
npm test -- --run
npm run typecheck
npm run lint
```

Expected: 358 tests passing, typecheck + lint clean. If lower, STOP and
surface the regression before starting Plan 6.

No commit.

---

## Task 1: Migrate jsdom stubs + add MediaRecorder mock to `vitest.setup.ts`

**Files:**
- Modify: `vitest.setup.ts`
- Modify: `tests/unit/storage/media-meta.test.ts`

> Pre-Plan-6 housekeeping flagged in the handoff doc. `URL.createObjectURL`,
> `URL.revokeObjectURL`, and `File.arrayBuffer` are stubbed inline in
> `media-meta.test.ts`. Plan 6 needs them globally (VideoExporter uses
> `URL.createObjectURL` + `URL.revokeObjectURL` directly). Plus a new
> `MockMediaRecorder` backing `globalThis.MediaRecorder`.

- [ ] **Step 1: Extend `vitest.setup.ts`**

Add inside the existing `if (typeof window !== 'undefined') { ... }` block:

```ts
  // jsdom does not implement URL.createObjectURL / revokeObjectURL.
  // VideoExporter (Plan 6) and the media-meta tests rely on them.
  if (typeof URL.createObjectURL !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = (_b: Blob) => 'blob:stub';
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).revokeObjectURL = (_u: string) => undefined;
  }

  // jsdom's File extends Blob but lacks .arrayBuffer(). Patch the prototype
  // so every File instance gets the polyfill — used by media-meta + future
  // exporter consumers.
  if (typeof window.File !== 'undefined' && typeof window.File.prototype.arrayBuffer !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.File.prototype as any).arrayBuffer = async function (this: File) {
      const buf = await new Response(this).arrayBuffer();
      return buf;
    };
  }

  /**
   * MockMediaRecorder backs Plan 6's VideoExporter tests. The real one is
   * unavailable in jsdom. Captures every method call for assertions and
   * fires `ondataavailable` + `onstop` synchronously when `requestData()` /
   * `stop()` are called — no fake timers needed.
   */
  class MockMediaRecorder {
    static isTypeSupported = vi.fn((type: string) => type.startsWith('video/webm'));
    state: 'inactive' | 'recording' | 'paused' = 'inactive';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    readonly mimeType: string;
    readonly stream: MediaStream;
    constructor(stream: MediaStream, opts?: { mimeType?: string }) {
      this.stream = stream;
      this.mimeType = opts?.mimeType ?? 'video/webm';
    }
    start(_timeslice?: number): void {
      this.state = 'recording';
    }
    stop(): void {
      if (this.state !== 'recording') throw new Error('InvalidStateError');
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob([new Uint8Array([0])], { type: this.mimeType }) });
      this.onstop?.();
    }
    requestData(): void {
      this.ondataavailable?.({ data: new Blob([new Uint8Array([0])], { type: this.mimeType }) });
    }
  }
  // @ts-expect-error — test-only global.
  globalThis.MediaRecorder = MockMediaRecorder;
```

- [ ] **Step 2: Drop the inline stubs from `tests/unit/storage/media-meta.test.ts`**

Remove the `beforeEach` block that patches `URL.createObjectURL`/`revokeObjectURL`,
and the `fileWithBuffer` helper's inline `(f as any).arrayBuffer = ...`. Tests
should still pass because the global setup now covers both.

- [ ] **Step 3: Run regression**

```bash
npm test -- --run
```

Expected: 358 tests still green — no behaviour change, only stub location.

- [ ] **Step 4: Typecheck + lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add vitest.setup.ts tests/unit/storage/media-meta.test.ts
git commit -m "chore(tests): migrate jsdom stubs to vitest.setup.ts + add MediaRecorder mock"
```

---

## Task 2: `AudioEngine.getAudioStream()` public getter

**Files:**
- Modify: `lib/audio/engine.ts`
- Modify: `lib/audio/types.ts` (or wherever `AudioEngine` interface lives)
- Create: `tests/unit/audio/engine-stream.test.ts`

> `streamDest` is currently captured in the engine's closure with no public
> accessor. The exporter needs the MediaStream to combine with the canvas
> capture-stream.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/audio/engine-stream.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createAudioEngine } from '@/lib/audio/engine';

describe('AudioEngine — getAudioStream', () => {
  let engine: ReturnType<typeof createAudioEngine>;

  beforeEach(() => {
    engine = createAudioEngine();
  });

  it('returns null before load() is called', () => {
    expect(engine.getAudioStream()).toBeNull();
  });

  it('returns a MediaStream after load() wires the audio graph', async () => {
    await engine.load('blob:fake-url');
    const stream = engine.getAudioStream();
    expect(stream).not.toBeNull();
    // MockAudioContext's createMediaStreamDestination returns {id:'mock-stream'}.
    expect((stream as MediaStream).id).toBe('mock-stream');
  });
});
```

- [ ] **Step 2: Run, verify fails**

Run: `npm test -- engine-stream --run`
Expected: `engine.getAudioStream is not a function`.

- [ ] **Step 3: Extend the AudioEngine interface**

In `lib/audio/engine.ts` (where `interface AudioEngine` is declared):

```ts
export interface AudioEngine {
  // ... existing methods ...
  getAudioStream(): MediaStream | null;
}
```

- [ ] **Step 4: Implement `getAudioStream` in the factory's returned object**

Inside the returned object literal of `createAudioEngine`, add:

```ts
    getAudioStream(): MediaStream | null {
      return streamDest?.stream ?? null;
    },
```

Place it next to `getAnalyser()` for symmetry.

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test -- engine-stream --run`
Expected: 2 tests green.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean (the existing engine consumers don't break since the
interface only added a method).

- [ ] **Step 7: Commit**

```bash
git add lib/audio/engine.ts tests/unit/audio/engine-stream.test.ts
git commit -m "feat(audio): AudioEngine.getAudioStream() public getter for the recorder"
```

---

## Task 3: Pure helpers — `pickCodec`, `makeFilename`, state types

**Files:**
- Create: `lib/export/types.ts`
- Create: `lib/export/codec.ts`
- Create: `lib/export/filename.ts`
- Create: `lib/export/state-machine.ts`
- Create: `tests/unit/export/codec.test.ts`
- Create: `tests/unit/export/filename.test.ts`
- Create: `tests/unit/export/state-machine.test.ts`

> Four pure modules. All testable in isolation without DOM, MediaRecorder,
> or any I/O.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/export/codec.test.ts
import { describe, it, expect, vi } from 'vitest';
import { pickCodec } from '@/lib/export/codec';

describe('pickCodec', () => {
  it('picks vp9+opus when supported', () => {
    const supports = vi.fn(() => true);
    const r = pickCodec(supports);
    expect(r.mimeType).toBe('video/webm;codecs=vp9,opus');
    expect(r.label).toContain('VP9');
  });

  it('falls through to vp8+opus when vp9 is unsupported', () => {
    const supports = vi.fn((t: string) => !t.includes('vp9'));
    const r = pickCodec(supports);
    expect(r.mimeType).toBe('video/webm;codecs=vp8,opus');
    expect(r.label).toContain('VP8');
  });

  it('falls through to default video/webm when no codec-suffixed type is supported', () => {
    const supports = vi.fn((t: string) => t === 'video/webm');
    const r = pickCodec(supports);
    expect(r.mimeType).toBe('video/webm');
  });

  it('returns a non-empty human label for every path', () => {
    expect(pickCodec(() => true).label.length).toBeGreaterThan(0);
    expect(pickCodec((t) => !t.includes('vp9')).label.length).toBeGreaterThan(0);
    expect(pickCodec((t) => t === 'video/webm').label.length).toBeGreaterThan(0);
  });
});
```

```ts
// tests/unit/export/filename.test.ts
import { describe, it, expect } from 'vitest';
import { makeFilename } from '@/lib/export/filename';

describe('makeFilename', () => {
  it('formats vibegrid_export_<timestamp>.webm', () => {
    const f = makeFilename(new Date('2026-05-20T14:30:00Z'));
    expect(f).toBe('vibegrid_export_2026-05-20T14-30-00.webm');
  });

  it('replaces colons and dots in the ISO with dashes', () => {
    const f = makeFilename(new Date('2026-05-20T14:30:45.123Z'));
    expect(f).not.toContain(':');
    expect(f).not.toContain('.');
    expect(f.endsWith('.webm')).toBe(true);
  });

  it('never contains "undefined" (regression guard for AC-13)', () => {
    expect(makeFilename(new Date())).not.toContain('undefined');
  });
});
```

```ts
// tests/unit/export/state-machine.test.ts
import { describe, it, expect } from 'vitest';
import { EXPORT_INITIAL_STATE, reduceExportState } from '@/lib/export/state-machine';

describe('ExportState', () => {
  it('initial state is idle with zeroed timecodes', () => {
    expect(EXPORT_INITIAL_STATE.status).toBe('idle');
    expect(EXPORT_INITIAL_STATE.progress).toBe(0);
    expect(EXPORT_INITIAL_STATE.elapsedSeconds).toBe(0);
    expect(EXPORT_INITIAL_STATE.totalSeconds).toBe(0);
    expect(EXPORT_INITIAL_STATE.warning).toBeUndefined();
  });

  it('patch-merges and preserves untouched keys', () => {
    const s1 = reduceExportState(EXPORT_INITIAL_STATE, {
      status: 'recording',
      totalSeconds: 90
    });
    const s2 = reduceExportState(s1, { elapsedSeconds: 30 });
    expect(s2.status).toBe('recording');
    expect(s2.totalSeconds).toBe(90);
    expect(s2.elapsedSeconds).toBe(30);
  });

  it('reset back to idle clears elapsed/progress/warning', () => {
    const s1 = reduceExportState(EXPORT_INITIAL_STATE, {
      status: 'recording',
      elapsedSeconds: 30,
      warning: 'tab-hidden'
    });
    const s2 = reduceExportState(s1, { status: 'idle' });
    expect(s2.status).toBe('idle');
    expect(s2.elapsedSeconds).toBe(0);
    expect(s2.progress).toBe(0);
    expect(s2.warning).toBeUndefined();
  });

  it('warning fields can be set without changing status', () => {
    const s = reduceExportState(
      { ...EXPORT_INITIAL_STATE, status: 'recording' },
      { warning: 'performance-degraded' }
    );
    expect(s.status).toBe('recording');
    expect(s.warning).toBe('performance-degraded');
  });
});
```

- [ ] **Step 2: Run, verify all fail**

Run: `npm test -- export --run`
Expected: module not found errors.

- [ ] **Step 3: Implement `lib/export/types.ts`**

```ts
export type ExportStatus =
  | 'idle'
  | 'preparing'
  | 'recording'
  | 'finalizing'
  | 'done'
  | 'error';

export type ExportWarning = 'performance-degraded' | 'tab-hidden';
export type ExportErrorCode =
  | 'no-audio'
  | 'no-image'
  | 'codec-unsupported'
  | 'recorder-failed';

export interface ExportState {
  status: ExportStatus;
  progress: number;          // 0..1
  elapsedSeconds: number;
  totalSeconds: number;
  warning?: ExportWarning;
  errorCode?: ExportErrorCode;
  /** Human-readable codec label, set after pickCodec. Surfaces in the UI. */
  codecLabel?: string;
}

export interface ExportOptions {
  filename: string;
  mimeType: string;
  frameRate: 30 | 60;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
}
```

- [ ] **Step 4: Implement `lib/export/codec.ts`**

```ts
const PREFERENCES = [
  { mimeType: 'video/webm;codecs=vp9,opus', label: 'VP9 + Opus' },
  { mimeType: 'video/webm;codecs=vp8,opus', label: 'VP8 + Opus (Fallback)' },
  { mimeType: 'video/webm', label: 'WebM (browser default)' }
] as const;

export interface PickedCodec {
  mimeType: string;
  label: string;
}

/**
 * Walk the preference list against `isSupported` (defaults to
 * MediaRecorder.isTypeSupported when available) and return the first match.
 * Pure when `isSupported` is provided — used by tests to script outcomes.
 */
export function pickCodec(
  isSupported: (type: string) => boolean = (t) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)
): PickedCodec {
  for (const opt of PREFERENCES) {
    if (isSupported(opt.mimeType)) return { mimeType: opt.mimeType, label: opt.label };
  }
  // No webm support at all — return the last preference and let the
  // recorder fail loudly when start() is called. The UI surfaces this
  // via status='error' / errorCode='codec-unsupported'.
  return { mimeType: PREFERENCES[PREFERENCES.length - 1].mimeType, label: 'WebM (unsupported?)' };
}
```

- [ ] **Step 5: Implement `lib/export/filename.ts`**

```ts
/**
 * Produces "vibegrid_export_<ISO without colons/dots>.webm". The ISO is
 * truncated to seconds (no millis). Accepts an injected Date so tests
 * can pin the timestamp.
 */
export function makeFilename(now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `vibegrid_export_${ts}.webm`;
}
```

- [ ] **Step 6: Implement `lib/export/state-machine.ts`**

```ts
import type { ExportState } from './types';

export const EXPORT_INITIAL_STATE: ExportState = {
  status: 'idle',
  progress: 0,
  elapsedSeconds: 0,
  totalSeconds: 0
};

/**
 * Patch-merge with one structural rule: returning to `idle` clears all
 * derived fields (elapsedSeconds, progress, warning, errorCode). Every
 * other status change preserves the rest of the state.
 */
export function reduceExportState(
  state: ExportState,
  patch: Partial<ExportState>
): ExportState {
  const next = { ...state, ...patch };
  if (patch.status === 'idle' && state.status !== 'idle') {
    next.elapsedSeconds = 0;
    next.progress = 0;
    next.warning = undefined;
    next.errorCode = undefined;
  }
  return next;
}
```

- [ ] **Step 7: Run tests, verify all pass**

Run: `npm test -- export/codec export/filename export/state-machine --run`
Expected: 11 tests green.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 9: Commit**

```bash
git add lib/export/types.ts lib/export/codec.ts lib/export/filename.ts lib/export/state-machine.ts \
        tests/unit/export/codec.test.ts tests/unit/export/filename.test.ts \
        tests/unit/export/state-machine.test.ts
git commit -m "feat(export): pure helpers — pickCodec, makeFilename, state-machine"
```

---

## Task 4: Store — `exportState` + `setExportState` + UI-literal updates

**Files:**
- Modify: `lib/store/types.ts`
- Modify: `lib/store/index.ts`
- Modify: `components/TopBar/ClearProjectButton.tsx`
- Modify: `tests/unit/components/Inspector.test.tsx`
- Modify: `tests/unit/components/AutoPresetButton.test.tsx`
- Modify: `tests/unit/components/Timeline/Clip.test.tsx`
- Modify: `tests/unit/store/ui-state-automation.test.ts`
- Create: `tests/unit/store/export-state.test.ts`

> Strict TS will flag every site that constructs a full `ui: { ... }`
> literal once `exportState` becomes a required `UIState` member. Same
> rollout pattern as `expandedAutomationClipId` (Plan 5.5 Task 3) and
> `automationSnap` (Plan 5.7 Task 2).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/store/export-state.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';

beforeEach(() => {
  useAppStore.setState((s) => ({
    ui: { ...s.ui, exportState: EXPORT_INITIAL_STATE }
  }));
});

describe('exportState store', () => {
  it('default is the initial state (status idle, zeroed)', () => {
    expect(useAppStore.getState().ui.exportState.status).toBe('idle');
    expect(useAppStore.getState().ui.exportState.elapsedSeconds).toBe(0);
  });

  it('setExportState patch-merges single fields', () => {
    useAppStore.getState().setExportState({ status: 'recording', totalSeconds: 90 });
    useAppStore.getState().setExportState({ elapsedSeconds: 30 });
    const s = useAppStore.getState().ui.exportState;
    expect(s.status).toBe('recording');
    expect(s.totalSeconds).toBe(90);
    expect(s.elapsedSeconds).toBe(30);
  });

  it('returning to idle clears derived fields', () => {
    useAppStore.getState().setExportState({
      status: 'recording',
      elapsedSeconds: 30,
      warning: 'tab-hidden'
    });
    useAppStore.getState().setExportState({ status: 'idle' });
    const s = useAppStore.getState().ui.exportState;
    expect(s.elapsedSeconds).toBe(0);
    expect(s.warning).toBeUndefined();
  });

  it('partialize excludes exportState (only zoom persists)', () => {
    if (typeof window === 'undefined') return;
    useAppStore.getState().setExportState({ status: 'recording' });
    const raw = window.localStorage.getItem('vibegrid-store');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    expect(parsed.state.ui?.exportState).toBeUndefined();
    expect(parsed.state.ui?.zoom).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, verify fails**

Run: `npm test -- store/export-state --run`

- [ ] **Step 3: Extend `lib/store/types.ts`**

```ts
import type { ExportState } from '@/lib/export/types';
```

Add to `UIState`:

```ts
exportState: ExportState;
```

Add to `AppState` (top-level, next to `setAutomationSnap`):

```ts
setExportState(patch: Partial<ExportState>): void;
```

- [ ] **Step 4: Wire the action in `lib/store/index.ts`**

Add imports:

```ts
import { EXPORT_INITIAL_STATE, reduceExportState } from '@/lib/export/state-machine';
```

Extend the inline `ui` literal:

```ts
ui: {
  zoom: 1,
  selectedClipId: null,
  automationEditorClipId: null,
  automationSnap: 'off',
  exportState: EXPORT_INITIAL_STATE
},
```

Add the action next to `setAutomationSnap`:

```ts
setExportState: (patch) =>
  set((s) => ({ ui: { ...s.ui, exportState: reduceExportState(s.ui.exportState, patch) } })),
```

Update the partialize comment to mention `exportState`. The `ui: { zoom }`
emit line itself stays.

- [ ] **Step 5: Update the 5 UI-literal sites**

Each site that constructs a full `ui: { ... }` literal must grow
`exportState: EXPORT_INITIAL_STATE`. Grep first:

```bash
grep -rn "automationEditorClipId: null" components/ tests/
```

Files:
- `components/TopBar/ClearProjectButton.tsx`
- `tests/unit/components/Inspector.test.tsx`
- `tests/unit/components/AutoPresetButton.test.tsx`
- `tests/unit/components/Timeline/Clip.test.tsx`
- `tests/unit/store/ui-state-automation.test.ts`

Each `ui: { ... }` literal becomes:

```ts
ui: {
  zoom: 1,
  selectedClipId: null,
  automationEditorClipId: null,
  automationSnap: 'off',
  exportState: EXPORT_INITIAL_STATE
}
```

(Each test file gains an import of `EXPORT_INITIAL_STATE` at the top.)

- [ ] **Step 6: Run tests, verify all pass**

Run: `npm test -- store/export-state --run` (4 green) then
`npm test -- --run` (no regressions).

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npm run lint`

- [ ] **Step 8: Commit**

```bash
git add lib/store/types.ts lib/store/index.ts \
        components/TopBar/ClearProjectButton.tsx \
        tests/unit/components/Inspector.test.tsx \
        tests/unit/components/AutoPresetButton.test.tsx \
        tests/unit/components/Timeline/Clip.test.tsx \
        tests/unit/store/ui-state-automation.test.ts \
        tests/unit/store/export-state.test.ts
git commit -m "feat(store): exportState UI field + setExportState patch action"
```

---

## Task 5: `VideoExporter` factory — pre-checks + start + state transitions

**Files:**
- Create: `lib/export/recorder.ts`
- Create: `tests/unit/export/VideoExporter.test.ts`

> The orchestrator. This task covers the START path (pre-checks, codec
> pick, MediaRecorder construction, status transitions to `recording`).
> The STOP path (Task 6) and CANCEL path (Task 7) follow.

- [ ] **Step 1: Write the failing test (Task 5 portion — pre-checks + start)**

```ts
// tests/unit/export/VideoExporter.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createVideoExporter } from '@/lib/export/recorder';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';
import type { ExportState } from '@/lib/export/types';
import type { TimelineState } from '@/lib/timeline/types';
import type { MediaRef } from '@/lib/storage/types';

// Minimal canvas stub that exposes captureStream — jsdom doesn't have it.
function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (c as any).captureStream = vi.fn((_fps?: number) =>
    ({ getVideoTracks: () => [{ kind: 'video' }] }) as unknown as MediaStream
  );
  return c;
}

function makeAudioEngine(stream: MediaStream | null = { id: 'audio-stream' } as MediaStream) {
  return {
    getAudioStream: () => stream,
    getState: () => ({ status: 'ready', currentTime: 0, duration: 60, beatGrid: {} as never }),
    pause: vi.fn(),
    play: vi.fn(),
    seek: vi.fn()
  } as unknown as Parameters<typeof createVideoExporter>[0]['audioEngine'];
}

const audioMediaRef: MediaRef = {
  id: 'a1',
  url: 'blob:audio',
  kind: 'audio',
  filename: 'song.mp3',
  size: 1,
  uploadedAt: 0,
  duration: 60
};

const timelineWithImage: TimelineState = {
  tracks: [{ id: 'track-image', kind: 'image', name: 'Image', muted: false, order: 0 }],
  clips: [
    {
      id: 'img1',
      trackId: 'track-image',
      kind: 'image',
      mediaId: 'img-media',
      startBeat: 0,
      lengthBeats: 256,
      label: 'cover.jpg'
    }
  ],
  playhead: { beats: 0, playing: false },
  zoom: 1,
  snap: 'beat'
};

const timelineEmpty: TimelineState = {
  ...timelineWithImage,
  clips: []
};

let states: ExportState[];
const setExportState = vi.fn((patch: Partial<ExportState>) => {
  const last = states[states.length - 1] ?? EXPORT_INITIAL_STATE;
  states.push({ ...last, ...patch });
});

beforeEach(() => {
  states = [EXPORT_INITIAL_STATE];
  setExportState.mockClear();
});

describe('VideoExporter — pre-checks + start', () => {
  it('start with all pre-checks satisfied transitions to recording', async () => {
    const exp = createVideoExporter({
      canvas: makeCanvas(),
      audioEngine: makeAudioEngine(),
      getTimeline: () => timelineWithImage,
      getAudioMediaRef: () => audioMediaRef,
      setExportState
    });
    await exp!.start();
    expect(states.some((s) => s.status === 'preparing')).toBe(true);
    expect(states.some((s) => s.status === 'recording')).toBe(true);
    expect(states[states.length - 1].codecLabel).toContain('VP9');
  });

  it('start without audio MediaRef → status=error, errorCode=no-audio', async () => {
    const exp = createVideoExporter({
      canvas: makeCanvas(),
      audioEngine: makeAudioEngine(),
      getTimeline: () => timelineWithImage,
      getAudioMediaRef: () => null,
      setExportState
    });
    await exp!.start();
    const last = states[states.length - 1];
    expect(last.status).toBe('error');
    expect(last.errorCode).toBe('no-audio');
  });

  it('start without an active image clip → status=error, errorCode=no-image', async () => {
    const exp = createVideoExporter({
      canvas: makeCanvas(),
      audioEngine: makeAudioEngine(),
      getTimeline: () => timelineEmpty,
      getAudioMediaRef: () => audioMediaRef,
      setExportState
    });
    await exp!.start();
    const last = states[states.length - 1];
    expect(last.status).toBe('error');
    expect(last.errorCode).toBe('no-image');
  });

  it('start without an audio stream from the engine → status=error', async () => {
    const exp = createVideoExporter({
      canvas: makeCanvas(),
      audioEngine: makeAudioEngine(null),
      getTimeline: () => timelineWithImage,
      getAudioMediaRef: () => audioMediaRef,
      setExportState
    });
    await exp!.start();
    expect(states[states.length - 1].status).toBe('error');
  });

  it('codec-fallback picks vp8 when vp9 is unsupported', async () => {
    // Override the global MockMediaRecorder.isTypeSupported just for this case.
    const orig = (globalThis as { MediaRecorder: { isTypeSupported: (t: string) => boolean } })
      .MediaRecorder.isTypeSupported;
    (globalThis as { MediaRecorder: { isTypeSupported: (t: string) => boolean } })
      .MediaRecorder.isTypeSupported = (t: string) => !t.includes('vp9');
    try {
      const exp = createVideoExporter({
        canvas: makeCanvas(),
        audioEngine: makeAudioEngine(),
        getTimeline: () => timelineWithImage,
        getAudioMediaRef: () => audioMediaRef,
        setExportState
      });
      await exp!.start();
      expect(states[states.length - 1].codecLabel).toContain('VP8');
    } finally {
      (globalThis as { MediaRecorder: { isTypeSupported: (t: string) => boolean } })
        .MediaRecorder.isTypeSupported = orig;
    }
  });
});
```

- [ ] **Step 2: Run, verify fails**

Run: `npm test -- export/VideoExporter --run`

- [ ] **Step 3: Implement `lib/export/recorder.ts` (pre-checks + start)**

```ts
import { isClient } from '@/lib/utils/is-client';
import { activeImageClips } from '@/lib/timeline/selectors';
import { pickCodec } from './codec';
import { makeFilename } from './filename';
import type { ExportState } from './types';
import type { AudioEngine } from '@/lib/audio/engine';
import type { TimelineState } from '@/lib/timeline/types';
import type { MediaRef } from '@/lib/storage/types';

const VIDEO_BITRATE = 6_000_000;
const AUDIO_BITRATE = 128_000;
const FRAME_RATE = 30;
const CHUNK_MS = 500;

export interface VideoExporterDeps {
  canvas: HTMLCanvasElement;
  audioEngine: AudioEngine;
  /** Fresh-read getter — captured `timeline` would go stale between hook
   *  mount and export start. Same pattern as the renderer's getTimelineState. */
  getTimeline(): TimelineState;
  /** Fresh-read getter — captured `audioMediaRef` at hook mount time would
   *  always be null because the hook initialises BEFORE the user uploads
   *  any audio. Reading via the getter at start() picks up the latest. */
  getAudioMediaRef(): MediaRef | null;
  setExportState(patch: Partial<ExportState>): void;
}

export interface VideoExporter {
  start(): Promise<void>;
  cancel(): void;
}

export function createVideoExporter(deps: VideoExporterDeps): VideoExporter | null {
  if (!isClient()) return null;

  // These are populated by start() and read by cancel() / the stop trigger.
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let safetyInterval: ReturnType<typeof setInterval> | null = null;
  let onEndedListener: (() => void) | null = null;

  async function start(): Promise<void> {
    if (recorder) return; // already running

    // Pre-checks (Spec §8.1.1). Read via getters — never cache.
    const audioMediaRef = deps.getAudioMediaRef();
    if (!audioMediaRef) {
      deps.setExportState({ status: 'error', errorCode: 'no-audio' });
      return;
    }
    const imageClips = activeImageClips(deps.getTimeline(), 0);
    if (imageClips.length === 0) {
      deps.setExportState({ status: 'error', errorCode: 'no-image' });
      return;
    }
    const audioStream = deps.audioEngine.getAudioStream();
    if (!audioStream) {
      deps.setExportState({ status: 'error', errorCode: 'no-audio' });
      return;
    }

    deps.setExportState({ status: 'preparing' });

    const codec = pickCodec();
    if (!MediaRecorder.isTypeSupported(codec.mimeType)) {
      deps.setExportState({ status: 'error', errorCode: 'codec-unsupported' });
      return;
    }

    const videoStream = (deps.canvas as HTMLCanvasElement & {
      captureStream: (fps: number) => MediaStream;
    }).captureStream(FRAME_RATE);
    const videoTrack = videoStream.getVideoTracks()[0];
    const audioTrack = audioStream.getAudioTracks?.()[0];
    const combined = new MediaStream(
      [videoTrack, audioTrack].filter((t): t is MediaStreamTrack => Boolean(t))
    );

    try {
      recorder = new MediaRecorder(combined, {
        mimeType: codec.mimeType,
        videoBitsPerSecond: VIDEO_BITRATE,
        audioBitsPerSecond: AUDIO_BITRATE
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[VideoExporter] MediaRecorder construction failed:', err);
      deps.setExportState({ status: 'error', errorCode: 'recorder-failed' });
      return;
    }

    chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    // onstop + safety interval wiring lives in Task 6 — declared here so
    // Task 5 alone produces a runnable recording (just no stop/download).

    deps.setExportState({
      status: 'recording',
      totalSeconds: audioMediaRef.duration ?? 0,
      elapsedSeconds: 0,
      codecLabel: codec.label
    });

    recorder.start(CHUNK_MS);
  }

  function cancel(): void {
    // Full cancel wiring in Task 7. Stub here so the API is complete.
    if (safetyInterval) {
      clearInterval(safetyInterval);
      safetyInterval = null;
    }
    if (recorder && recorder.state === 'recording') {
      try {
        recorder.stop();
      } catch {
        /* ignore — already stopped */
      }
    }
    recorder = null;
    chunks = [];
    onEndedListener = null;
    deps.setExportState({ status: 'idle' });
  }

  return { start, cancel };
}
```

- [ ] **Step 4: Run tests, verify 5 pre-check + codec-fallback tests pass**

Run: `npm test -- export/VideoExporter --run`
Expected: 5 tests green.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`

- [ ] **Step 6: Commit**

```bash
git add lib/export/recorder.ts tests/unit/export/VideoExporter.test.ts
git commit -m "feat(export): VideoExporter pre-checks + start (state transitions, codec)"
```

---

## Task 6: Stop trigger (dual: ended + safety interval) + download + URL.revoke

**Files:**
- Modify: `lib/export/recorder.ts`
- Modify: `tests/unit/export/VideoExporter.test.ts`

> Add the STOP path. Audio `ended` is the primary trigger; a 200 ms
> `setInterval` is the safety net. Whichever fires first must tear down
> the other (no double-stop).

- [ ] **Step 1: Extend the test file with stop tests**

Append to `tests/unit/export/VideoExporter.test.ts`:

```ts
import { _resetExporterTestsForVitest } from '@/lib/export/recorder';

describe('VideoExporter — stop + download', () => {
  it("stop via audioEl 'ended' fires recorder.stop() + assembles blob + creates download anchor", async () => {
    // Setup with an audioEl-spying engine.
    const audioEl = document.createElement('audio');
    Object.defineProperty(audioEl, 'duration', { value: 5, configurable: true });
    Object.defineProperty(audioEl, 'currentTime', {
      value: 0,
      writable: true,
      configurable: true
    });
    const engine = makeAudioEngine();
    (engine as unknown as { getAudioElement: () => HTMLAudioElement }).getAudioElement =
      () => audioEl;

    // Spy URL.createObjectURL to verify the anchor href.
    const createSpy = vi.spyOn(URL, 'createObjectURL');
    const exp = createVideoExporter({
      canvas: makeCanvas(),
      audioEngine: engine,
      getTimeline: () => timelineWithImage,
      getAudioMediaRef: () => audioMediaRef,
      setExportState
    });
    await exp!.start();

    // Fire the 'ended' event — primary trigger.
    audioEl.dispatchEvent(new Event('ended'));
    // Allow microtasks (blob assembly + anchor click).
    await Promise.resolve();
    await Promise.resolve();

    expect(states.some((s) => s.status === 'finalizing')).toBe(true);
    expect(states[states.length - 1].status).toBe('done');
    expect(createSpy).toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('stop via safety interval also fires when currentTime >= duration - 0.1', async () => {
    vi.useFakeTimers();
    try {
      const audioEl = document.createElement('audio');
      Object.defineProperty(audioEl, 'duration', { value: 5, configurable: true });
      let ct = 0;
      Object.defineProperty(audioEl, 'currentTime', {
        get: () => ct,
        configurable: true
      });
      const engine = makeAudioEngine();
      (engine as unknown as { getAudioElement: () => HTMLAudioElement }).getAudioElement =
        () => audioEl;

      const exp = createVideoExporter({
        canvas: makeCanvas(),
        audioEngine: engine,
        getTimeline: () => timelineWithImage,
        getAudioMediaRef: () => audioMediaRef,
        setExportState
      });
      await exp!.start();

      // Advance currentTime past duration-0.1 then let the safety interval poll.
      ct = 4.95;
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
      expect(states[states.length - 1].status).toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });

  it('URL.revokeObjectURL is scheduled with ~10 s delay (not immediate)', async () => {
    vi.useFakeTimers();
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    try {
      const audioEl = document.createElement('audio');
      Object.defineProperty(audioEl, 'duration', { value: 5, configurable: true });
      Object.defineProperty(audioEl, 'currentTime', { value: 5, configurable: true });
      const engine = makeAudioEngine();
      (engine as unknown as { getAudioElement: () => HTMLAudioElement }).getAudioElement =
        () => audioEl;

      const exp = createVideoExporter({
        canvas: makeCanvas(),
        audioEngine: engine,
        getTimeline: () => timelineWithImage,
        getAudioMediaRef: () => audioMediaRef,
        setExportState
      });
      await exp!.start();
      audioEl.dispatchEvent(new Event('ended'));
      await Promise.resolve();
      await Promise.resolve();
      expect(revokeSpy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(10_100);
      expect(revokeSpy).toHaveBeenCalled();
    } finally {
      revokeSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

afterEach(() => {
  _resetExporterTestsForVitest();
});
```

> The new dep `getAudioElement` on AudioEngine: add it to the interface in
> this task too. Alternative: pass a `getAudioElement` factory in deps.
> The plan uses the engine-method form because it matches `getAudioStream`.

- [ ] **Step 2a: Grep for existing AudioEngine stub/mock objects**

Adding `getAudioElement()` to the `AudioEngine` interface will TS-break
every inline mock object that satisfies the type. Find them all first:

```bash
grep -rn "createAudioEngine\|: AudioEngine\b" tests/ \
  --include="*.ts" --include="*.tsx"
```

For each match where a test constructs an inline mock (e.g. `const engine =
{ load: ..., play: ... } as AudioEngine`), add a `getAudioElement: () => null`
(or a real `<audio>` element when the test needs the dual-stop path). The
existing `getAudioStream` mock added in Task 2 lives next to it — same
pattern.

After this step the TS-typecheck run in Step 5 should report only the
recorder/test-file changes from this Task.

- [ ] **Step 2b: Add `getAudioElement()` to the AudioEngine interface**

`lib/audio/engine.ts`:

```ts
export interface AudioEngine {
  // ... existing ...
  getAudioElement(): HTMLAudioElement | null;
}
```

Implementation in the factory's returned object:

```ts
getAudioElement(): HTMLAudioElement | null {
  return audioEl;
},
```

(Place next to `getAudioStream`.)

- [ ] **Step 3: Extend `lib/export/recorder.ts` with the stop wiring**

Replace the `// onstop + safety interval wiring lives in Task 6` comment
block with:

```ts
    recorder.onstop = () => {
      // Tear down both stop triggers — whichever didn't fire yet would
      // otherwise try to call stop() on an already-stopped recorder.
      if (safetyInterval) {
        clearInterval(safetyInterval);
        safetyInterval = null;
      }
      const audioEl = deps.audioEngine.getAudioElement();
      if (audioEl && onEndedListener) {
        audioEl.removeEventListener('ended', onEndedListener);
        onEndedListener = null;
      }

      deps.setExportState({ status: 'finalizing' });

      const blob = new Blob(chunks, { type: codec.mimeType });
      chunks = [];
      const url = URL.createObjectURL(blob);
      const filename = makeFilename();
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      // 10 s delay — Spec §8.1.7 — give the browser time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      deps.setExportState({ status: 'done' });
      // Auto-reset to idle after 2 s so the next export can start.
      setTimeout(() => deps.setExportState({ status: 'idle' }), 2_000);
      recorder = null;
    };

    // Primary stop trigger: audio element 'ended' event.
    const audioEl = deps.audioEngine.getAudioElement();
    if (audioEl) {
      onEndedListener = () => {
        if (recorder && recorder.state === 'recording') recorder.stop();
      };
      audioEl.addEventListener('ended', onEndedListener, { once: true });
    }

    // Safety net: poll currentTime in case 'ended' fails to fire.
    safetyInterval = setInterval(() => {
      const el = deps.audioEngine.getAudioElement();
      if (!el) return;
      if (el.currentTime >= (el.duration ?? Infinity) - 0.1) {
        if (recorder && recorder.state === 'recording') recorder.stop();
      }
    }, 200);
```

Also add the test helper at the bottom of the file:

```ts
/** @internal — vitest afterEach reset. Clears any module-level state in
 *  case a future refactor introduces it. Currently a no-op. */
export function _resetExporterTestsForVitest(): void {
  /* no module state today; keep the hook for forward-compatibility */
}
```

- [ ] **Step 4: Run tests, verify stop + download tests pass**

Run: `npm test -- export/VideoExporter --run`
Expected: 8 tests green (5 from Task 5 + 3 new).

- [ ] **Step 5: Run full suite — no regressions**

Run: `npm test -- --run`

- [ ] **Step 6: Typecheck + lint + commit**

```bash
npm run typecheck && npm run lint
git add lib/export/recorder.ts lib/audio/engine.ts \
        tests/unit/export/VideoExporter.test.ts
git commit -m "feat(export): dual-trigger stop + WebM download + URL.revoke after 10s"
```

---

## Task 7: Cancel + pause Audio + Playhead reset

**Files:**
- Modify: `lib/export/recorder.ts`
- Modify: `tests/unit/export/VideoExporter.test.ts`

> Cancel must stop the recorder, drop the chunks (no blob assembly), pause
> the audio engine, reset the playhead to 0, and clean up both stop triggers
> without firing the download.

- [ ] **Step 1: Extend the test file**

Append a new `describe`:

```ts
describe('VideoExporter — cancel', () => {
  it('cancel during recording → status=idle, no download anchor created', async () => {
    const audioEl = document.createElement('audio');
    Object.defineProperty(audioEl, 'duration', { value: 60, configurable: true });
    Object.defineProperty(audioEl, 'currentTime', { value: 0, configurable: true });
    const engine = makeAudioEngine();
    (engine as unknown as { getAudioElement: () => HTMLAudioElement }).getAudioElement =
      () => audioEl;

    const createSpy = vi.spyOn(URL, 'createObjectURL');
    const exp = createVideoExporter({
      canvas: makeCanvas(),
      audioEngine: engine,
      getTimeline: () => timelineWithImage,
      getAudioMediaRef: () => audioMediaRef,
      setExportState
    });
    await exp!.start();
    exp!.cancel();
    await Promise.resolve();
    expect(states[states.length - 1].status).toBe('idle');
    expect(createSpy).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('cancel removes the audioEl ended listener (no spurious second stop)', async () => {
    const audioEl = document.createElement('audio');
    Object.defineProperty(audioEl, 'duration', { value: 60, configurable: true });
    Object.defineProperty(audioEl, 'currentTime', { value: 0, configurable: true });
    const engine = makeAudioEngine();
    (engine as unknown as { getAudioElement: () => HTMLAudioElement }).getAudioElement =
      () => audioEl;

    const exp = createVideoExporter({
      canvas: makeCanvas(),
      audioEngine: engine,
      getTimeline: () => timelineWithImage,
      getAudioMediaRef: () => audioMediaRef,
      setExportState
    });
    await exp!.start();
    exp!.cancel();
    // Now fire 'ended' — must be a no-op.
    audioEl.dispatchEvent(new Event('ended'));
    await Promise.resolve();
    expect(states[states.length - 1].status).toBe('idle');
  });
});
```

- [ ] **Step 2: Extend `cancel()` in `lib/export/recorder.ts`**

Replace the Task-5 stub `cancel` with:

```ts
  function cancel(): void {
    // Tear down the safety interval first so it can't fire after we null
    // the recorder reference.
    if (safetyInterval) {
      clearInterval(safetyInterval);
      safetyInterval = null;
    }

    // Remove the audio 'ended' listener — without this, audio reaching its
    // natural end after cancel would trigger another stop() on a recorder
    // that no longer exists.
    const audioEl = deps.audioEngine.getAudioElement();
    if (audioEl && onEndedListener) {
      audioEl.removeEventListener('ended', onEndedListener);
      onEndedListener = null;
    }

    // Disable onstop BEFORE calling stop() — we don't want the finalizing
    // path to fire (no blob, no download).
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      if (recorder.state === 'recording') {
        try {
          recorder.stop();
        } catch {
          /* recorder already stopped */
        }
      }
      recorder = null;
    }

    // Pause + rewind so the next Export starts cleanly from beat 0.
    deps.audioEngine.pause();
    deps.audioEngine.seek(0);

    chunks = [];
    deps.setExportState({ status: 'idle' });
  }
```

- [ ] **Step 3: Run tests, verify pass**

Run: `npm test -- export/VideoExporter --run`
Expected: 10 tests green (8 + 2 cancel).

- [ ] **Step 4: Commit**

```bash
git add lib/export/recorder.ts tests/unit/export/VideoExporter.test.ts
git commit -m "feat(export): cancel cleanup — drop blob, remove listeners, reset audio"
```

---

## Task 8: `ExportButton` rewrite — pre-check-aware disabled state

**Files:**
- Rewrite: `components/TopBar/ExportButton.tsx`
- Modify: `components/TopBar/index.tsx` (pass engine + canvas refs / start callback)
- Create: `tests/unit/components/TopBar/ExportButton.test.tsx`

> Disabled when status !== 'idle', no audio MediaRef, OR no image clip
> active at beat 0. Click delegates to a `start()` callback (injected by
> the parent — actual VideoExporter wiring happens via the hook in Task 10).

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/TopBar/ExportButton.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { ExportButton } from '@/components/TopBar/ExportButton';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';

const AUDIO_REF = {
  id: 'a1',
  url: 'blob:a',
  kind: 'audio' as const,
  filename: 'song.mp3',
  size: 1,
  uploadedAt: 0,
  duration: 60
};

beforeEach(() => {
  useAppStore.setState((s) => ({
    media: { ...s.media, mediaRefs: [AUDIO_REF] },
    timeline: {
      ...s.timeline,
      clips: [
        {
          id: 'img1',
          trackId: 'track-image',
          kind: 'image',
          mediaId: 'img-media',
          startBeat: 0,
          lengthBeats: 256,
          label: 'cover.jpg'
        }
      ]
    },
    ui: { ...s.ui, exportState: EXPORT_INITIAL_STATE }
  }));
});

describe('ExportButton', () => {
  it('is enabled when status=idle + audio + image clip are all present', () => {
    const start = vi.fn();
    render(<ExportButton onStart={start} />);
    expect(screen.getByRole('button', { name: /export/i })).not.toBeDisabled();
  });

  it('is disabled when no audio MediaRef is present', () => {
    useAppStore.setState((s) => ({ media: { ...s.media, mediaRefs: [] } }));
    render(<ExportButton onStart={vi.fn()} />);
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });

  it('is disabled when no active image clip at beat 0', () => {
    useAppStore.setState((s) => ({ timeline: { ...s.timeline, clips: [] } }));
    render(<ExportButton onStart={vi.fn()} />);
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });

  it('is disabled when exportState.status is not idle', () => {
    useAppStore.getState().setExportState({ status: 'recording' });
    render(<ExportButton onStart={vi.fn()} />);
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });

  it('click calls onStart when enabled', () => {
    const start = vi.fn();
    render(<ExportButton onStart={start} />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(start).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Rewrite `components/TopBar/ExportButton.tsx`**

```tsx
'use client';
import { useAppStore } from '@/lib/store';
import { activeImageClips } from '@/lib/timeline/selectors';
import { Button } from '@/components/ui/Button';

export function ExportButton({ onStart }: { onStart: () => void }) {
  const status = useAppStore((s) => s.ui.exportState.status);
  const mediaRefs = useAppStore((s) => s.media.mediaRefs);
  const timeline = useAppStore((s) => s.timeline);

  const hasAudio = mediaRefs.some((m) => m.kind === 'audio' && m.url);
  const hasImageAtZero = activeImageClips(timeline, 0).length > 0;
  const busy = status !== 'idle';
  const disabled = busy || !hasAudio || !hasImageAtZero;

  let title = 'Export the project as WebM';
  if (!hasAudio) title = 'Upload an audio file first';
  else if (!hasImageAtZero) title = 'Place an image clip starting at beat 0';
  else if (busy) title = 'Export in progress';

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={disabled}
      onClick={onStart}
      title={title}
    >
      Export
    </Button>
  );
}
```

- [ ] **Step 3: Run tests, verify pass**

Run: `npm test -- ExportButton --run`
Expected: 5 tests green.

- [ ] **Step 4: Typecheck + commit**

```bash
git add components/TopBar/ExportButton.tsx tests/unit/components/TopBar/ExportButton.test.tsx
git commit -m "feat(topbar): ExportButton with pre-check-aware disabled state"
```

---

## Task 9: `RecIndicator` rewrite — timecode + cancel

**Files:**
- Rewrite: `components/TopBar/RecIndicator.tsx`
- Create: `tests/unit/components/TopBar/RecIndicator.test.tsx`

> Visible only when `status === 'recording'`. Red pulsing dot + `MM:SS / MM:SS`
> timecode + ✕ button.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/TopBar/RecIndicator.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { RecIndicator } from '@/components/TopBar/RecIndicator';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';

beforeEach(() => {
  useAppStore.setState((s) => ({
    ui: { ...s.ui, exportState: EXPORT_INITIAL_STATE }
  }));
});

describe('RecIndicator', () => {
  it('is not rendered when status === idle', () => {
    const { container } = render(<RecIndicator onCancel={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows MM:SS / MM:SS timecode when status === recording', () => {
    useAppStore.getState().setExportState({
      status: 'recording',
      elapsedSeconds: 14,
      totalSeconds: 90
    });
    render(<RecIndicator onCancel={vi.fn()} />);
    expect(screen.getByText(/0:14 \/ 1:30/)).toBeDefined();
  });

  it('✕ button calls the onCancel prop', () => {
    useAppStore.getState().setExportState({ status: 'recording' });
    const cancel = vi.fn();
    render(<RecIndicator onCancel={cancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel export/i }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Rewrite `components/TopBar/RecIndicator.tsx`**

```tsx
'use client';
import { useAppStore } from '@/lib/store';

function formatMMSS(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function RecIndicator({ onCancel }: { onCancel: () => void }) {
  const status = useAppStore((s) => s.ui.exportState.status);
  const elapsed = useAppStore((s) => s.ui.exportState.elapsedSeconds);
  const total = useAppStore((s) => s.ui.exportState.totalSeconds);

  if (status !== 'recording') return null;

  return (
    <div className="flex items-center gap-2 px-2">
      <span
        aria-label="Recording"
        className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse"
      />
      <span className="font-mono text-xs text-[var(--text)]">
        REC {formatMMSS(elapsed)} / {formatMMSS(total)}
      </span>
      <button
        type="button"
        aria-label="Cancel export"
        onClick={onCancel}
        className="h-6 w-6 rounded text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-3)]"
        title="Cancel export"
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Run tests, verify pass + commit**

Run: `npm test -- RecIndicator --run`
Expected: 3 tests green.

```bash
git add components/TopBar/RecIndicator.tsx tests/unit/components/TopBar/RecIndicator.test.tsx
git commit -m "feat(topbar): RecIndicator with timecode + cancel button"
```

---

## Task 10: `useVideoExporter` hook — wires everything together

**Files:**
- Create: `lib/hooks/useVideoExporter.ts`
- Modify: `components/TopBar/index.tsx`

> Owns one VideoExporter instance per Workspace mount. Listens to
> `exportState` to drive the elapsed-seconds tick (1 Hz interval) and the
> visibility-change toast.

- [ ] **Step 1: Implement `lib/hooks/useVideoExporter.ts`**

```ts
'use client';
import { useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { createVideoExporter, type VideoExporter } from '@/lib/export/recorder';
import type { AudioEngine } from '@/lib/audio/engine';

export interface UseVideoExporterArgs {
  canvas: HTMLCanvasElement | null;
  audioEngine: AudioEngine | null;
}

export function useVideoExporter({ canvas, audioEngine }: UseVideoExporterArgs) {
  const setExportState = useAppStore((s) => s.setExportState);
  const exporterRef = useRef<VideoExporter | null>(null);
  const codecToastedRef = useRef(false);

  // Build / rebuild the exporter when canvas + engine become available.
  // audioMediaRef is read fresh on each start() via getAudioMediaRef —
  // capturing it here would freeze at the hook's mount time (when the
  // user hasn't uploaded any audio yet), guaranteeing the first export
  // attempt fails with 'no-audio'.
  useEffect(() => {
    if (!canvas || !audioEngine) {
      exporterRef.current = null;
      return;
    }
    exporterRef.current = createVideoExporter({
      canvas,
      audioEngine,
      getTimeline: () => useAppStore.getState().timeline,
      getAudioMediaRef: () =>
        useAppStore.getState().media.mediaRefs.find((m) => m.kind === 'audio') ?? null,
      setExportState
    });
    return () => {
      exporterRef.current?.cancel();
      exporterRef.current = null;
    };
  }, [canvas, audioEngine, setExportState]);

  // Elapsed-seconds + progress tick (1 Hz) — only while recording.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const sub = useAppStore.subscribe((state, prev) => {
      const was = prev.ui.exportState.status;
      const is = state.ui.exportState.status;
      if (is === 'recording' && was !== 'recording') {
        intervalId = setInterval(() => {
          const s = useAppStore.getState().ui.exportState;
          const nextElapsed = s.elapsedSeconds + 1;
          setExportState({
            elapsedSeconds: nextElapsed,
            // Keep progress in sync so any consumer (v0.2 progress bar
            // included) can read it straight from the store.
            progress: s.totalSeconds > 0 ? nextElapsed / s.totalSeconds : 0
          });
        }, 1000);
      } else if (is !== 'recording' && intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    });
    return () => {
      sub();
      if (intervalId) clearInterval(intervalId);
    };
  }, [setExportState]);

  // Codec label toast (Spec §8.1.1 — show the user what they got).
  useEffect(() => {
    const sub = useAppStore.subscribe((state, prev) => {
      const label = state.ui.exportState.codecLabel;
      const prevLabel = prev.ui.exportState.codecLabel;
      if (label && label !== prevLabel && !codecToastedRef.current) {
        codecToastedRef.current = true;
        toast.info(`Export codec: ${label}`);
      }
      if (state.ui.exportState.status === 'idle') {
        codecToastedRef.current = false; // ready for the next export
      }
    });
    return sub;
  }, []);

  // Tab-visibility persistent warning (Spec §8.1.5).
  useEffect(() => {
    let toastId: string | number | null = null;
    const onVis = () => {
      const status = useAppStore.getState().ui.exportState.status;
      if (status !== 'recording') return;
      if (document.hidden) {
        setExportState({ warning: 'tab-hidden' });
        toastId = toast.warning(
          'Tab im Hintergrund — Export-Qualität beeinträchtigt. Tab aktiv halten!',
          { duration: Infinity }
        );
      } else {
        if (toastId !== null) {
          toast.dismiss(toastId);
          toastId = null;
        }
        setExportState({ warning: undefined });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (toastId !== null) toast.dismiss(toastId);
    };
  }, [setExportState]);

  // FPS performance monitor — one-shot warning at < 24 fps avg (60-frame window).
  useEffect(() => {
    let rafId = 0;
    let lastT = performance.now();
    const window: number[] = [];
    let warned = false;
    const tick = () => {
      const status = useAppStore.getState().ui.exportState.status;
      const now = performance.now();
      const dt = now - lastT;
      lastT = now;
      if (status === 'recording') {
        window.push(dt);
        if (window.length > 60) window.shift();
        const avgMs = window.reduce((a, b) => a + b, 0) / window.length;
        const fps = 1000 / avgMs;
        if (!warned && window.length >= 60 && fps < 24) {
          warned = true;
          setExportState({ warning: 'performance-degraded' });
          toast.warning('Performance dropped — export may have dropped frames');
        }
      } else {
        window.length = 0;
        warned = false;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [setExportState]);

  const api = useMemo(
    () => ({
      start: () => exporterRef.current?.start(),
      cancel: () => exporterRef.current?.cancel()
    }),
    []
  );

  return api;
}
```

- [ ] **Step 2: Wire into `components/TopBar/index.tsx`**

The TopBar needs `canvas` (from Stage) and `audioEngine`. Two options:

- Pass them down from `Workspace` through `TopBar` props (cleanest).
- Or: store the canvas ref in the store + read from there (more coupling).

Recommend Option A. Update `components/Workspace/index.tsx` to forward
the canvas ref + engine to `TopBar`. Then `TopBar` instantiates the hook:

```tsx
'use client';
import { Transport } from './Transport';
import { BPMBadge } from './BPMBadge';
import { ExportButton } from './ExportButton';
import { RecIndicator } from './RecIndicator';
import { ClearProjectButton } from './ClearProjectButton';
import { useVideoExporter } from '@/lib/hooks/useVideoExporter';
import type { AudioEngine } from '@/lib/audio/engine';

export function TopBar({
  engine,
  canvas
}: {
  engine: AudioEngine | null;
  canvas: HTMLCanvasElement | null;
}) {
  const exporter = useVideoExporter({ canvas, audioEngine: engine });
  return (
    <header className="h-12 px-3 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-1)]">
      <div className="flex items-center gap-3">
        <Transport engine={engine} />
        <BPMBadge />
      </div>
      <div className="flex items-center gap-2">
        <RecIndicator onCancel={() => exporter.cancel()} />
        <ClearProjectButton />
        <ExportButton onStart={() => exporter.start()} />
      </div>
    </header>
  );
}
```

> Canvas-ref plumbing: prop-drill from `Workspace` → `TopBar` (and from
> `Workspace` → `Stage` for the renderer). `Workspace` already owns the
> ref; passing it both directions is two extra lines and one extra prop.
> A module-singleton "canvas-ref store" was considered and rejected —
> globals break SSR, fight StrictMode double-mount, and force `isClient()`
> guards into every consumer.

- [ ] **Step 3: Run full suite — no regressions**

Run: `npm test -- --run`

- [ ] **Step 4: Typecheck + lint + commit**

```bash
npm run typecheck && npm run lint
git add lib/hooks/useVideoExporter.ts components/TopBar/index.tsx \
        components/Workspace/index.tsx
git commit -m "feat(export): useVideoExporter hook — wires codec toast, FPS warn, tab-hidden warn"
```

---

## Task 11: `KNOWN_LIMITATIONS.md` — fill in Export section

**Files:**
- Modify: `KNOWN_LIMITATIONS.md`

- [ ] **Step 1: Locate the placeholder section**

```bash
grep -n "Export" KNOWN_LIMITATIONS.md
```

- [ ] **Step 2: Replace the placeholder with concrete text**

```markdown
## Export (Plan 6)

- **Realtime constraint.** Export plays the entire audio through and records
  in real time — a 3-minute song takes 3 minutes to export. There is no
  faster-than-realtime offline render in v0.1.
- **Tab focus required.** When the browser tab is in the background, the
  browser throttles `requestAnimationFrame` to 1 Hz. We detect this with
  `visibilitychange` and surface a persistent warning toast, but the
  export keeps running and will likely have dropped frames. Keep the tab
  active for clean output.
- **WebM only, no iOS Safari playback.** v0.1 produces WebM (VP9 or VP8 +
  Opus). iOS Safari does not natively play WebM. The v0.2 Capacitor build
  will need MP4 / WebCodecs.
- **Codec varies by browser.** Chrome / Edge / Firefox all support
  `video/webm;codecs=vp9,opus`. Safari Desktop sometimes falls back to
  `vp8,opus` — the UI toasts the selected codec at the start of every
  export so the user knows what they have.
- **No quality/bitrate UI.** Bitrate is fixed at 6 Mbps video + 128 Kbps
  audio in v0.1. The exporter renders at 30 fps regardless of zoom or
  device pixel ratio.
- **Single-image-clip-at-beat-0 requirement.** The Export button is
  disabled when no image clip starts at beat 0. The exporter would
  otherwise produce a black opening frame.
```

- [ ] **Step 3: Commit**

```bash
git add KNOWN_LIMITATIONS.md
git commit -m "docs(limitations): fill in the Export Pipeline section"
```

---

## Task 12: Verification gate

**Files:** none

- [ ] **Step 1: Full gate**

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Expected:
- typecheck: clean
- lint: clean
- test: ≥ 385 tests green (358 baseline + 27 new minimum: 4 codec + 3
  filename + 4 state-machine + 8 VideoExporter + 2 engine-stream + 4
  export-state + 5 ExportButton + 3 RecIndicator = 33; conservative
  ≥ 385 leaves room for minor adjustments)
- build: studio page bundle within ~5% of Plan 5.7-R's 131 kB baseline

- [ ] **Step 2: No commit. Move to manual smoke.**

---

## Task 13: Manual smoke gate

**Files:** none

- [ ] **Step 1: Run dev server**

```bash
npm run dev
```

- [ ] **Step 2: Walk the smoke checklist (from the plan header)**

Twelve items:

1. Upload image. Upload audio.
2. Drop the image onto the Image track so it spans the full audio length.
3. Drop a Pulse clip (or any FX) to give the export some movement.
4. Click Export → REC indicator appears, codec toast shows ("VP9 + Opus"
   or "VP8 + Opus (Fallback)").
5. Watch the timecode count up from `0:00 / 1:30` (or whatever your
   audio length is).
6. Wait for the audio to end → finalize → download dialog opens with
   `vibegrid_export_<timestamp>.webm`.
7. Open the file in VLC → audio + video play in sync.
8. Open in Chrome → same.
9. Repeat. During recording, switch to a different tab for ~5 seconds
   → persistent toast appears. Switch back → toast dismissed.
10. Repeat. During recording, click ✕ → REC disappears, "Export cancelled"
    toast appears (or no toast — confirm with user).
11. Remove the image clip. Try Export → button is disabled, tooltip
    explains the missing image.
12. Remove the audio MediaRef. Try Export → button is disabled, tooltip
    explains the missing audio.

- [ ] **Step 3: If any item fails — file the issue, fix, re-run gate.**

> Plan 6 complete. CC #2 QA review per `docs/Tests/` template.

---

## Risk + watchlist summary

| Risk | Where | Mitigation |
|---|---|---|
| Captured `audioMediaRef` at hook mount goes stale before first export | `lib/hooks/useVideoExporter.ts` + `lib/export/recorder.ts` | `getAudioMediaRef()` getter on `VideoExporterDeps`, never a captured value. Same pattern as `getTimeline`. Pre-check test "no-audio" passes `() => null`; happy path passes `() => audioMediaRef`. Architect Bug 1 (Plan 6 v1) — fixed before implementation start |
| Double-stop (both 'ended' + safety-interval fire) → `InvalidStateError` | `lib/export/recorder.ts` onstop + cancel | Both triggers' cleanup runs in `onstop()` AND `cancel()`. Tests cover the "cancel before ended fires" path explicitly |
| `MediaRecorder.start()` without timeslice → ~135 MB memory for 3-min track | `lib/export/recorder.ts` start | Always call `start(CHUNK_MS)` with `CHUNK_MS = 500`. Unit test asserts the call uses the timeslice arg |
| `URL.revokeObjectURL` fired too early → Chromium aborts download | `lib/export/recorder.ts` onstop | 10 s delay via setTimeout. Test uses fake timers + spy to verify the delay |
| Pre-checks skipped → black opening frame or recorder.start() throws | `lib/export/recorder.ts` start | Three pre-check tests (no-audio, no-image, no-stream) + Export button disabled-state covers the UI side |
| Codec mismatch (vp9 picked but unsupported at recorder construction time) | `lib/export/recorder.ts` start | `MediaRecorder.isTypeSupported` checked TWICE — once in `pickCodec`, once before `new MediaRecorder(...)` — error status surfaced if the recorder constructor throws |
| Codec toast fires for every state change while codecLabel stays unchanged | `lib/hooks/useVideoExporter.ts` | `codecToastedRef` guard + reset on `status === 'idle'`. One toast per export session |
| FPS monitor false-positive at startup (first few RAF deltas are huge) | `lib/hooks/useVideoExporter.ts` | Warning gated on `window.length >= 60` — first second is excluded from the average |
| Tab-hidden toast lingers forever if user closes tab while export running | `lib/hooks/useVideoExporter.ts` | Hook cleanup `useEffect` returns dismiss the toast. New mount starts fresh |
| `automationEditorClipId` cleanup confusion with `exportState` | none | Different concerns, different cleanup paths. Plan 5.7-R cleanup unchanged |
| TypeScript strict refuses one of the 5 UI-literal call sites | Task 4 | Step 5 grep instruction lists every site; Task 4 Step 6 runs the full suite to catch any miss |
| `vitest.setup.ts` MockMediaRecorder breaks tests that already mocked MediaRecorder somewhere | tests/ | The mock only sets `globalThis.MediaRecorder` if it's not already defined. Existing per-test mocks via `vi.stubGlobal` win |
| `getAudioStream()` returns null after a load error, recorder receives empty MediaStream | `lib/export/recorder.ts` start | Explicit `if (!audioStream)` pre-check sets error status and bails before constructing MediaRecorder |

## Out-of-plan items deferred

- R2 upload of the exported file (Plan 8 or v0.2).
- MP4 / WebCodecs export (v0.2, iOS-Capacitor).
- Stems export (separate audio tracks).
- Percent-progress bar.
- Bitrate / FPS / codec UI controls.
- Offline / faster-than-realtime render.
- Background-tab continuation (browser RAF throttling — out of our reach).

Plan 6 ends; v0.1 feature scope reached. Next planning checkpoint: v0.2 /
Capacitor / Supabase Auth.
