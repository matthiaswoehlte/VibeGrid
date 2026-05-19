# VibeGrid Plan 5 — UI Components, Claude Auto-Preset, Automation Data Model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the v0.1 studio UI end-to-end (Spec §9: TopBar, Workspace, LeftPanel, Stage, Timeline, Inspector, ErrorBoundaries, DPR-correct canvas, responsive scaffolding), introduce a Claude-powered "Auto-Preset" feature (POST `/api/analyze-image` → claude-sonnet-4-6 returns FX params), and prepare the **automation curve datamodel** (`StaticOrAuto<T>` + `resolveParam`) so Plan 5.5 can add the AutomationLane UI without a breaking store/renderer change.

**Architecture:** Three additive layers on top of Plan 4. (1) **Pure automation primitives** in `lib/automation/` — `StaticOrAuto<T>`, `AutomationCurve<T>`, `resolveParam(p, beat)`, `resolveClipParams(params, beat)` — zero React, zero I/O, replace the renderer's static `clip.params` lookup. (2) **React hooks** in `lib/hooks/` — `useAudioEngine` (engine ↔ store BPM sync), `useRenderer` (canvas + ResizeObserver + DPR), `useMediaUpload` (post-upload metadata extraction). (3) **Components** in `components/` — pixel-perfect Spec §9 tree, every interactive surface uses pointer events. The Claude integration follows the Plan 4 server-only pattern: `lib/ai/anthropic.ts` is hard-locked to the server via `import 'server-only'`, the route `app/api/analyze-image/route.ts` validates the SDK response against the active FX's `paramSchema` before returning.

**Tech Stack:** React 18, Tailwind, Zustand (existing), `@dnd-kit/core` (clip drag), `@anthropic-ai/sdk` (Claude vision), `claude-sonnet-4-6` model. Vitest + @testing-library/react for component tests. No new persistence — `mediaRefs` already persisted in Plan 4.

**Spec reference:** `docs/superpowers/specs/2026-05-19-vibegrid-design.md` §9 (UI Components), §9.1 (DPR), §9.3 (Inspector), §9.4 (ErrorBoundaries), §9.5 (Responsive), §9.6 (Drag/resize), §10 (State — `inspectorOpen` is local UI state, not store).

**Verification gate (must pass before Plan 6 starts):**

```
npm test -- automation     # ≥ 12 tests for resolveParam + resolveClipParams
npm test -- components     # ≥ 30 tests across Inspector, ParamControl, ErrorBoundary, MediaLibrary, AutoPresetButton, Timeline, Clip, Waveform, useAudioEngine
npm test -- integration    # analyze-image.api.test.ts (≥ 4 tests, mocked Anthropic client) + upload.api.test.ts regression
npm test                   # full suite ≥ 215 (Plan 4 baseline = 169)
npm run typecheck
npm run lint
npm run build              # bundles analyze-image route, no AWS SDK or Anthropic SDK in client chunks
```

**Smoke gate (manual, before declaring Plan 5 done):**

```
npm run dev
# - Upload an image and an audio file via MediaLibrary
# - See thumbnail (width × height) and waveform (duration-derived)
# - Place a Pulse clip on the timeline, drag it, resize the right edge
# - Hit play — Pulse fires on each beat
# - Open Inspector, change `intensity` — change reflects on next frame
# - Click ✨ Auto-Preset on the image — Inspector values update live
# - Resize window to 800px wide — Inspector slides over on tab click
```

**Dependencies on prior plans:** Plan 4 (mediaRefs slice, R2 upload, MIME validation). Plan 3 (renderer + FX plugins, image-cache). Plan 2 (AudioEngine + beat detector). Plan 1 (timeline pure helpers + selectors).

---

## File map

### Pure helpers (no React, no I/O)

| File | Purpose |
|---|---|
| `lib/automation/types.ts` | `StaticOrAuto<T>`, `AutomationCurve<T>`, `AutomationPoint<T>`, `Interpolation`, `isAutomationCurve` type guard |
| `lib/automation/resolve.ts` | `resolveParam(p, beat)` — pure. Linear interp for numbers, step for everything else. `resolveClipParams(params, beat)` walks a Record |

### Server-only (Anthropic)

| File | Purpose |
|---|---|
| `lib/ai/env.ts` | `getAnthropicConfig()` — lazy, validates `ANTHROPIC_API_KEY`, `import 'server-only'` |
| `lib/ai/anthropic.ts` | `getAnthropicClient()` lazy singleton + `analyzeImageForFx(imageBytes, fxName, paramSchema)` returns `Record<string, unknown>` |
| `lib/ai/schema-validator.ts` | Pure: `validateAgainstParamSchema(value, schema)` — coerces & clamps slider, validates select options, returns `{ ok, value }` or throws |
| `app/api/analyze-image/route.ts` | POST `runtime='nodejs'` — fetch image from R2 URL, call Claude, validate, return params |

### React hooks

| File | Purpose |
|---|---|
| `lib/hooks/useAudioEngine.ts` | Owns the AudioEngine instance for the studio. Two-way BPM sync: store → engine on user edit, engine → store on detection. SSR-safe (lazy init in useEffect) |
| `lib/hooks/useRenderer.ts` | Mounts `createRenderer` against a canvas ref. ResizeObserver-driven DPR sizing. Pauses on unmount |
| `lib/hooks/useMediaUpload.ts` | Wraps `R2StorageAdapter` + `extractMediaMeta` — post-upload `addMediaRefMeta` patches width/height/duration |

### Client metadata extraction

| File | Purpose |
|---|---|
| `lib/storage/media-meta.ts` | Client-only: `extractImageMeta(file)` via `Image`, `extractAudioMeta(file)` via `OffscreenAudioContext` → `{ width?, height?, duration? }` |
| `lib/storage/auto-preset-adapter.ts` | Client: POST `/api/analyze-image` with `{ imageUrl, fxId }`, returns validated params |

### Store extensions

| File | Purpose |
|---|---|
| `lib/store/media-slice.ts` (modify) | Add `addMediaRefMeta(id, partial)` — merges `width/height/duration` into an existing ref |
| `lib/store/timeline-slice.ts` (modify) | `setClipParam(clipId, key, value)` — single-key setter accepts `StaticOrAuto<unknown>`, leaves other keys alone |
| `lib/store/ui-slice.ts` (rewrite) | **Remove** `inspectorOpen` from persisted store. UI state shrinks to `{ zoom: number }` |
| `lib/store/types.ts` (modify) | Drop `inspectorOpen` from `UIState`, drop `setInspectorOpen`. Add `addMediaRefMeta`, `setClipParam` |

### Renderer extension

| File | Purpose |
|---|---|
| `lib/renderer/loop.ts` (modify) | Replace `clip.params ?? plugin.getDefaultParams()` with `resolveClipParams(...)` — beat-aware |
| `lib/renderer/image-cache.ts` (modify) | Evict-race guard: if `evict(mediaId)` fires while a load is in flight, the inflight promise is `.cancelled = true`; resolved bitmap is closed and dropped (not cached) |

### Components

| File | Purpose |
|---|---|
| `components/ErrorBoundary.tsx` | Class boundary with named-fallback prop |
| `components/TopBar/index.tsx` | Composes Transport + BPMBadge + ExportButton + RecIndicator |
| `components/TopBar/Transport.tsx` | Play/Pause/Stop, current time, seek-to-zero |
| `components/TopBar/BPMBadge.tsx` | Shows BPM from store, click to edit (number input) |
| `components/TopBar/ExportButton.tsx` | Disabled stub in v0.1 — Plan 6 implements |
| `components/TopBar/RecIndicator.tsx` | Pulsing red dot when MediaRecorder is active — visible-but-static stub in v0.1 |
| `components/Workspace/index.tsx` | Three-pane flex layout (LeftPanel \| Stage+Timeline \| Inspector). Inspector is hidden on `< lg` (1024px) and toggled via a slide-over button. Full 2-col / stacked breakpoints in Spec §9.5 are deferred (Plan 6 or 5.5). Owns `inspectorOpen` as local `useState` |
| `components/Workspace/LeftPanel/index.tsx` | Tabs: MediaLibrary \| FxLibrary \| LayersList |
| `components/Workspace/LeftPanel/MediaLibrary.tsx` | List of `mediaRef[]`, thumbnail + filename + size, upload dropzone, drag-to-timeline |
| `components/Workspace/LeftPanel/AutoPresetButton.tsx` | ✨ Auto-Preset button — disabled if no active FX clip |
| `components/Workspace/LeftPanel/FxLibrary.tsx` | List of registered plugins, drag-to-timeline |
| `components/Workspace/LeftPanel/LayersList.tsx` | Track list with mute/solo toggles |
| `components/Workspace/Stage/index.tsx` | Wraps CanvasView in ErrorBoundary, manages aspect-ratio frame |
| `components/Workspace/Stage/CanvasView.tsx` | Mounts renderer via `useRenderer`; pure visual |
| `components/Workspace/Timeline/index.tsx` | Wraps Toolbar + Ruler + Tracks + Playhead in ErrorBoundary |
| `components/Workspace/Timeline/Toolbar.tsx` | Snap mode select, zoom slider |
| `components/Workspace/Timeline/Ruler.tsx` | Bar/beat ticks; derived from BPM + zoom |
| `components/Workspace/Timeline/Waveform.tsx` | Renders SVG path from `waveform-worker` peaks |
| `components/Workspace/Timeline/Tracks.tsx` | Maps `tracks[]` to lanes, hosts Clips, click-to-seek |
| `components/Workspace/Timeline/Clip.tsx` | `@dnd-kit/core` draggable + custom right-edge resize |
| `components/Workspace/Timeline/Playhead.tsx` | Vertical line at `playhead.beats` |
| `components/Workspace/Inspector/index.tsx` | Auto-form from active clip's plugin `paramSchema` |
| `components/Workspace/Inspector/PreloadIndicator.tsx` | Spinner shown when `plugin.preloadState === 'loading'` |
| `components/Mobile/MobileTabBar.tsx` | Bottom tab bar stub — visible only `< 640px` |
| `components/ui/Button.tsx` | Variant: `primary | secondary | ghost`, size: `sm | md` |
| `components/ui/Slider.tsx` | Range slider — value + onChange |
| `components/ui/ColorPicker.tsx` | Compact swatch grid from `palette` + custom hex input |
| `components/ui/Toggle.tsx` | iOS-style toggle |
| `components/ui/SelectControl.tsx` | Native `<select>` styled |
| `components/ui/ParamControl.tsx` | Dispatches on `paramSchema[key].kind` to the right primitive |

### App routes

| File | Purpose |
|---|---|
| `app/(studio)/page.tsx` (rewrite) | Renders `<TopBar />` + `<Workspace />` + `<MobileTabBar />` |

### Tests (≥ 47 new)

| File | Tests |
|---|---|
| `tests/unit/automation/resolve.test.ts` | ≥ 12: static passthrough, single-point curve, before/after range clamps, linear midpoint, non-numeric step fallback, empty curve error, unsorted-points behavior (documented), boolean/string step, integer interpolation |
| `tests/unit/renderer/loop-automation.test.ts` | ≥ 3: integer beat resolves to point exactly, between beats linear-interpolates, automation passed to plugin.render |
| `tests/unit/renderer/image-cache-race.test.ts` | ≥ 3: evict during inflight load → bitmap closed not cached, evict before load → no-op, evict after load → cached entry closed |
| `tests/unit/storage/media-meta.test.ts` | ≥ 4: image w/h via Image element, audio duration via mock AudioContext, invalid image rejection, AbortSignal propagation |
| `tests/unit/storage/auto-preset-adapter.test.ts` | ≥ 3: posts JSON to /api/analyze-image with imageUrl + fxId, parses & returns params, throws on 4xx |
| `tests/unit/ai/schema-validator.test.ts` | ≥ 8: slider clamp to min/max, slider rounded to step, color hex validation, select option match, toggle boolean coercion, missing key error, extra key dropped, type mismatch error |
| `tests/integration/analyze-image.api.test.ts` | ≥ 4: success path returns validated params, malformed Claude JSON → 502, image fetch failure → 502, missing ANTHROPIC_API_KEY → 503 (env-side) |
| `tests/unit/hooks/useAudioEngine.test.tsx` | ≥ 4: lazy engine init, store-BPM → engine.setBPM, engine-detection → store, cleanup on unmount |
| `tests/unit/store/media-slice-meta.test.ts` | ≥ 3: addMediaRefMeta merges width/height onto existing ref, no-op on unknown id, preserves other fields |
| `tests/unit/store/timeline-slice-param.test.ts` | ≥ 3: setClipParam writes single key, accepts AutomationCurve value, leaves other params untouched |
| `tests/unit/components/ErrorBoundary.test.tsx` | ≥ 2: catches throw, renders fallback |
| `tests/unit/components/Inspector.test.tsx` | ≥ 3: renders no controls when no clip, renders controls from paramSchema, edit calls setClipParam |
| `tests/unit/components/ParamControl.test.tsx` | ≥ 4: dispatches to slider, color, select, toggle |
| `tests/unit/components/MediaLibrary.test.tsx` | ≥ 3: renders mediaRefs, upload triggers adapter + addMediaRef + addMediaRefMeta, drag emits dataTransfer |
| `tests/unit/components/AutoPresetButton.test.tsx` | ≥ 3: disabled without active FX clip, calls adapter on click, toast on error |
| `tests/unit/components/Timeline/Clip.test.tsx` | ≥ 3: drag updates startBeat, resize updates lengthBeats, click selects |
| `tests/unit/components/Timeline/Waveform.test.tsx` | ≥ 2: renders SVG path from peaks prop, returns null without peaks |

---

## Conventions

- **`StaticOrAuto<T>` is the migration boundary.** `clip.params: Record<string, unknown>` stays the on-wire shape — each value MAY now be a static `T` or an `AutomationCurve<T>`. The renderer never reads `clip.params` directly; it goes through `resolveClipParams(clip.params, beats)`. **Existing static params keep working with zero migration** (the `isAutomationCurve` guard returns false → passthrough).
- **Inspector edits only static values in Plan 5.** Setting a value via `setClipParam(id, key, number)` always writes a static value. Plan 5.5 introduces the AutomationLane UI which writes `AutomationCurve` shapes through the same setter.
- **`inspectorOpen` is local UI state.** Owned by `<Workspace />` via `useState`, never persisted, never in the store. UIState shrinks to `{ zoom: number }`.
- **Pointer events only.** All draggable/resizable surfaces use `onPointerDown/Move/Up` (touch-ready for Capacitor v0.2). `@dnd-kit/core` defaults to pointer.
- **Anthropic SDK is server-only.** `lib/ai/anthropic.ts` and `lib/ai/env.ts` open with `import 'server-only';`. The schema validator in `lib/ai/schema-validator.ts` is pure (no SDK import) and IS importable from client code — used by `auto-preset-adapter.ts` for an optimistic client-side check.
- **Claude model:** `claude-sonnet-4-6` (current Sonnet, vision-capable). No reasoning mode for v0.1 — latency matters for the UX feedback loop.
- **Auto-preset image source:** server fetches from `mediaRef.url` (R2 public URL). v0.1 assumes the bucket is publicly readable. v0.2: signed URLs.
- **No streaming in v0.1.** `/api/analyze-image` returns a single JSON body. Users see a `sonner` toast "Analyzing image…" then "✨ Preset applied" or an error.
- **All test components mount under a Zustand reset.** `beforeEach` resets the store to defaults so tests don't leak state.

---

## Task 0: Install deps

**Files:**
- Modify: `package.json`

> `@dnd-kit/core` for clip drag, `@anthropic-ai/sdk` for the analyze-image route. Versions pinned to caret-current as of 2026-05.

- [ ] **Step 1: Install**

```bash
npm install @dnd-kit/core@^6.1.0 @anthropic-ai/sdk@^0.30.0
```

Expected: two packages added to `dependencies`. The Anthropic SDK is ESM-and-CJS dual; works under Next.js node runtime and vitest without ESM gymnastics.

- [ ] **Step 2: Sanity test**

```bash
npm test
```

Expected: 169 passed, no change.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @dnd-kit/core + @anthropic-ai/sdk"
```

---

## Task 1: Automation primitives (types + resolveParam)

**Files:**
- Create: `lib/automation/types.ts`
- Create: `lib/automation/resolve.ts`
- Create: `tests/unit/automation/resolve.test.ts`

> Pure functions. The renderer integration is Task 2; this task ships the data model + resolver in isolation so unit tests can hammer it without the renderer's deps.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/automation/resolve.test.ts
import { describe, it, expect } from 'vitest';
import { resolveParam, resolveClipParams, isAutomationCurve } from '@/lib/automation/resolve';
import type { AutomationCurve } from '@/lib/automation/types';

describe('resolveParam — static passthrough', () => {
  it('returns plain numbers unchanged', () => {
    expect(resolveParam(0.5, 4)).toBe(0.5);
  });
  it('returns plain strings unchanged', () => {
    expect(resolveParam('#ff00ff', 4)).toBe('#ff00ff');
  });
  it('returns plain booleans unchanged', () => {
    expect(resolveParam(true, 4)).toBe(true);
  });
});

describe('resolveParam — automation curve', () => {
  const linear: AutomationCurve<number> = {
    mode: 'automation',
    points: [
      { beat: 0, value: 0 },
      { beat: 4, value: 1 }
    ],
    interpolation: 'linear'
  };

  it('returns first point value when beat is before range', () => {
    expect(resolveParam(linear, -1)).toBe(0);
  });
  it('returns last point value when beat is after range', () => {
    expect(resolveParam(linear, 100)).toBe(1);
  });
  it('returns exact point value at point boundary', () => {
    expect(resolveParam(linear, 0)).toBe(0);
    expect(resolveParam(linear, 4)).toBe(1);
  });
  it('linearly interpolates between two numeric points', () => {
    expect(resolveParam(linear, 2)).toBeCloseTo(0.5);
    expect(resolveParam(linear, 1)).toBeCloseTo(0.25);
  });

  it('step-falls-back for non-numeric values (color)', () => {
    const colorCurve: AutomationCurve<string> = {
      mode: 'automation',
      points: [
        { beat: 0, value: '#ff0000' },
        { beat: 4, value: '#00ff00' }
      ],
      interpolation: 'linear'
    };
    expect(resolveParam(colorCurve, 2)).toBe('#ff0000');
    expect(resolveParam(colorCurve, 4)).toBe('#00ff00');
  });

  it('handles single-point curve as constant', () => {
    const single: AutomationCurve<number> = {
      mode: 'automation',
      points: [{ beat: 0, value: 0.42 }],
      interpolation: 'linear'
    };
    expect(resolveParam(single, -10)).toBe(0.42);
    expect(resolveParam(single, 0)).toBe(0.42);
    expect(resolveParam(single, 10)).toBe(0.42);
  });

  it('throws on empty curve (programmer error, never serialised)', () => {
    const empty = { mode: 'automation', points: [], interpolation: 'linear' } as AutomationCurve<number>;
    expect(() => resolveParam(empty, 0)).toThrow(/empty/i);
  });

  it('isAutomationCurve discriminates correctly', () => {
    expect(isAutomationCurve(0.5)).toBe(false);
    expect(isAutomationCurve('#fff')).toBe(false);
    expect(isAutomationCurve(linear)).toBe(true);
  });
});

describe('resolveClipParams', () => {
  it('walks each key, resolving automation per key', () => {
    const params = {
      intensity: {
        mode: 'automation' as const,
        points: [
          { beat: 0, value: 0 },
          { beat: 8, value: 1 }
        ],
        interpolation: 'linear' as const
      },
      color: '#abcdef'
    };
    const out = resolveClipParams(params, 4);
    expect(out.intensity).toBeCloseTo(0.5);
    expect(out.color).toBe('#abcdef');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```
npm test -- automation
```

- [ ] **Step 3: Implement types**

```ts
// lib/automation/types.ts
export type Interpolation = 'linear'; // 'step' explicit in v0.2

export interface AutomationPoint<T> {
  beat: number;
  value: T;
}

export interface AutomationCurve<T> {
  mode: 'automation';
  points: AutomationPoint<T>[];
  interpolation: Interpolation;
}

/** A parameter value: either a static T, or a curve over beats. */
export type StaticOrAuto<T> = T | AutomationCurve<T>;
```

- [ ] **Step 4: Implement resolver**

```ts
// lib/automation/resolve.ts
import type { AutomationCurve, StaticOrAuto } from './types';

export function isAutomationCurve<T>(p: StaticOrAuto<T>): p is AutomationCurve<T> {
  return (
    typeof p === 'object' &&
    p !== null &&
    (p as AutomationCurve<T>).mode === 'automation' &&
    Array.isArray((p as AutomationCurve<T>).points)
  );
}

export function resolveParam<T>(p: StaticOrAuto<T>, beat: number): T {
  if (!isAutomationCurve(p)) return p;
  const pts = p.points;
  if (pts.length === 0) {
    throw new Error('resolveParam: empty AutomationCurve.points');
  }
  if (pts.length === 1 || beat <= pts[0].beat) return pts[0].value;
  if (beat >= pts[pts.length - 1].beat) return pts[pts.length - 1].value;

  // Find segment containing `beat`. Linear scan — v0.1 curves stay short (< 16 points).
  let i = 0;
  while (i < pts.length - 1 && pts[i + 1].beat <= beat) i++;
  const a = pts[i];
  const b = pts[i + 1];

  if (p.interpolation === 'linear' && typeof a.value === 'number' && typeof b.value === 'number') {
    const t = (beat - a.beat) / (b.beat - a.beat);
    return ((a.value as number) + ((b.value as number) - (a.value as number)) * t) as T;
  }

  // Step fallback — hold a.value until next point.
  return a.value;
}

export function resolveClipParams(
  params: Record<string, unknown>,
  beat: number
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = resolveParam(v as StaticOrAuto<unknown>, beat);
  }
  return out;
}
```

- [ ] **Step 5: Run — expect PASS (≥ 12 tests)**

- [ ] **Step 6: Commit**

```bash
git add lib/automation/types.ts lib/automation/resolve.ts tests/unit/automation/resolve.test.ts
git commit -m "feat(automation): StaticOrAuto + resolveParam (linear interp, step fallback)"
```

---

## Task 2: Renderer integration — beat-aware param resolution

**Files:**
- Modify: `lib/renderer/loop.ts`
- Create: `tests/unit/renderer/loop-automation.test.ts`

> One line changes in the render loop: `clip.params ?? plugin.getDefaultParams()` becomes `resolveClipParams(clip.params ?? plugin.getDefaultParams(), beats)`. The `beats` value is already computed at the top of `tick()`. Default params bypass `resolveClipParams` (no automation in defaults) for the same observable result but the explicit path keeps things uniform.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/renderer/loop-automation.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRenderer } from '@/lib/renderer/loop';
import { register, _resetRegistryForTests } from '@/lib/renderer/registry';
import { _resetBuiltInPluginsForTests } from '@/lib/fx';
import type { FxPlugin } from '@/lib/renderer/types';
import type { TimelineState } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 100;
  c.height = 100;
  return c;
}

const grid: BeatGrid = { bpm: 60, offsetMs: 0, source: 'manual' };

describe('renderer — automation curve in clip.params', () => {
  let captured: Record<string, unknown> | null;
  let probe: FxPlugin<Record<string, unknown>>;

  beforeEach(() => {
    _resetBuiltInPluginsForTests();
    _resetRegistryForTests();
    captured = null;
    probe = {
      id: 'probe',
      name: 'Probe',
      kind: 'Pulse',
      defaultTrigger: 'beat',
      preloadState: 'ready',
      paramSchema: {
        intensity: { kind: 'slider', min: 0, max: 1, step: 0.05, default: 0, label: 'I' }
      },
      getDefaultParams: () => ({ intensity: 0 }),
      async preload() {},
      render(_rc, params) {
        captured = params;
      }
    };
    register(probe);
  });

  it('linearly interpolates an automation curve at the current beat', () => {
    const timeline: TimelineState = {
      tracks: [{ id: 't1', kind: 'pulse', name: 'P', muted: false, order: 0 }],
      clips: [
        {
          id: 'c1',
          trackId: 't1',
          kind: 'pulse',
          fxId: 'probe',
          startBeat: 0,
          lengthBeats: 16,
          label: 'P',
          params: {
            intensity: {
              mode: 'automation',
              points: [
                { beat: 0, value: 0 },
                { beat: 4, value: 1 }
              ],
              interpolation: 'linear'
            }
          }
        }
      ],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    };
    let currentTime = 2; // at 60 bpm → beat 2
    const renderer = createRenderer({
      canvas: makeCanvas(),
      getCurrentTime: () => currentTime,
      getBeatGrid: () => grid,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      rafCallback: () => 0,
      cancelRafCallback: () => undefined
    });
    renderer.tick();
    expect(captured).not.toBeNull();
    expect((captured as { intensity: number }).intensity).toBeCloseTo(0.5);
  });

  it('passes static params unchanged (passthrough)', () => {
    const timeline: TimelineState = {
      tracks: [{ id: 't1', kind: 'pulse', name: 'P', muted: false, order: 0 }],
      clips: [
        {
          id: 'c1',
          trackId: 't1',
          kind: 'pulse',
          fxId: 'probe',
          startBeat: 0,
          lengthBeats: 16,
          label: 'P',
          params: { intensity: 0.42 }
        }
      ],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    };
    const renderer = createRenderer({
      canvas: makeCanvas(),
      getCurrentTime: () => 0,
      getBeatGrid: () => grid,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      rafCallback: () => 0,
      cancelRafCallback: () => undefined
    });
    renderer.tick();
    expect((captured as { intensity: number }).intensity).toBe(0.42);
  });

  it('uses plugin defaults when clip.params is absent', () => {
    const timeline: TimelineState = {
      tracks: [{ id: 't1', kind: 'pulse', name: 'P', muted: false, order: 0 }],
      clips: [
        {
          id: 'c1',
          trackId: 't1',
          kind: 'pulse',
          fxId: 'probe',
          startBeat: 0,
          lengthBeats: 16,
          label: 'P'
        }
      ],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    };
    const renderer = createRenderer({
      canvas: makeCanvas(),
      getCurrentTime: () => 0,
      getBeatGrid: () => grid,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined,
      rafCallback: () => 0,
      cancelRafCallback: () => undefined
    });
    renderer.tick();
    expect((captured as { intensity: number }).intensity).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (only the automation test; passthrough may already pass)**

- [ ] **Step 3: Modify `lib/renderer/loop.ts`**

Locate the line near the end of `tick()`:

```ts
plugin.render(rc, clip.params ?? plugin.getDefaultParams());
```

Replace with:

```ts
const rawParams = clip.params ?? plugin.getDefaultParams();
plugin.render(rc, resolveClipParams(rawParams, beats));
```

Add the import at the top of the file:

```ts
import { resolveClipParams } from '@/lib/automation/resolve';
```

- [ ] **Step 4: Run — expect PASS (3 new + all renderer regression green)**

```
npm test -- renderer
```

- [ ] **Step 5: Commit**

```bash
git add lib/renderer/loop.ts tests/unit/renderer/loop-automation.test.ts
git commit -m "feat(renderer): resolve clip.params through automation curves per frame"
```

---

## Task 3: image-cache evict-race guard (Watchlist 3)

**Files:**
- Modify: `lib/renderer/image-cache.ts`
- Modify: `tests/unit/renderer/image-cache.test.ts` (extend)

> Today: if `evict(id)` runs while `load(id, url)` is still in flight, the load resolves AFTER the evict, the bitmap goes into the cache, and the caller who issued the evict thinks the entry is gone. Fix: track inflight by ID, mark cancelled on evict, the resolver closes the bitmap and does not cache.

- [ ] **Step 1: Write the failing test (extend the existing file)**

Add to `tests/unit/renderer/image-cache.test.ts`:

```ts
describe('evict-race guard', () => {
  it('closes bitmap and skips cache if evict fires before load resolves', async () => {
    const cache = createImageBitmapCache();
    let resolveFetch: (b: Blob) => void = () => undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>((res) => {
        const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
        resolveFetch = () => res(new Response(blob));
      })
    );
    const bitmapClose = vi.fn();
    const ibSpy = vi.spyOn(globalThis, 'createImageBitmap').mockResolvedValue({
      width: 1,
      height: 1,
      close: bitmapClose
    } as unknown as ImageBitmap);

    const loadPromise = cache.load('m1', 'https://x/a.jpg');
    cache.evict('m1'); // race: evict before fetch resolves
    resolveFetch();
    await loadPromise.catch(() => undefined); // promise may reject or resolve; both OK
    expect(bitmapClose).toHaveBeenCalledTimes(1);
    expect(cache.get('m1')).toBeUndefined();

    fetchSpy.mockRestore();
    ibSpy.mockRestore();
  });

  it('evict on non-existent id is a safe no-op', () => {
    const cache = createImageBitmapCache();
    expect(() => cache.evict('never-loaded')).not.toThrow();
  });

  it('evict after load closes and removes', async () => {
    const cache = createImageBitmapCache();
    const bitmapClose = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob([new Uint8Array([1])])));
    vi.spyOn(globalThis, 'createImageBitmap').mockResolvedValue({
      width: 1,
      height: 1,
      close: bitmapClose
    } as unknown as ImageBitmap);
    await cache.load('m1', 'https://x/a.jpg');
    cache.evict('m1');
    expect(bitmapClose).toHaveBeenCalledTimes(1);
    expect(cache.get('m1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL on the race test**

- [ ] **Step 3: Modify `lib/renderer/image-cache.ts`**

```ts
// TODO v0.2: add LRU eviction (cap: 8 bitmaps).
export interface ImageBitmapCache {
  get(mediaId: string): ImageBitmap | undefined;
  load(mediaId: string, url: string): Promise<ImageBitmap>;
  evict(mediaId: string): void;
  clear(): void;
}

interface InflightEntry {
  promise: Promise<ImageBitmap>;
  cancelled: boolean;
}

export function createImageBitmapCache(): ImageBitmapCache {
  const cache = new Map<string, ImageBitmap>();
  const inflight = new Map<string, InflightEntry>();

  function evictById(mediaId: string): void {
    const bitmap = cache.get(mediaId);
    if (bitmap) {
      bitmap.close();
      cache.delete(mediaId);
    }
    const entry = inflight.get(mediaId);
    if (entry) {
      entry.cancelled = true;
      // The load() chain checks `cancelled` after createImageBitmap resolves
      // and closes the bitmap there. We do NOT delete `inflight` here — the
      // load() finally clause handles that.
    }
  }

  return {
    get(mediaId) {
      return cache.get(mediaId);
    },
    async load(mediaId, url) {
      const cached = cache.get(mediaId);
      if (cached) return cached;
      const existing = inflight.get(mediaId);
      if (existing) return existing.promise;

      const entry: InflightEntry = { promise: undefined as unknown as Promise<ImageBitmap>, cancelled: false };
      entry.promise = (async () => {
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          const bitmap = await createImageBitmap(blob);
          if (entry.cancelled) {
            bitmap.close();
            throw new Error(`Load of ${mediaId} cancelled by evict`);
          }
          cache.set(mediaId, bitmap);
          return bitmap;
        } finally {
          inflight.delete(mediaId);
        }
      })();
      inflight.set(mediaId, entry);
      return entry.promise;
    },
    evict: evictById,
    clear() {
      for (const bitmap of cache.values()) bitmap.close();
      cache.clear();
      for (const entry of inflight.values()) entry.cancelled = true;
    }
  };
}
```

- [ ] **Step 4: Run — expect PASS**

```
npm test -- image-cache
```

- [ ] **Step 5: Commit**

```bash
git add lib/renderer/image-cache.ts tests/unit/renderer/image-cache.test.ts
git commit -m "fix(renderer): image-cache evict-race guard (cancel inflight, close bitmap)"
```

---

## Task 4: Drop inspectorOpen from store (Watchlist 1)

**Files:**
- Modify: `lib/store/types.ts`
- Modify: `lib/store/index.ts`
- Modify: any existing test that reads `state.ui.inspectorOpen` or calls `setInspectorOpen`

> Spec §9.5 says `inspectorOpen` is local UI state. It currently lives in the store and gets persisted. Remove it everywhere; `<Workspace />` will own it via `useState` in Task 12.

- [ ] **Step 1: Modify `lib/store/types.ts`**

```ts
export interface UIState {
  zoom: number;
}
```

Drop `setInspectorOpen` from `AppState`:

```ts
export interface AppState {
  ui: UIState;
  setZoom(zoom: number): void;
  timeline: TimelineState;
  timelineActions: TimelineActions;
  audio: AudioState;
  audioActions: AudioActions;
  media: MediaState;
  mediaActions: MediaActions;
}
```

- [ ] **Step 2: Modify `lib/store/index.ts`**

Replace the existing initializer block (only the `ui` lines and the setter line shown):

```ts
ui: { zoom: 1 },
setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
// remove the `setInspectorOpen` line entirely
```

`partialize` already persists `state.ui` — fine, now it only contains `zoom`.

- [ ] **Step 3: Run typecheck — fix any callers**

```
npm run typecheck
```

Any error pointing at a missing `inspectorOpen` or `setInspectorOpen` → remove the caller (most likely tests/`useAppStore.getState().ui.inspectorOpen` references). For Plan-4 surface, the only callers are inside the store itself.

- [ ] **Step 4: Run full suite**

```
npm test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add lib/store/types.ts lib/store/index.ts
git commit -m "refactor(store): drop inspectorOpen from store (now local UI state)"
```

---

## Task 5: Store extension — addMediaRefMeta + setClipParam

**Files:**
- Modify: `lib/store/types.ts`
- Modify: `lib/store/media-slice.ts`
- Modify: `lib/store/timeline-slice.ts`
- Create: `tests/unit/store/media-slice-meta.test.ts`
- Create: `tests/unit/store/timeline-slice-param.test.ts`

> `addMediaRefMeta(id, partial)` merges `width/height/duration` onto an existing ref. `setClipParam(clipId, key, value)` writes a single key (StaticOrAuto-shaped). Both surfaces are immutable.

- [ ] **Step 1: Extend `MediaActions` and `TimelineActions` in `lib/store/types.ts`**

```ts
export interface MediaActions {
  addMediaRef(ref: MediaRef): void;
  removeMediaRef(id: string): void;
  getMediaRef(id: string): MediaRef | undefined;
  addMediaRefMeta(id: string, partial: Pick<MediaRef, 'width' | 'height' | 'duration'>): void;
}

export interface TimelineActions {
  // ...existing fields...
  setClipParam(clipId: string, key: string, value: unknown): void;
}
```

- [ ] **Step 2: Implement `addMediaRefMeta` in `lib/store/media-slice.ts`**

Append to the `mediaActions` object literal:

```ts
addMediaRefMeta: (id, partial) => {
  const list = get().media.mediaRefs;
  const idx = list.findIndex((m) => m.id === id);
  if (idx === -1) return;
  const merged = { ...list[idx], ...partial };
  const next = [...list];
  next[idx] = merged;
  set({ media: { mediaRefs: next } });
}
```

- [ ] **Step 3: Implement `setClipParam` in `lib/store/timeline-slice.ts`**

Append to `timelineActions`:

```ts
setClipParam: (clipId, key, value) => {
  set((s) => ({
    timeline: {
      ...s.timeline,
      clips: s.timeline.clips.map((c) =>
        c.id === clipId
          ? { ...c, params: { ...(c.params ?? {}), [key]: value } }
          : c
      )
    }
  }));
}
```

- [ ] **Step 4: Write tests**

```ts
// tests/unit/store/media-slice-meta.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { initialMediaState } from '@/lib/store/media-slice';

const baseRef = {
  id: 'a',
  kind: 'image' as const,
  url: 'https://x/a.jpg',
  filename: 'a.jpg',
  uploadedAt: '2026-05-19T00:00:00.000Z'
};

describe('addMediaRefMeta', () => {
  beforeEach(() => {
    useAppStore.setState({ media: { ...initialMediaState } });
  });

  it('merges width/height onto an existing ref', () => {
    useAppStore.getState().mediaActions.addMediaRef(baseRef);
    useAppStore.getState().mediaActions.addMediaRefMeta('a', { width: 1920, height: 1080 });
    const ref = useAppStore.getState().mediaActions.getMediaRef('a');
    expect(ref?.width).toBe(1920);
    expect(ref?.height).toBe(1080);
    expect(ref?.url).toBe(baseRef.url);
  });

  it('no-op on unknown id', () => {
    useAppStore.getState().mediaActions.addMediaRefMeta('unknown', { duration: 12 });
    expect(useAppStore.getState().media.mediaRefs).toEqual([]);
  });

  it('preserves untouched fields when only duration is patched', () => {
    useAppStore.getState().mediaActions.addMediaRef({ ...baseRef, id: 'b', kind: 'audio' });
    useAppStore.getState().mediaActions.addMediaRefMeta('b', { duration: 180 });
    const ref = useAppStore.getState().mediaActions.getMediaRef('b');
    expect(ref?.duration).toBe(180);
    expect(ref?.filename).toBe('a.jpg');
  });
});
```

```ts
// tests/unit/store/timeline-slice-param.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';

describe('setClipParam', () => {
  beforeEach(() => {
    useAppStore.setState({
      timeline: {
        tracks: [{ id: 't1', kind: 'pulse', name: 'P', muted: false, order: 0 }],
        clips: [
          {
            id: 'c1',
            trackId: 't1',
            kind: 'pulse',
            fxId: 'pulse',
            startBeat: 0,
            lengthBeats: 4,
            label: 'P',
            params: { intensity: 0.5, color: '#fff' }
          }
        ],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      }
    });
  });

  it('writes a single static key, leaves others alone', () => {
    useAppStore.getState().timelineActions.setClipParam('c1', 'intensity', 0.9);
    const clip = useAppStore.getState().timeline.clips[0];
    expect(clip.params?.intensity).toBe(0.9);
    expect(clip.params?.color).toBe('#fff');
  });

  it('accepts an AutomationCurve as the value', () => {
    const curve = {
      mode: 'automation' as const,
      points: [{ beat: 0, value: 0 }],
      interpolation: 'linear' as const
    };
    useAppStore.getState().timelineActions.setClipParam('c1', 'intensity', curve);
    const clip = useAppStore.getState().timeline.clips[0];
    expect(clip.params?.intensity).toEqual(curve);
  });

  it('no-op on unknown clipId', () => {
    useAppStore.getState().timelineActions.setClipParam('nope', 'intensity', 0);
    const clip = useAppStore.getState().timeline.clips[0];
    expect(clip.params?.intensity).toBe(0.5);
  });
});
```

- [ ] **Step 5: Run — expect PASS**

```
npm test -- store
```

- [ ] **Step 6: Commit**

```bash
git add lib/store/types.ts lib/store/media-slice.ts lib/store/timeline-slice.ts tests/unit/store/media-slice-meta.test.ts tests/unit/store/timeline-slice-param.test.ts
git commit -m "feat(store): addMediaRefMeta + setClipParam (single-key, AutomationCurve-aware)"
```

---

## Task 6: Client-side media metadata (Watchlist 2)

**Files:**
- Create: `lib/storage/media-meta.ts`
- Create: `tests/unit/storage/media-meta.test.ts`

> `extractImageMeta(file)` loads the file URL into an `Image` element to read `naturalWidth/Height`. `extractAudioMeta(file)` decodes the file into a temporary `AudioContext` to read `duration`. Both reject on invalid input; both honour an `AbortSignal`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/storage/media-meta.test.ts
import { describe, it, expect, vi } from 'vitest';
import { extractImageMeta, extractAudioMeta } from '@/lib/storage/media-meta';

describe('extractImageMeta', () => {
  it('returns width and height from a valid image File', async () => {
    // jsdom's Image element fires `load` synchronously when src is set to a
    // data: URL; we monkey-patch naturalWidth/Height for the test.
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'x.jpg', { type: 'image/jpeg' });
    const origImage = window.Image;
    class StubImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 1920;
      naturalHeight = 1080;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Image = StubImage;
    try {
      const meta = await extractImageMeta(file);
      expect(meta.width).toBe(1920);
      expect(meta.height).toBe(1080);
    } finally {
      window.Image = origImage;
    }
  });

  it('rejects when the Image element errors', async () => {
    const file = new File([new Uint8Array([0])], 'bad.jpg', { type: 'image/jpeg' });
    const origImage = window.Image;
    class StubImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Image = StubImage;
    try {
      await expect(extractImageMeta(file)).rejects.toThrow(/image/i);
    } finally {
      window.Image = origImage;
    }
  });
});

describe('extractAudioMeta', () => {
  it('returns duration from a decoded audio File via AudioContext', async () => {
    const file = new File([new Uint8Array(16)], 'song.mp3', { type: 'audio/mpeg' });
    const meta = await extractAudioMeta(file);
    // vitest.setup.ts's MockAudioContext returns duration: 0 from decodeAudioData,
    // but the function still must complete without throwing.
    expect(typeof meta.duration).toBe('number');
  });

  it('rejects when decode fails', async () => {
    const file = new File([new Uint8Array(0)], 'empty.mp3', { type: 'audio/mpeg' });
    const proto = (window as unknown as { AudioContext: new () => AudioContext }).AudioContext.prototype;
    const spy = vi.spyOn(proto, 'decodeAudioData').mockRejectedValueOnce(new Error('decode failed'));
    try {
      await expect(extractAudioMeta(file)).rejects.toThrow(/decode/i);
    } finally {
      spy.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// lib/storage/media-meta.ts
import { isClient } from '@/lib/utils/is-client';

export interface ImageMeta {
  width: number;
  height: number;
}
export interface AudioMeta {
  duration: number;
}

export function extractImageMeta(file: File, signal?: AbortSignal): Promise<ImageMeta> {
  if (!isClient()) return Promise.reject(new Error('extractImageMeta: client only'));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    const cleanup = () => {
      URL.revokeObjectURL(url);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error('extractImageMeta: aborted'));
    };
    img.onload = () => {
      cleanup();
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      cleanup();
      reject(new Error('extractImageMeta: image failed to load'));
    };
    signal?.addEventListener('abort', onAbort);
    img.src = url;
  });
}

export async function extractAudioMeta(file: File, signal?: AbortSignal): Promise<AudioMeta> {
  if (!isClient()) throw new Error('extractAudioMeta: client only');
  const Ctor = (window as unknown as { AudioContext: typeof AudioContext }).AudioContext;
  const ctx = new Ctor();
  try {
    const buf = await file.arrayBuffer();
    if (signal?.aborted) throw new Error('extractAudioMeta: aborted');
    const audioBuf = await ctx.decodeAudioData(buf);
    return { duration: audioBuf.duration };
  } catch (err) {
    throw new Error(
      `extractAudioMeta: decode failed (${err instanceof Error ? err.message : 'unknown'})`
    );
  } finally {
    // OfflineAudioContext would be cheaper, but jsdom's AudioContext mock
    // accepts close(). Real implementations release decoder resources here.
    await ctx.close?.();
  }
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/storage/media-meta.ts tests/unit/storage/media-meta.test.ts
git commit -m "feat(storage): extractImageMeta + extractAudioMeta (client, AbortSignal-aware)"
```

---

## Task 7: useMediaUpload + useAudioEngine hooks (Watchlist 4)

**Files:**
- Create: `lib/hooks/useMediaUpload.ts`
- Create: `lib/hooks/useAudioEngine.ts`
- Create: `tests/unit/hooks/useAudioEngine.test.tsx`

> `useMediaUpload` ties `R2StorageAdapter` + `extractMediaMeta` + store actions into a single `upload(file, kind)` returning a `MediaRef`. `useAudioEngine` owns the singleton AudioEngine instance and bridges its BPM to the store: user-edited BPM in the store calls `engine.setBPM`, detection calls `audioActions.setDetectedGrid` (which updates `state.audio.grid.bpm`). The hook listens to the engine via `onStateChange` and dispatches selectively to avoid loops.

- [ ] **Step 1: Write the failing engine-hook test**

```tsx
// tests/unit/hooks/useAudioEngine.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioEngine } from '@/lib/hooks/useAudioEngine';
import { useAppStore } from '@/lib/store';

describe('useAudioEngine', () => {
  beforeEach(() => {
    useAppStore.setState({ audio: { grid: { bpm: 120, offsetMs: 0, source: 'manual' } } });
  });

  it('lazy-inits the engine on first render', () => {
    const { result } = renderHook(() => useAudioEngine());
    expect(result.current.engine).toBeTruthy();
  });

  it('user-edited store BPM propagates to engine.setBPM', () => {
    const { result } = renderHook(() => useAudioEngine());
    const setBpmSpy = vi.spyOn(result.current.engine!, 'setBPM');
    act(() => {
      useAppStore.getState().audioActions.setBPM(140);
    });
    expect(setBpmSpy).toHaveBeenCalledWith(140);
  });

  it('engine-detected grid writes back to store without re-triggering setBPM', () => {
    const { result } = renderHook(() => useAudioEngine());
    const setBpmSpy = vi.spyOn(result.current.engine!, 'setBPM');
    act(() => {
      useAppStore.getState().audioActions.setDetectedGrid({
        bpm: 128,
        offsetMs: 12,
        source: 'detected'
      });
    });
    // setDetectedGrid is a "from-engine" path — must not loop back to engine.setBPM
    expect(setBpmSpy).not.toHaveBeenCalled();
    expect(useAppStore.getState().audio.grid.bpm).toBe(128);
  });

  it('cleans up engine on unmount', () => {
    const { result, unmount } = renderHook(() => useAudioEngine());
    const destroySpy = vi.spyOn(result.current.engine!, 'destroy');
    unmount();
    expect(destroySpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `useAudioEngine`**

```ts
// lib/hooks/useAudioEngine.ts
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { createAudioEngine, type AudioEngine } from '@/lib/audio/engine';

export interface UseAudioEngine {
  engine: AudioEngine | null;
}

/**
 * Single-source-of-truth bridge between the AudioEngine and the Zustand store.
 *
 * - Store BPM (user edit via setBPM) → engine.setBPM
 * - Engine detection (setDetectedGrid) → store, NO loop back to engine
 *
 * The "no loop" guarantee is held by an internal flag: when the store update
 * comes via `setDetectedGrid`, we mark the next BPM-change as a "from-engine"
 * write and skip the engine call.
 */
export function useAudioEngine(): UseAudioEngine {
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const lastSeenBpmRef = useRef<number | null>(null);
  const skipNextEngineSyncRef = useRef(false);

  useEffect(() => {
    const e = createAudioEngine();
    setEngine(e);
    lastSeenBpmRef.current = useAppStore.getState().audio.grid.bpm;
    return () => {
      e.destroy();
      setEngine(null);
    };
  }, []);

  useEffect(() => {
    if (!engine) return;
    const unsub = useAppStore.subscribe((state) => {
      const bpm = state.audio.grid.bpm;
      if (bpm === lastSeenBpmRef.current) return;
      lastSeenBpmRef.current = bpm;
      if (skipNextEngineSyncRef.current) {
        skipNextEngineSyncRef.current = false;
        return;
      }
      engine.setBPM(bpm);
    });
    return unsub;
  }, [engine]);

  // Intercept setDetectedGrid by patching audioActions — install once per engine.
  useEffect(() => {
    if (!engine) return;
    const originalSetDetected = useAppStore.getState().audioActions.setDetectedGrid;
    useAppStore.setState((s) => ({
      audioActions: {
        ...s.audioActions,
        setDetectedGrid: (grid) => {
          skipNextEngineSyncRef.current = true;
          originalSetDetected(grid);
        }
      }
    }));
    return () => {
      useAppStore.setState((s) => ({
        audioActions: { ...s.audioActions, setDetectedGrid: originalSetDetected }
      }));
    };
  }, [engine]);

  return { engine };
}
```

- [ ] **Step 4: Implement `useMediaUpload`**

```ts
// lib/hooks/useMediaUpload.ts
import { useCallback, useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import { createR2StorageAdapter } from '@/lib/storage/r2-adapter';
import { extractImageMeta, extractAudioMeta } from '@/lib/storage/media-meta';
import type { MediaKind, MediaRef } from '@/lib/storage/types';

export interface UseMediaUpload {
  upload(file: File, kind: MediaKind): Promise<MediaRef>;
}

export function useMediaUpload(): UseMediaUpload {
  const adapter = useMemo(() => createR2StorageAdapter(), []);
  const addMediaRef = useAppStore((s) => s.mediaActions.addMediaRef);
  const addMediaRefMeta = useAppStore((s) => s.mediaActions.addMediaRefMeta);

  const upload = useCallback(
    async (file: File, kind: MediaKind): Promise<MediaRef> => {
      const ref =
        kind === 'image' ? await adapter.uploadImage(file) : await adapter.uploadAudio(file);
      addMediaRef(ref);
      // Best-effort metadata fill — failure here does not fail the upload.
      try {
        const meta =
          kind === 'image' ? await extractImageMeta(file) : await extractAudioMeta(file);
        addMediaRefMeta(ref.id, meta);
      } catch {
        // swallow — meta is optional for v0.1 rendering
      }
      return ref;
    },
    [adapter, addMediaRef, addMediaRefMeta]
  );

  return { upload };
}
```

- [ ] **Step 5: Run — expect PASS**

```
npm test -- useAudioEngine
```

- [ ] **Step 6: Commit**

```bash
git add lib/hooks/useAudioEngine.ts lib/hooks/useMediaUpload.ts tests/unit/hooks/useAudioEngine.test.tsx
git commit -m "feat(hooks): useAudioEngine (BPM two-way sync) + useMediaUpload (upload + meta)"
```

---

## Task 8: useRenderer hook + DPR ResizeObserver

**Files:**
- Create: `lib/hooks/useRenderer.ts`

> Mounts `createRenderer` against a canvas `ref`. ResizeObserver-driven DPR sizing (Spec §9.1). Pauses on unmount. No new dependency — `lib/renderer/dpr.ts` already wraps the observer pattern; this hook just glues it.

- [ ] **Step 1: Read existing dpr.ts**

(No code change yet — orient yourself to the wrapper's signature so the hook composes it cleanly.)

- [ ] **Step 2: Implement**

```ts
// lib/hooks/useRenderer.ts
import { useEffect, useRef } from 'react';
import { createRenderer } from '@/lib/renderer/loop';
import { createImageBitmapCache } from '@/lib/renderer/image-cache';
import { attachDprObserver } from '@/lib/renderer/dpr';
import { useAppStore } from '@/lib/store';

export interface UseRendererOptions {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  getCurrentTime: () => number;
  getSeekCounter?: () => number;
}

/**
 * Mounts a renderer + image cache + DPR observer against `canvasRef`. The hook
 * is intentionally NOT reactive to `getCurrentTime` / `getSeekCounter` — those
 * are kept in refs so callers can pass fresh arrow functions every render
 * without the effect tearing the renderer down. The renderer is set up exactly
 * once per canvas mount and torn down on unmount.
 */
export function useRenderer({ canvasRef, getCurrentTime, getSeekCounter }: UseRendererOptions): void {
  const cacheRef = useRef(createImageBitmapCache());
  const getCurrentTimeRef = useRef(getCurrentTime);
  const getSeekCounterRef = useRef(getSeekCounter);
  // Keep refs in sync with the latest props — runs on every render, no re-mount.
  getCurrentTimeRef.current = getCurrentTime;
  getSeekCounterRef.current = getSeekCounter;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Prime the cache from any mediaRefs already in the store (post-rehydrate).
    const initial = useAppStore.getState().media.mediaRefs;
    initial
      .filter((m) => m.kind === 'image')
      .forEach((m) => {
        cacheRef.current.load(m.id, m.url).catch(() => undefined);
      });

    // Keep the cache in sync with subsequent additions / removals.
    const unsubMedia = useAppStore.subscribe((state, prev) => {
      const added = state.media.mediaRefs.filter(
        (m) => m.kind === 'image' && !prev.media.mediaRefs.find((p) => p.id === m.id)
      );
      const removed = prev.media.mediaRefs.filter(
        (m) => m.kind === 'image' && !state.media.mediaRefs.find((p) => p.id === m.id)
      );
      added.forEach((m) => {
        cacheRef.current.load(m.id, m.url).catch(() => undefined);
      });
      removed.forEach((m) => cacheRef.current.evict(m.id));
    });

    const renderer = createRenderer({
      canvas,
      getCurrentTime: () => getCurrentTimeRef.current(),
      getBeatGrid: () => useAppStore.getState().audio.grid,
      getTimelineState: () => useAppStore.getState().timeline,
      getImageBitmap: (mediaId) => cacheRef.current.get(mediaId),
      getSeekCounter: () => getSeekCounterRef.current?.() ?? 0
    });

    // DPR sizing — the caller (dpr.ts) only computes; we set canvas.width/height
    // and apply ctx.scale here so renderer draws in CSS-pixel coordinates.
    const stopResize = attachDprObserver(canvas, ({ pxWidth, pxHeight, dpr }) => {
      canvas.width = pxWidth;
      canvas.height = pxHeight;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    });

    renderer.start();
    return () => {
      renderer.stop();
      stopResize();
      unsubMedia();
      cacheRef.current.clear();
    };
    // Intentionally empty deps — refs above carry the latest callbacks.
    // canvasRef is a stable RefObject; React guarantees its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
```

> No new test file — the hook is exercised end-to-end via `CanvasView` component tests in Task 14.

- [ ] **Step 3: Typecheck**

```
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add lib/hooks/useRenderer.ts
git commit -m "feat(hooks): useRenderer (canvas mount + DPR observer + bitmap preload)"
```

---

## Task 9: ui primitives — Button, Slider, Toggle, SelectControl, ColorPicker, ParamControl

**Files:**
- Create: `components/ui/Button.tsx`
- Create: `components/ui/Slider.tsx`
- Create: `components/ui/Toggle.tsx`
- Create: `components/ui/SelectControl.tsx`
- Create: `components/ui/ColorPicker.tsx`
- Create: `components/ui/ParamControl.tsx`
- Create: `tests/unit/components/ParamControl.test.tsx`

> Atomic primitives styled with Tailwind utility classes referencing the CSS-variable design tokens (`--surface-2`, `--text`, `--a1`). `ParamControl` dispatches on `paramSchema[key].kind`. All accept `value` + `onChange`. No internal state.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/ParamControl.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ParamControl } from '@/components/ui/ParamControl';

describe('ParamControl', () => {
  it('renders a slider for kind="slider"', () => {
    const onChange = vi.fn();
    render(
      <ParamControl
        paramKey="intensity"
        schema={{ kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, label: 'Intensity' }}
        value={0.5}
        onChange={onChange}
      />
    );
    const input = screen.getByRole('slider') as HTMLInputElement;
    expect(input.value).toBe('0.5');
    fireEvent.input(input, { target: { value: '0.7' } });
    expect(onChange).toHaveBeenCalledWith(0.7);
  });

  it('renders a color input for kind="color"', () => {
    const onChange = vi.fn();
    render(
      <ParamControl
        paramKey="c"
        schema={{ kind: 'color', default: '#ffffff', label: 'Color' }}
        value={'#ff0000'}
        onChange={onChange}
      />
    );
    const input = screen.getByLabelText('Color') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '#00ff00' } });
    expect(onChange).toHaveBeenCalledWith('#00ff00');
  });

  it('renders a select for kind="select"', () => {
    const onChange = vi.fn();
    render(
      <ParamControl
        paramKey="mode"
        schema={{
          kind: 'select',
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' }
          ],
          default: 'a',
          label: 'Mode'
        }}
        value={'a'}
        onChange={onChange}
      />
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('renders a checkbox for kind="toggle"', () => {
    const onChange = vi.fn();
    render(
      <ParamControl
        paramKey="enabled"
        schema={{ kind: 'toggle', default: false, label: 'Enabled' }}
        value={false}
        onChange={onChange}
      />
    );
    const cb = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Implement primitives**

```tsx
// components/ui/Button.tsx
import { type ButtonHTMLAttributes } from 'react';
type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md';

const variantClass: Record<Variant, string> = {
  primary: 'bg-[var(--a1)] text-white hover:opacity-90',
  secondary: 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface-3)]',
  ghost: 'bg-transparent text-[var(--text)] hover:bg-[var(--surface-2)]'
};
const sizeClass: Record<Size, string> = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-9 px-3 text-sm'
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantClass[variant]} ${sizeClass[size]} ${className}`}
    />
  );
}
```

```tsx
// components/ui/Slider.tsx
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label?: string;
}) {
  return (
    <input
      type="range"
      role="slider"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
      className="w-full accent-[var(--a1)]"
    />
  );
}
```

```tsx
// components/ui/Toggle.tsx
export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--a1)]"
      />
      {label && <span className="text-xs text-[var(--text-dim)]">{label}</span>}
    </label>
  );
}
```

```tsx
// components/ui/SelectControl.tsx
export function SelectControl({
  value,
  options,
  onChange,
  label
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-md px-2 h-8 text-sm"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
```

```tsx
// components/ui/ColorPicker.tsx
export function ColorPicker({
  value,
  onChange,
  label,
  palette
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  palette?: string[];
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={label}
        value={value}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        className="h-7 w-9 cursor-pointer rounded bg-transparent"
      />
      {palette && (
        <div className="flex gap-1">
          {palette.map((p) => (
            <button
              key={p}
              type="button"
              aria-label={`Palette ${p}`}
              onClick={() => onChange(p)}
              className="h-5 w-5 rounded-sm border border-[var(--border)]"
              style={{ background: p }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

```tsx
// components/ui/ParamControl.tsx
import type { ParamType } from '@/lib/renderer/types';
import { Slider } from './Slider';
import { Toggle } from './Toggle';
import { SelectControl } from './SelectControl';
import { ColorPicker } from './ColorPicker';

export function ParamControl({
  paramKey,
  schema,
  value,
  onChange
}: {
  paramKey: string;
  schema: ParamType & { label: string };
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (schema.kind) {
    case 'slider':
      return (
        <Slider
          value={typeof value === 'number' ? value : schema.default}
          min={schema.min}
          max={schema.max}
          step={schema.step}
          label={schema.label}
          onChange={onChange}
        />
      );
    case 'color':
      return (
        <ColorPicker
          value={typeof value === 'string' ? value : schema.default}
          label={schema.label}
          palette={schema.palette}
          onChange={onChange}
        />
      );
    case 'select':
      return (
        <SelectControl
          value={typeof value === 'string' ? value : schema.default}
          options={schema.options}
          label={schema.label}
          onChange={onChange}
        />
      );
    case 'toggle':
      return (
        <Toggle
          checked={typeof value === 'boolean' ? value : schema.default}
          label={schema.label}
          onChange={onChange}
        />
      );
    default: {
      // Exhaustive check — if a new ParamType.kind lands without a case here,
      // TypeScript will flag this assignment.
      const _exhaustive: never = schema;
      void _exhaustive;
      return null;
    }
  }
}
```

- [ ] **Step 3: Run — expect PASS (≥ 4 tests)**

```
npm test -- ParamControl
```

- [ ] **Step 4: Commit**

```bash
git add components/ui tests/unit/components/ParamControl.test.tsx
git commit -m "feat(ui): primitives (Button, Slider, Toggle, SelectControl, ColorPicker, ParamControl)"
```

---

## Task 10: ErrorBoundary (Watchlist 6)

**Files:**
- Create: `components/ErrorBoundary.tsx`
- Create: `tests/unit/components/ErrorBoundary.test.tsx`

> Class component. Renders `fallback` when a descendant throws. The `name` prop is interpolated into the default fallback so per-region boundaries label themselves.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/ErrorBoundary.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function Bomb(): JSX.Element {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary name="Test">
        <div>child</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  it('renders fallback with name when a child throws', () => {
    // Silence the expected React error log
    const origError = console.error;
    console.error = () => undefined;
    try {
      render(
        <ErrorBoundary name="Stage">
          <Bomb />
        </ErrorBoundary>
      );
      expect(screen.getByText(/Stage/i)).toBeInTheDocument();
    } finally {
      console.error = origError;
    }
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```tsx
// components/ErrorBoundary.tsx
'use client';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  name: string;
  children: ReactNode;
  fallback?: (err: Error, name: string) => ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // v0.1: log to console; v0.2 wires Sentry or similar.
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary:${this.props.name}]`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.props.name);
      return (
        <div className="p-4 text-sm text-[var(--text-dim)] bg-[var(--surface-2)] rounded-md border border-[var(--border)]">
          <strong className="text-[var(--text)]">{this.props.name} error</strong> — reload to continue.
          <div className="mt-1 font-mono text-xs opacity-70">{this.state.error.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add components/ErrorBoundary.tsx tests/unit/components/ErrorBoundary.test.tsx
git commit -m "feat(components): ErrorBoundary (named fallback, console logging)"
```

---

## Task 11: TopBar (Transport + BPMBadge + ExportButton + RecIndicator)

**Files:**
- Create: `components/TopBar/Transport.tsx`
- Create: `components/TopBar/BPMBadge.tsx`
- Create: `components/TopBar/ExportButton.tsx`
- Create: `components/TopBar/RecIndicator.tsx`
- Create: `components/TopBar/index.tsx`

> `Transport` reads `timeline.playhead.playing` + `audio.grid` from the store, wires play/pause via the AudioEngine (provided by `useAudioEngine` further up — for this task, accept an `engine` prop and let the parent thread it). `BPMBadge` shows BPM, edits via `audioActions.setBPM`. `ExportButton` is disabled in v0.1. `RecIndicator` is a styled red dot — controlled by an `active` prop wired in Plan 6.

- [ ] **Step 1: Implement Transport**

```tsx
// components/TopBar/Transport.tsx
'use client';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/Button';
import type { AudioEngine } from '@/lib/audio/engine';

export function Transport({ engine }: { engine: AudioEngine | null }) {
  const playing = useAppStore((s) => s.timeline.playhead.playing);
  const setPlayhead = useAppStore((s) => s.timelineActions.setPlayhead);

  const toggle = async () => {
    if (!engine) return;
    if (playing) {
      engine.pause();
      useAppStore.setState((s) => ({
        timeline: { ...s.timeline, playhead: { ...s.timeline.playhead, playing: false } }
      }));
    } else {
      await engine.play();
      useAppStore.setState((s) => ({
        timeline: { ...s.timeline, playhead: { ...s.timeline.playhead, playing: true } }
      }));
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button variant="primary" size="sm" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '⏸︎' : '▶︎'}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          engine?.seek(0);
          setPlayhead(0);
        }}
        aria-label="Stop"
      >
        ⏹︎
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Implement BPMBadge**

```tsx
// components/TopBar/BPMBadge.tsx
'use client';
import { useState } from 'react';
import { useAppStore } from '@/lib/store';

export function BPMBadge() {
  const bpm = useAppStore((s) => s.audio.grid.bpm);
  const setBPM = useAppStore((s) => s.audioActions.setBPM);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(bpm));

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min={40}
        max={240}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (Number.isFinite(n) && n >= 40 && n <= 240) setBPM(n);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(String(bpm));
            setEditing(false);
          }
        }}
        className="w-16 h-7 px-1 bg-[var(--surface-2)] border border-[var(--border)] rounded text-sm"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(String(bpm));
        setEditing(true);
      }}
      className="h-7 px-2 rounded bg-[var(--surface-2)] border border-[var(--border)] text-xs font-mono"
      aria-label="Edit BPM"
    >
      {bpm.toFixed(0)} BPM
    </button>
  );
}
```

- [ ] **Step 3: Implement ExportButton + RecIndicator + index**

```tsx
// components/TopBar/ExportButton.tsx
'use client';
import { Button } from '@/components/ui/Button';
export function ExportButton() {
  return (
    <Button variant="secondary" size="sm" disabled title="Available in Plan 6">
      Export
    </Button>
  );
}
```

```tsx
// components/TopBar/RecIndicator.tsx
export function RecIndicator({ active = false }: { active?: boolean }) {
  return (
    <div
      aria-label={active ? 'Recording' : 'Idle'}
      className={`h-2 w-2 rounded-full ${active ? 'bg-red-500 animate-pulse' : 'bg-[var(--surface-3)]'}`}
    />
  );
}
```

```tsx
// components/TopBar/index.tsx
'use client';
import { Transport } from './Transport';
import { BPMBadge } from './BPMBadge';
import { ExportButton } from './ExportButton';
import { RecIndicator } from './RecIndicator';
import type { AudioEngine } from '@/lib/audio/engine';

export function TopBar({ engine }: { engine: AudioEngine | null }) {
  return (
    <header className="h-12 px-3 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-1)]">
      <div className="flex items-center gap-3">
        <Transport engine={engine} />
        <BPMBadge />
      </div>
      <div className="flex items-center gap-2">
        <RecIndicator />
        <ExportButton />
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck
git add components/TopBar
git commit -m "feat(components): TopBar (Transport, BPMBadge, ExportButton stub, RecIndicator)"
```

---

## Task 12: Workspace shell (3-col grid, local inspectorOpen)

**Files:**
- Create: `components/Workspace/index.tsx`

> Owns `inspectorOpen` as local `useState`. Three-column grid on `>=1024px`. On `640-1024px`, Inspector becomes a slide-over toggled by a tab icon. On `<640px`, stacks (LeftPanel only; Inspector and Stage hidden behind tabs in Plan 6 mobile).

- [ ] **Step 1: Implement**

```tsx
// components/Workspace/index.tsx
'use client';
import { useState } from 'react';
import { useAudioEngine } from '@/lib/hooks/useAudioEngine';
import { LeftPanel } from './LeftPanel';
import { Stage } from './Stage';
import { Timeline } from './Timeline';
import { Inspector } from './Inspector';
import { Button } from '@/components/ui/Button';

export function Workspace() {
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const { engine } = useAudioEngine();

  return (
    <div className="flex flex-1 min-h-0">
      <aside className="w-64 shrink-0 border-r border-[var(--border)] bg-[var(--surface-1)] overflow-y-auto">
        <LeftPanel />
      </aside>
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 min-h-0 relative">
          <Stage engine={engine} />
          <button
            type="button"
            aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
            onClick={() => setInspectorOpen((v) => !v)}
            className="absolute right-2 top-2 lg:hidden h-7 px-2 rounded bg-[var(--surface-2)] text-xs"
          >
            {inspectorOpen ? '›' : '‹'}
          </button>
        </div>
        <div className="h-64 shrink-0 border-t border-[var(--border)] bg-[var(--surface-1)]">
          <Timeline engine={engine} />
        </div>
      </main>
      {inspectorOpen && (
        <aside className="w-72 shrink-0 border-l border-[var(--border)] bg-[var(--surface-1)] overflow-y-auto">
          <Inspector />
        </aside>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit (placeholder children will be filled in later tasks)**

```bash
git add components/Workspace/index.tsx
git commit -m "feat(components): Workspace shell (3-col, local inspectorOpen, engine via useAudioEngine)"
```

> The placeholder children referenced (LeftPanel/Stage/Timeline/Inspector) are added in the next tasks; build will currently fail. That is intentional — Task 13 lands LeftPanel which is the first child to compile.

---

## Task 13: LeftPanel tabs + FxLibrary + LayersList

**Files:**
- Create: `components/Workspace/LeftPanel/index.tsx`
- Create: `components/Workspace/LeftPanel/FxLibrary.tsx`
- Create: `components/Workspace/LeftPanel/LayersList.tsx`
- Create: `components/Workspace/LeftPanel/MediaLibrary.tsx` (skeleton — Task 15 wires upload)

> Three tabs with local state. MediaLibrary lands here as a stub returning a placeholder; Task 15 wires the real upload + auto-preset.

- [ ] **Step 1: Implement LeftPanel index + FxLibrary + LayersList + MediaLibrary skeleton**

```tsx
// components/Workspace/LeftPanel/index.tsx
'use client';
import { useState } from 'react';
import { MediaLibrary } from './MediaLibrary';
import { FxLibrary } from './FxLibrary';
import { LayersList } from './LayersList';

type Tab = 'media' | 'fx' | 'layers';

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>('media');
  return (
    <div className="h-full flex flex-col">
      <nav className="flex border-b border-[var(--border)]">
        {(['media', 'fx', 'layers'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 h-9 text-xs uppercase tracking-wider ${
              tab === t ? 'text-[var(--text)] border-b-2 border-[var(--a1)]' : 'text-[var(--text-dim)]'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto p-2">
        {tab === 'media' && <MediaLibrary />}
        {tab === 'fx' && <FxLibrary />}
        {tab === 'layers' && <LayersList />}
      </div>
    </div>
  );
}
```

```tsx
// components/Workspace/LeftPanel/MediaLibrary.tsx
'use client';
export function MediaLibrary() {
  return <div className="text-xs text-[var(--text-dim)]">Media library — wired in Task 15.</div>;
}
```

```tsx
// components/Workspace/LeftPanel/FxLibrary.tsx
'use client';
import { listAllPlugins } from '@/lib/renderer/registry';
import { registerBuiltInPlugins } from '@/lib/fx';

registerBuiltInPlugins();

export function FxLibrary() {
  const plugins = listAllPlugins();
  return (
    <ul className="space-y-1">
      {plugins.map((p) => (
        <li
          key={p.id}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-vibegrid-fx', p.id);
          }}
          className="px-2 py-1.5 rounded bg-[var(--surface-2)] text-sm hover:bg-[var(--surface-3)] cursor-grab active:cursor-grabbing"
        >
          {p.name} <span className="text-[var(--text-dim)] text-xs">({p.kind})</span>
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// components/Workspace/LeftPanel/LayersList.tsx
'use client';
import { useAppStore } from '@/lib/store';
import { Toggle } from '@/components/ui/Toggle';

export function LayersList() {
  const tracks = useAppStore((s) => s.timeline.tracks);
  const setMuted = useAppStore((s) => s.timelineActions.setMuted);
  return (
    <ul className="space-y-1">
      {tracks.map((t) => (
        <li
          key={t.id}
          className="flex items-center justify-between px-2 py-1.5 rounded bg-[var(--surface-2)] text-sm"
        >
          <span>{t.name}</span>
          <Toggle checked={!t.muted} onChange={(v) => setMuted(t.id, !v)} label="On" />
        </li>
      ))}
    </ul>
  );
}
```

> `listAllPlugins` is added next.

- [ ] **Step 2: Add `listAllPlugins` to registry**

In `lib/renderer/registry.ts`, append (if not present):

```ts
export function listAllPlugins(): FxPlugin[] {
  return Array.from(registry.values());
}
```

(`registry` is the existing internal Map; check its name and adapt if different.)

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add components/Workspace/LeftPanel lib/renderer/registry.ts
git commit -m "feat(components): LeftPanel tabs + FxLibrary + LayersList (MediaLibrary stub)"
```

---

## Task 14: Stage + CanvasView

**Files:**
- Create: `components/Workspace/Stage/CanvasView.tsx`
- Create: `components/Workspace/Stage/index.tsx`

> CanvasView holds the ref and calls `useRenderer`. Stage wraps it in `<ErrorBoundary name="Stage">` (Spec §9.4).

- [ ] **Step 1: Implement CanvasView**

```tsx
// components/Workspace/Stage/CanvasView.tsx
'use client';
import { useRef } from 'react';
import { useRenderer } from '@/lib/hooks/useRenderer';
import type { AudioEngine } from '@/lib/audio/engine';

export function CanvasView({ engine }: { engine: AudioEngine | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useRenderer({
    canvasRef: ref,
    getCurrentTime: () => engine?.getState().currentTime ?? 0
  });
  return (
    <canvas
      ref={ref}
      className="block w-full h-full bg-black"
      style={{ aspectRatio: '16/9' }}
    />
  );
}
```

- [ ] **Step 2: Implement Stage**

```tsx
// components/Workspace/Stage/index.tsx
'use client';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CanvasView } from './CanvasView';
import type { AudioEngine } from '@/lib/audio/engine';

export function Stage({ engine }: { engine: AudioEngine | null }) {
  return (
    <ErrorBoundary name="Stage">
      <div className="h-full w-full flex items-center justify-center bg-black">
        <div className="max-w-full max-h-full w-full" style={{ aspectRatio: '16/9' }}>
          <CanvasView engine={engine} />
        </div>
      </div>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add components/Workspace/Stage
git commit -m "feat(components): Stage + CanvasView (ErrorBoundary + useRenderer)"
```

---

## Task 15: MediaLibrary with upload + AutoPresetButton hook-up

**Files:**
- Rewrite: `components/Workspace/LeftPanel/MediaLibrary.tsx`
- Create: `components/Workspace/LeftPanel/AutoPresetButton.tsx`
- Create: `tests/unit/components/MediaLibrary.test.tsx`
- Create: `tests/unit/components/AutoPresetButton.test.tsx`

> MediaLibrary: file input + dropzone, calls `useMediaUpload().upload(file, kind)`, shows resulting `mediaRef[]`. AutoPresetButton is rendered next to each image entry; disabled when there is no active FX clip (selection model: `useAppStore`'s `selectedClipId` — added below).

- [ ] **Step 1: Add `selectedClipId` to UIState**

In `lib/store/types.ts`:

```ts
export interface UIState {
  zoom: number;
  selectedClipId: string | null;
}
```

Add a setter to `AppState`:

```ts
setSelectedClipId(id: string | null): void;
```

In `lib/store/index.ts`, in the initialiser:

```ts
ui: { zoom: 1, selectedClipId: null },
setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
setSelectedClipId: (id) => set((s) => ({ ui: { ...s.ui, selectedClipId: id } })),
```

- [ ] **Step 2: MediaLibrary**

```tsx
// components/Workspace/LeftPanel/MediaLibrary.tsx
'use client';
import { useRef } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { useMediaUpload } from '@/lib/hooks/useMediaUpload';
import { AutoPresetButton } from './AutoPresetButton';

export function MediaLibrary() {
  const refs = useAppStore((s) => s.media.mediaRefs);
  const { upload } = useMediaUpload();
  const imageInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  const handle = async (file: File, kind: 'image' | 'audio') => {
    try {
      await upload(file, kind);
      toast.success(`Uploaded ${file.name}`);
    } catch (err) {
      toast.error(`Upload failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => imageInput.current?.click()}
          className="flex-1 h-8 rounded border border-dashed border-[var(--border)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-2)]"
        >
          + Image
        </button>
        <input
          ref={imageInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => e.target.files?.[0] && handle(e.target.files[0], 'image')}
        />
        <button
          type="button"
          onClick={() => audioInput.current?.click()}
          className="flex-1 h-8 rounded border border-dashed border-[var(--border)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-2)]"
        >
          + Audio
        </button>
        <input
          ref={audioInput}
          type="file"
          accept="audio/mpeg,audio/wav,audio/mp4"
          hidden
          onChange={(e) => e.target.files?.[0] && handle(e.target.files[0], 'audio')}
        />
      </div>
      <ul className="space-y-1">
        {refs.map((r) => (
          <li
            key={r.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(
                `application/x-vibegrid-media-${r.kind}`,
                r.id
              );
            }}
            className="flex items-center gap-2 p-2 rounded bg-[var(--surface-2)] text-xs"
          >
            <span className="flex-1 truncate" title={r.filename}>
              {r.filename}
              <span className="block text-[var(--text-muted)]">
                {r.kind === 'image' && r.width && r.height ? `${r.width}×${r.height}` : null}
                {r.kind === 'audio' && r.duration ? `${r.duration.toFixed(1)}s` : null}
              </span>
            </span>
            {r.kind === 'image' && <AutoPresetButton mediaRef={r} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: AutoPresetButton**

```tsx
// components/Workspace/LeftPanel/AutoPresetButton.tsx
'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { fetchAutoPreset } from '@/lib/storage/auto-preset-adapter';
import { getPlugin } from '@/lib/renderer/registry';
import type { MediaRef } from '@/lib/storage/types';

export function AutoPresetButton({ mediaRef }: { mediaRef: MediaRef }) {
  const selectedClipId = useAppStore((s) => s.ui.selectedClipId);
  const clip = useAppStore((s) =>
    selectedClipId ? s.timeline.clips.find((c) => c.id === selectedClipId) : undefined
  );
  const setClipParam = useAppStore((s) => s.timelineActions.setClipParam);
  const [loading, setLoading] = useState(false);

  const fxId = clip?.fxId;
  const plugin = fxId ? getPlugin(fxId) : undefined;
  const disabled = !plugin || loading;

  const onClick = async () => {
    if (!plugin || !clip) return;
    setLoading(true);
    const tId = toast.loading('Analysing image…');
    try {
      const params = await fetchAutoPreset({
        imageUrl: mediaRef.url,
        fxId: plugin.id,
        paramSchema: plugin.paramSchema
      });
      for (const [k, v] of Object.entries(params)) {
        setClipParam(clip.id, k, v);
      }
      toast.success('✨ Preset applied', { id: tId });
    } catch (err) {
      toast.error(`Auto-preset failed: ${err instanceof Error ? err.message : 'unknown'}`, { id: tId });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={
        !plugin
          ? 'Select an FX clip in the timeline first'
          : `Auto-preset for ${plugin.name}`
      }
      className="h-6 px-1.5 rounded bg-[var(--a1)] text-white text-xs disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {loading ? '…' : '✨'}
    </button>
  );
}
```

- [ ] **Step 4: Tests**

```tsx
// tests/unit/components/MediaLibrary.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MediaLibrary } from '@/components/Workspace/LeftPanel/MediaLibrary';
import { useAppStore } from '@/lib/store';

vi.mock('@/lib/storage/r2-adapter', () => ({
  createR2StorageAdapter: () => ({
    uploadImage: vi.fn().mockResolvedValue({
      id: 'm1',
      kind: 'image',
      url: 'https://x/m1.jpg',
      filename: 'a.jpg',
      uploadedAt: '2026-05-19T00:00:00.000Z'
    }),
    uploadAudio: vi.fn().mockResolvedValue({
      id: 'm2',
      kind: 'audio',
      url: 'https://x/m2.mp3',
      filename: 'b.mp3',
      uploadedAt: '2026-05-19T00:00:00.000Z'
    })
  })
}));

describe('MediaLibrary', () => {
  beforeEach(() => {
    useAppStore.setState({ media: { mediaRefs: [] } });
  });

  it('renders existing media refs', () => {
    useAppStore.setState({
      media: {
        mediaRefs: [
          {
            id: 'm0',
            kind: 'image',
            url: 'https://x/0.jpg',
            filename: 'x.jpg',
            width: 100,
            height: 50,
            uploadedAt: '2026-05-19T00:00:00.000Z'
          }
        ]
      }
    });
    render(<MediaLibrary />);
    expect(screen.getByText('x.jpg')).toBeInTheDocument();
    expect(screen.getByText('100×50')).toBeInTheDocument();
  });

  it('uploading an image calls adapter and stores the ref', async () => {
    render(<MediaLibrary />);
    const inputs = screen
      .getAllByRole('button')
      .map((b) => b.parentElement?.querySelector('input[type=file]'))
      .filter(Boolean) as HTMLInputElement[];
    const imageInput = inputs[0];
    const file = new File([new Uint8Array([0xff, 0xd8])], 'a.jpg', { type: 'image/jpeg' });
    Object.defineProperty(imageInput, 'files', { value: [file] });
    fireEvent.change(imageInput);
    await waitFor(() => {
      expect(useAppStore.getState().media.mediaRefs).toHaveLength(1);
    });
  });

  it('drag-start sets the correct dataTransfer type', () => {
    useAppStore.setState({
      media: {
        mediaRefs: [
          {
            id: 'm0',
            kind: 'image',
            url: 'https://x/0.jpg',
            filename: 'x.jpg',
            uploadedAt: '2026-05-19T00:00:00.000Z'
          }
        ]
      }
    });
    render(<MediaLibrary />);
    const item = screen.getByText('x.jpg').closest('li')!;
    const setData = vi.fn();
    fireEvent.dragStart(item, { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith('application/x-vibegrid-media-image', 'm0');
  });
});
```

```tsx
// tests/unit/components/AutoPresetButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AutoPresetButton } from '@/components/Workspace/LeftPanel/AutoPresetButton';
import { useAppStore } from '@/lib/store';
import * as adapter from '@/lib/storage/auto-preset-adapter';
import { registerBuiltInPlugins, _resetBuiltInPluginsForTests } from '@/lib/fx';

const mediaRef = {
  id: 'm0',
  kind: 'image' as const,
  url: 'https://x/0.jpg',
  filename: 'x.jpg',
  uploadedAt: '2026-05-19T00:00:00.000Z'
};

describe('AutoPresetButton', () => {
  beforeEach(() => {
    // Registry reset+register defends against cross-test contamination —
    // singleThread vitest shares module state with renderer tests that may
    // have called _resetRegistryForTests directly.
    _resetBuiltInPluginsForTests();
    registerBuiltInPlugins();
    useAppStore.setState({
      ui: { zoom: 1, selectedClipId: null },
      timeline: {
        tracks: [{ id: 't1', kind: 'pulse', name: 'P', muted: false, order: 0 }],
        clips: [
          {
            id: 'c1',
            trackId: 't1',
            kind: 'pulse',
            fxId: 'pulse',
            startBeat: 0,
            lengthBeats: 4,
            label: 'P',
            params: { intensity: 0.5, color: '#fff' }
          }
        ],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      }
    });
  });

  it('is disabled without an active FX clip', () => {
    render(<AutoPresetButton mediaRef={mediaRef} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('calls adapter and writes params when active clip exists', async () => {
    useAppStore.setState((s) => ({ ui: { ...s.ui, selectedClipId: 'c1' } }));
    vi.spyOn(adapter, 'fetchAutoPreset').mockResolvedValue({ intensity: 0.9, color: '#abc' });
    render(<AutoPresetButton mediaRef={mediaRef} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(useAppStore.getState().timeline.clips[0].params?.intensity).toBe(0.9);
      expect(useAppStore.getState().timeline.clips[0].params?.color).toBe('#abc');
    });
  });

  it('shows error toast on adapter failure (no crash)', async () => {
    useAppStore.setState((s) => ({ ui: { ...s.ui, selectedClipId: 'c1' } }));
    vi.spyOn(adapter, 'fetchAutoPreset').mockRejectedValue(new Error('rate limited'));
    render(<AutoPresetButton mediaRef={mediaRef} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      // Button re-enables after failure
      expect(screen.getByRole('button')).not.toBeDisabled();
    });
  });
});
```

- [ ] **Step 5: Run — expect PASS**

```
npm test -- MediaLibrary AutoPresetButton
```

- [ ] **Step 6: Commit**

```bash
git add lib/store/types.ts lib/store/index.ts components/Workspace/LeftPanel/MediaLibrary.tsx components/Workspace/LeftPanel/AutoPresetButton.tsx tests/unit/components/MediaLibrary.test.tsx tests/unit/components/AutoPresetButton.test.tsx
git commit -m "feat(components): MediaLibrary upload + AutoPresetButton (server-driven preset)"
```

---

## Task 16: Auto-preset — schema validator (pure)

**Files:**
- Create: `lib/ai/schema-validator.ts`
- Create: `tests/unit/ai/schema-validator.test.ts`

> Pure function (no SDK). Validates a raw object against a `ParamSchema`: clamps sliders to [min, max] and snaps to step, checks color is `#rrggbb`, ensures select value is in options, coerces toggle to boolean. Used server-side after Claude responds AND optionally client-side for an optimistic check.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/ai/schema-validator.test.ts
import { describe, it, expect } from 'vitest';
import { validateAgainstParamSchema } from '@/lib/ai/schema-validator';
import type { ParamSchema } from '@/lib/renderer/types';

const schema: ParamSchema = {
  intensity: { kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, label: 'I' },
  color: { kind: 'color', default: '#ffffff', label: 'C' },
  mode: {
    kind: 'select',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' }
    ],
    default: 'a',
    label: 'M'
  },
  on: { kind: 'toggle', default: false, label: 'O' }
};

describe('validateAgainstParamSchema', () => {
  it('clamps slider value above max', () => {
    const r = validateAgainstParamSchema({ intensity: 2 }, schema);
    expect(r.intensity).toBe(1);
  });
  it('clamps slider value below min', () => {
    const r = validateAgainstParamSchema({ intensity: -5 }, schema);
    expect(r.intensity).toBe(0);
  });
  it('snaps slider to step', () => {
    const r = validateAgainstParamSchema({ intensity: 0.51 }, schema);
    expect(r.intensity).toBeCloseTo(0.5);
  });
  it('accepts valid hex color', () => {
    const r = validateAgainstParamSchema({ color: '#abcdef' }, schema);
    expect(r.color).toBe('#abcdef');
  });
  it('rejects invalid hex color → falls back to default', () => {
    const r = validateAgainstParamSchema({ color: 'red' }, schema);
    expect(r.color).toBe('#ffffff');
  });
  it('select value must match an option', () => {
    const r = validateAgainstParamSchema({ mode: 'b' }, schema);
    expect(r.mode).toBe('b');
    const r2 = validateAgainstParamSchema({ mode: 'z' }, schema);
    expect(r2.mode).toBe('a'); // default
  });
  it('toggle coerces truthy/falsy to boolean', () => {
    expect(validateAgainstParamSchema({ on: 1 }, schema).on).toBe(true);
    expect(validateAgainstParamSchema({ on: 0 }, schema).on).toBe(false);
  });
  it('missing key gets default', () => {
    const r = validateAgainstParamSchema({}, schema);
    expect(r.intensity).toBe(0.5);
    expect(r.color).toBe('#ffffff');
    expect(r.mode).toBe('a');
    expect(r.on).toBe(false);
  });
  it('extra keys are dropped', () => {
    const r = validateAgainstParamSchema({ intensity: 0.5, junk: 'x' }, schema);
    expect((r as Record<string, unknown>).junk).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// lib/ai/schema-validator.ts
import type { ParamSchema, ParamType } from '@/lib/renderer/types';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function clampSnap(v: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, v));
  if (step <= 0) return clamped;
  return Math.round((clamped - min) / step) * step + min;
}

function validateOne(raw: unknown, schema: ParamType & { label: string }): unknown {
  switch (schema.kind) {
    case 'slider': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return schema.default;
      return clampSnap(n, schema.min, schema.max, schema.step);
    }
    case 'color':
      return typeof raw === 'string' && HEX_RE.test(raw) ? raw : schema.default;
    case 'select':
      return typeof raw === 'string' && schema.options.some((o) => o.value === raw)
        ? raw
        : schema.default;
    case 'toggle':
      return Boolean(raw);
  }
}

export function validateAgainstParamSchema(
  raw: Record<string, unknown>,
  schema: ParamSchema
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, sub] of Object.entries(schema)) {
    out[key] = validateOne(raw[key], sub);
  }
  return out;
}
```

- [ ] **Step 3: Run + commit**

```bash
npm test -- schema-validator
git add lib/ai/schema-validator.ts tests/unit/ai/schema-validator.test.ts
git commit -m "feat(ai): schema validator (slider clamp+snap, color, select, toggle, default fill)"
```

---

## Task 17: Auto-preset — Anthropic env + client

**Files:**
- Create: `lib/ai/env.ts`
- Create: `lib/ai/anthropic.ts`
- Modify: `.env.example`

> Server-only modules following the Plan 4 R2 pattern. `getAnthropicConfig()` validates `ANTHROPIC_API_KEY`. `analyzeImageForFx(imageBytes, fxName, paramSchema)` calls the Messages API with `model: 'claude-sonnet-4-6'`, an image part, and a structured system prompt that asks for JSON.

- [ ] **Step 1: Modify `.env.example`**

Append:

```env
# Auto-preset (Claude vision)
ANTHROPIC_API_KEY=
```

- [ ] **Step 2: Implement env**

```ts
// lib/ai/env.ts
import 'server-only';

export interface AnthropicConfig {
  apiKey: string;
  model: string;
}

let cached: AnthropicConfig | null = null;

export function getAnthropicConfig(): AnthropicConfig {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    throw new Error('Missing required env var: ANTHROPIC_API_KEY');
  }
  cached = { apiKey, model: 'claude-sonnet-4-6' };
  return cached;
}

export function _resetAnthropicConfigForTests(): void {
  cached = null;
}
```

- [ ] **Step 3: Implement client wrapper**

```ts
// lib/ai/anthropic.ts
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicConfig } from './env';
import type { ParamSchema } from '@/lib/renderer/types';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  const cfg = getAnthropicConfig();
  client = new Anthropic({ apiKey: cfg.apiKey });
  return client;
}

export function _resetAnthropicClientForTests(): void {
  client = null;
}

/**
 * Asks Claude to suggest FX parameters for the given image.
 * Returns the raw object (server route validates against the schema after).
 */
export async function analyzeImageForFx(args: {
  imageBytes: Uint8Array;
  imageMime: string;
  fxName: string;
  paramSchema: ParamSchema;
}): Promise<Record<string, unknown>> {
  const cfg = getAnthropicConfig();
  const cli = getClient();

  const base64 = Buffer.from(args.imageBytes).toString('base64');
  const schemaSummary = Object.entries(args.paramSchema)
    .map(([k, s]) => {
      switch (s.kind) {
        case 'slider':
          return `- ${k}: number in [${s.min}, ${s.max}], step ${s.step}`;
        case 'color':
          return `- ${k}: hex color (#rrggbb)`;
        case 'select':
          return `- ${k}: one of ${s.options.map((o) => `"${o.value}"`).join(', ')}`;
        case 'toggle':
          return `- ${k}: boolean`;
      }
    })
    .join('\n');

  const sys = `You suggest visual-effect parameter values that match the mood and content of an image. Return ONLY a JSON object — no prose, no markdown fences.`;
  const userText = `Effect: "${args.fxName}". Choose values for each parameter:\n${schemaSummary}\n\nReturn a JSON object whose keys exactly match the parameter names above.`;

  const res = await cli.messages.create({
    model: cfg.model,
    max_tokens: 512,
    system: sys,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: args.imageMime, data: base64 }
          },
          { type: 'text', text: userText }
        ]
      }
    ]
  });

  const textBlock = res.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('analyzeImageForFx: no text content in Claude response');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text.trim());
  } catch {
    throw new Error('analyzeImageForFx: response is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('analyzeImageForFx: response is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck
git add lib/ai/env.ts lib/ai/anthropic.ts .env.example
git commit -m "feat(ai): Anthropic client wrapper (server-only, claude-sonnet-4-6 vision)"
```

---

## Task 18: /api/analyze-image route + integration test

**Files:**
- Create: `app/api/analyze-image/route.ts`
- Create: `tests/integration/analyze-image.api.test.ts`

> POST handler. Reads `{ imageUrl, fxId }` from JSON body. Fetches the image, identifies the plugin from the registry, calls `analyzeImageForFx`, validates response against the plugin's schema, returns the params.

- [ ] **Step 1: Implement route**

```ts
// app/api/analyze-image/route.ts
export const runtime = 'nodejs';

import { analyzeImageForFx } from '@/lib/ai/anthropic';
import { validateAgainstParamSchema } from '@/lib/ai/schema-validator';
import { getPlugin } from '@/lib/renderer/registry';
import { registerBuiltInPlugins } from '@/lib/fx';

interface ReqBody {
  imageUrl?: unknown;
  fxId?: unknown;
}

function bad(status: number, code: string, error: string): Response {
  return Response.json({ error, code }, { status });
}

export async function POST(req: Request): Promise<Response> {
  registerBuiltInPlugins();

  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return bad(400, 'INVALID_JSON', 'Body must be JSON');
  }
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
  const fxId = typeof body.fxId === 'string' ? body.fxId : '';
  if (!imageUrl || !fxId) {
    return bad(400, 'MISSING_FIELDS', 'imageUrl and fxId are required');
  }
  const plugin = getPlugin(fxId);
  if (!plugin) {
    return bad(404, 'UNKNOWN_FX', `Unknown fxId: ${fxId}`);
  }

  const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  let imageBytes: Uint8Array;
  let imageMime: string;
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`image fetch ${imgRes.status}`);
    // Strip MIME parameters (e.g. `image/webp; charset=binary` from some object
    // stores) — Anthropic's SDK only accepts the bare media_type.
    const rawMime = (imgRes.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
    if (!ALLOWED_IMAGE_MIMES.has(rawMime)) {
      throw new Error(`unsupported image MIME for analyze: ${rawMime}`);
    }
    imageMime = rawMime;
    imageBytes = new Uint8Array(await imgRes.arrayBuffer());
  } catch (err) {
    return bad(
      502,
      'IMAGE_FETCH_FAILED',
      err instanceof Error ? err.message : 'image fetch failed'
    );
  }

  let raw: Record<string, unknown>;
  try {
    raw = await analyzeImageForFx({
      imageBytes,
      imageMime,
      fxName: plugin.name,
      paramSchema: plugin.paramSchema
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (msg.includes('Missing required env var')) {
      return bad(503, 'AI_NOT_CONFIGURED', msg);
    }
    return bad(502, 'AI_ERROR', msg);
  }

  const validated = validateAgainstParamSchema(raw, plugin.paramSchema);
  return Response.json({ fxId, params: validated }, { status: 200 });
}
```

- [ ] **Step 2: Write integration test**

```ts
// tests/integration/analyze-image.api.test.ts
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

const messagesCreate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ intensity: 0.7, color: '#ff00aa' })
      }
    ]
  })
);

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: messagesCreate }
  }))
}));

process.env.ANTHROPIC_API_KEY = 'sk-test';

import { POST } from '@/app/api/analyze-image/route';
import { _resetAnthropicClientForTests } from '@/lib/ai/anthropic';
import { _resetAnthropicConfigForTests } from '@/lib/ai/env';
import { _resetBuiltInPluginsForTests } from '@/lib/fx';

function req(body: unknown): Request {
  return new Request('http://localhost/api/analyze-image', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  });
}

describe('POST /api/analyze-image', () => {
  beforeEach(() => {
    messagesCreate.mockClear();
    _resetAnthropicClientForTests();
    _resetAnthropicConfigForTests();
    // Reset the plugin registry so the route's own registerBuiltInPlugins()
    // actually re-registers (otherwise the `registered` flag may be true
    // while the registry is empty from a prior renderer test).
    _resetBuiltInPluginsForTests();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' }
      })
    );
  });

  it('happy path returns validated params for the pulse plugin', async () => {
    const res = await POST(req({ imageUrl: 'https://x/img.jpg', fxId: 'pulse' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fxId).toBe('pulse');
    expect(body.params.intensity).toBeCloseTo(0.7);
    expect(body.params.color).toBe('#ff00aa');
    expect(messagesCreate).toHaveBeenCalledTimes(1);
  });

  it('malformed Claude response → 502', async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not json' }]
    });
    const res = await POST(req({ imageUrl: 'https://x/img.jpg', fxId: 'pulse' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('AI_ERROR');
  });

  it('image fetch failure → 502', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 }));
    const res = await POST(req({ imageUrl: 'https://x/missing.jpg', fxId: 'pulse' }));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('IMAGE_FETCH_FAILED');
  });

  it('missing env var → 503', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    _resetAnthropicConfigForTests();
    _resetAnthropicClientForTests();
    const res = await POST(req({ imageUrl: 'https://x/img.jpg', fxId: 'pulse' }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('AI_NOT_CONFIGURED');
  });

  it('unknown fxId → 404', async () => {
    const res = await POST(req({ imageUrl: 'https://x/img.jpg', fxId: 'nonexistent' }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('UNKNOWN_FX');
  });
});
```

- [ ] **Step 3: Run — expect PASS**

```
npm test -- analyze-image
```

- [ ] **Step 4: Commit**

```bash
git add app/api/analyze-image/route.ts tests/integration/analyze-image.api.test.ts
git commit -m "feat(api): POST /api/analyze-image — Claude vision → validated FX params"
```

---

## Task 19: Auto-preset client adapter

**Files:**
- Create: `lib/storage/auto-preset-adapter.ts`
- Create: `tests/unit/storage/auto-preset-adapter.test.ts`

- [ ] **Step 1: Implement**

```ts
// lib/storage/auto-preset-adapter.ts
import type { ParamSchema } from '@/lib/renderer/types';
import { validateAgainstParamSchema } from '@/lib/ai/schema-validator';

export interface FetchAutoPresetArgs {
  imageUrl: string;
  fxId: string;
  paramSchema: ParamSchema;
  endpoint?: string;
}

export async function fetchAutoPreset(args: FetchAutoPresetArgs): Promise<Record<string, unknown>> {
  const endpoint = args.endpoint ?? '/api/analyze-image';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageUrl: args.imageUrl, fxId: args.fxId })
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const b = (await res.json()) as { code?: string; error?: string };
      detail = b.code || b.error || detail;
    } catch {
      // keep status
    }
    throw new Error(`Auto-preset failed: ${detail}`);
  }
  const body = (await res.json()) as { params: Record<string, unknown> };
  // Defensive client-side re-validation so a buggy server can't poison the store.
  return validateAgainstParamSchema(body.params, args.paramSchema);
}
```

- [ ] **Step 2: Test**

```ts
// tests/unit/storage/auto-preset-adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { fetchAutoPreset } from '@/lib/storage/auto-preset-adapter';
import type { ParamSchema } from '@/lib/renderer/types';

const schema: ParamSchema = {
  intensity: { kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, label: 'I' }
};

describe('fetchAutoPreset', () => {
  it('posts the imageUrl and fxId, returns validated params', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ params: { intensity: 0.8 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    const out = await fetchAutoPreset({
      imageUrl: 'https://x/a.jpg',
      fxId: 'pulse',
      paramSchema: schema
    });
    expect(out.intensity).toBe(0.8);
    expect(spy).toHaveBeenCalledWith('/api/analyze-image', expect.objectContaining({ method: 'POST' }));
  });

  it('throws with code on 4xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'UNKNOWN_FX' }), { status: 404 })
    );
    await expect(
      fetchAutoPreset({ imageUrl: 'x', fxId: 'nope', paramSchema: schema })
    ).rejects.toThrow(/UNKNOWN_FX/);
  });

  it('re-validates server response against schema (clamps misbehaving server)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ params: { intensity: 99 } }), { status: 200 })
    );
    const out = await fetchAutoPreset({
      imageUrl: 'x',
      fxId: 'pulse',
      paramSchema: schema
    });
    expect(out.intensity).toBe(1); // clamped to max
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
npm test -- auto-preset-adapter
git add lib/storage/auto-preset-adapter.ts tests/unit/storage/auto-preset-adapter.test.ts
git commit -m "feat(storage): auto-preset client adapter (server fetch + defensive re-validation)"
```

---

## Task 20: Inspector + PreloadIndicator (Watchlist 5)

**Files:**
- Create: `components/Workspace/Inspector/PreloadIndicator.tsx`
- Create: `components/Workspace/Inspector/index.tsx`
- Create: `tests/unit/components/Inspector.test.tsx`

> Builds an auto-form from the active clip's plugin's `paramSchema`. Each control wires through `setClipParam`. Shows a small `PreloadIndicator` next to the FX name while `plugin.preloadState === 'loading'`.

- [ ] **Step 1: Implement PreloadIndicator**

```tsx
// components/Workspace/Inspector/PreloadIndicator.tsx
'use client';
import type { PreloadState } from '@/lib/renderer/types';

export function PreloadIndicator({ state }: { state: PreloadState }) {
  if (state === 'idle' || state === 'ready') return null;
  if (state === 'error') {
    return (
      <span className="text-xs text-red-400" aria-label="Preload error">
        ⚠ preload error
      </span>
    );
  }
  // loading
  return (
    <span
      role="status"
      aria-label="Preloading"
      className="inline-flex items-center gap-1 text-xs text-[var(--text-dim)]"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--a1)] animate-pulse" />
      preloading…
    </span>
  );
}
```

- [ ] **Step 2: Implement Inspector**

```tsx
// components/Workspace/Inspector/index.tsx
'use client';
import { useAppStore } from '@/lib/store';
import { getPlugin } from '@/lib/renderer/registry';
import { ParamControl } from '@/components/ui/ParamControl';
import { PreloadIndicator } from './PreloadIndicator';
import { isAutomationCurve } from '@/lib/automation/resolve';

export function Inspector() {
  const selectedClipId = useAppStore((s) => s.ui.selectedClipId);
  const clip = useAppStore((s) =>
    selectedClipId ? s.timeline.clips.find((c) => c.id === selectedClipId) : undefined
  );
  const setClipParam = useAppStore((s) => s.timelineActions.setClipParam);

  if (!clip || !clip.fxId) {
    return <div className="p-3 text-xs text-[var(--text-dim)]">Wähle einen Clip oder Effekt aus.</div>;
  }
  const plugin = getPlugin(clip.fxId);
  if (!plugin) {
    return <div className="p-3 text-xs text-[var(--text-dim)]">FX {clip.fxId} not registered.</div>;
  }

  const params = clip.params ?? plugin.getDefaultParams();

  return (
    <div className="p-3 space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{plugin.name}</div>
          <div className="text-xs text-[var(--text-dim)]">{plugin.kind}</div>
        </div>
        <PreloadIndicator state={plugin.preloadState} />
      </header>
      <div className="space-y-2">
        {Object.entries(plugin.paramSchema).map(([key, schema]) => {
          const raw = (params as Record<string, unknown>)[key];
          // Inspector edits static values only — show the curve's first point if automated.
          const display = isAutomationCurve(raw) ? raw.points[0]?.value : raw;
          return (
            <label key={key} className="block">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[var(--text-dim)]">{schema.label}</span>
                {isAutomationCurve(raw) && (
                  <span className="text-[10px] uppercase text-[var(--a2)]">automated</span>
                )}
              </div>
              <ParamControl
                paramKey={key}
                schema={schema}
                value={display}
                onChange={(v) => setClipParam(clip.id, key, v)}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Test**

```tsx
// tests/unit/components/Inspector.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Inspector } from '@/components/Workspace/Inspector';
import { useAppStore } from '@/lib/store';
import { registerBuiltInPlugins, _resetBuiltInPluginsForTests } from '@/lib/fx';

describe('Inspector', () => {
  beforeEach(() => {
    // Defend against cross-test contamination — singleThread vitest shares
    // module state with renderer tests that reset the registry directly.
    _resetBuiltInPluginsForTests();
    registerBuiltInPlugins();
    useAppStore.setState({
      ui: { zoom: 1, selectedClipId: null },
      timeline: {
        tracks: [{ id: 't1', kind: 'pulse', name: 'P', muted: false, order: 0 }],
        clips: [
          {
            id: 'c1',
            trackId: 't1',
            kind: 'pulse',
            fxId: 'pulse',
            startBeat: 0,
            lengthBeats: 4,
            label: 'P',
            params: { intensity: 0.5, color: '#ffffff' }
          }
        ],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      }
    });
  });

  it('shows empty state when no clip is selected', () => {
    render(<Inspector />);
    expect(screen.getByText(/Wähle einen Clip/)).toBeInTheDocument();
  });

  it('renders controls from the plugin paramSchema when a clip is selected', () => {
    useAppStore.setState((s) => ({ ui: { ...s.ui, selectedClipId: 'c1' } }));
    render(<Inspector />);
    expect(screen.getByText('Pulse')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });

  it('edit calls setClipParam for the changed key', () => {
    useAppStore.setState((s) => ({ ui: { ...s.ui, selectedClipId: 'c1' } }));
    render(<Inspector />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.input(slider, { target: { value: '0.9' } });
    expect(useAppStore.getState().timeline.clips[0].params?.intensity).toBe(0.9);
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
npm test -- Inspector
git add components/Workspace/Inspector tests/unit/components/Inspector.test.tsx
git commit -m "feat(components): Inspector (auto-form, PreloadIndicator, automation-aware display)"
```

---

## Task 21: Timeline — Toolbar + Ruler + Tracks + Clip + Playhead

**Files:**
- Create: `components/Workspace/Timeline/Toolbar.tsx`
- Create: `components/Workspace/Timeline/Ruler.tsx`
- Create: `components/Workspace/Timeline/Tracks.tsx`
- Create: `components/Workspace/Timeline/Clip.tsx`
- Create: `components/Workspace/Timeline/Playhead.tsx`
- Create: `components/Workspace/Timeline/index.tsx`
- Create: `tests/unit/components/Timeline/Clip.test.tsx`

> Mid-density: Toolbar (snap + zoom), Ruler (beat ticks), Tracks (rows + drop targets for FX from FxLibrary or media from MediaLibrary), Clip (dnd-kit draggable + custom resize handle), Playhead (vertical line). Click on a Clip sets `selectedClipId`.

- [ ] **Step 1: Toolbar**

```tsx
// components/Workspace/Timeline/Toolbar.tsx
'use client';
import { useAppStore } from '@/lib/store';
import { SelectControl } from '@/components/ui/SelectControl';
import { Slider } from '@/components/ui/Slider';

export function Toolbar() {
  const zoom = useAppStore((s) => s.ui.zoom);
  const setZoom = useAppStore((s) => s.setZoom);
  const snap = useAppStore((s) => s.timeline.snap);
  // Snap is part of timeline state — extend timelineActions if not yet present.
  const setSnap = (v: 'beat' | 'half' | 'quarter' | 'off') =>
    useAppStore.setState((s) => ({ timeline: { ...s.timeline, snap: v } }));

  return (
    <div className="h-8 px-2 flex items-center gap-3 border-b border-[var(--border)]">
      <label className="flex items-center gap-1 text-xs text-[var(--text-dim)]">
        Snap
        <SelectControl
          value={snap}
          onChange={(v) => setSnap(v as 'beat' | 'half' | 'quarter' | 'off')}
          options={[
            { value: 'beat', label: '1/1' },
            { value: 'half', label: '1/2' },
            { value: 'quarter', label: '1/4' },
            { value: 'off', label: 'off' }
          ]}
          label="Snap"
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-[var(--text-dim)] w-40">
        Zoom
        <Slider min={0.5} max={3} step={0.1} value={zoom} onChange={setZoom} label="Zoom" />
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Ruler**

```tsx
// components/Workspace/Timeline/Ruler.tsx
'use client';
import { useAppStore } from '@/lib/store';

const BEAT_PX_BASE = 40; // at zoom 1

export function Ruler({ totalBeats = 64 }: { totalBeats?: number }) {
  const zoom = useAppStore((s) => s.ui.zoom);
  const px = BEAT_PX_BASE * zoom;
  const ticks = Array.from({ length: totalBeats + 1 }, (_, i) => i);
  return (
    <div className="h-6 relative border-b border-[var(--border)] bg-[var(--surface-1)] overflow-hidden">
      <div className="absolute inset-0" style={{ width: totalBeats * px }}>
        {ticks.map((i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 text-[10px] text-[var(--text-muted)] border-l border-[var(--border)] pl-1"
            style={{ left: i * px }}
          >
            {i % 4 === 0 ? i / 4 + 1 : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Clip (draggable + resizable)**

```tsx
// components/Workspace/Timeline/Clip.tsx
'use client';
import { useDraggable } from '@dnd-kit/core';
import { useAppStore } from '@/lib/store';
import type { Clip as ClipT } from '@/lib/timeline/types';

const BEAT_PX_BASE = 40;

export function Clip({ clip }: { clip: ClipT }) {
  const zoom = useAppStore((s) => s.ui.zoom);
  const px = BEAT_PX_BASE * zoom;
  const selected = useAppStore((s) => s.ui.selectedClipId === clip.id);
  const setSelected = useAppStore((s) => s.setSelectedClipId);
  const resizeClip = useAppStore((s) => s.timelineActions.resizeClip);

  const { setNodeRef, listeners, attributes, transform } = useDraggable({
    id: clip.id,
    data: { kind: 'clip', clipId: clip.id }
  });

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const startX = e.clientX;
    const startLen = clip.lengthBeats;
    const move = (ev: PointerEvent) => {
      const dxBeats = (ev.clientX - startX) / px;
      const next = Math.max(0.25, startLen + dxBeats);
      resizeClip(clip.id, next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => setSelected(clip.id)}
      style={{
        left: clip.startBeat * px + (transform?.x ?? 0),
        width: clip.lengthBeats * px,
        transform: transform ? `translate3d(0,${transform.y}px,0)` : undefined
      }}
      className={`absolute top-1 bottom-1 rounded text-xs px-1 cursor-grab active:cursor-grabbing ${
        selected
          ? 'bg-[var(--a1)] text-white ring-1 ring-white'
          : 'bg-[var(--surface-3)] text-[var(--text)]'
      }`}
    >
      <span className="truncate">{clip.label}</span>
      <div
        onPointerDown={onResizePointerDown}
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/20"
        aria-label="Resize clip"
      />
    </div>
  );
}
```

- [ ] **Step 4: Tracks + Playhead + Timeline index**

```tsx
// components/Workspace/Timeline/Tracks.tsx
'use client';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { useAppStore } from '@/lib/store';
import { Clip } from './Clip';

const TRACK_HEIGHT = 32;
const BEAT_PX_BASE = 40;

export function Tracks() {
  const tracks = useAppStore((s) => s.timeline.tracks);
  const clips = useAppStore((s) => s.timeline.clips);
  const zoom = useAppStore((s) => s.ui.zoom);
  const moveClip = useAppStore((s) => s.timelineActions.moveClip);
  const px = BEAT_PX_BASE * zoom;

  const onDragEnd = (e: DragEndEvent) => {
    const data = e.active.data.current as { kind: string; clipId?: string } | undefined;
    if (data?.kind !== 'clip' || !data.clipId) return;
    const clip = clips.find((c) => c.id === data.clipId);
    if (!clip) return;
    const dxBeats = e.delta.x / px;
    moveClip(clip.id, Math.max(0, clip.startBeat + dxBeats));
  };

  return (
    <DndContext onDragEnd={onDragEnd}>
      <div className="relative flex-1 overflow-x-auto">
        {tracks.map((t) => (
          <div
            key={t.id}
            className="relative border-b border-[var(--border)]"
            style={{ height: TRACK_HEIGHT }}
          >
            {clips
              .filter((c) => c.trackId === t.id)
              .map((c) => (
                <Clip key={c.id} clip={c} />
              ))}
          </div>
        ))}
      </div>
    </DndContext>
  );
}
```

```tsx
// components/Workspace/Timeline/Playhead.tsx
'use client';
import { useAppStore } from '@/lib/store';

const BEAT_PX_BASE = 40;

export function Playhead() {
  const beats = useAppStore((s) => s.timeline.playhead.beats);
  const zoom = useAppStore((s) => s.ui.zoom);
  return (
    <div
      className="absolute top-0 bottom-0 w-px bg-[var(--a1)] pointer-events-none"
      style={{ left: beats * BEAT_PX_BASE * zoom }}
    />
  );
}
```

```tsx
// components/Workspace/Timeline/index.tsx
'use client';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toolbar } from './Toolbar';
import { Ruler } from './Ruler';
import { Tracks } from './Tracks';
import { Playhead } from './Playhead';
import type { AudioEngine } from '@/lib/audio/engine';

export function Timeline({ engine: _engine }: { engine: AudioEngine | null }) {
  return (
    <ErrorBoundary name="Timeline">
      <div className="h-full flex flex-col relative">
        <Toolbar />
        <Ruler />
        <Tracks />
        <Playhead />
      </div>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 5: Clip test**

```tsx
// tests/unit/components/Timeline/Clip.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Clip } from '@/components/Workspace/Timeline/Clip';
import { DndContext } from '@dnd-kit/core';
import { useAppStore } from '@/lib/store';

describe('Clip', () => {
  beforeEach(() => {
    useAppStore.setState({
      ui: { zoom: 1, selectedClipId: null },
      timeline: {
        tracks: [{ id: 't1', kind: 'pulse', name: 'P', muted: false, order: 0 }],
        clips: [
          {
            id: 'c1',
            trackId: 't1',
            kind: 'pulse',
            startBeat: 2,
            lengthBeats: 4,
            label: 'Pulse',
            fxId: 'pulse'
          }
        ],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      }
    });
  });

  it('renders the label', () => {
    render(
      <DndContext>
        <Clip clip={useAppStore.getState().timeline.clips[0]} />
      </DndContext>
    );
    expect(screen.getByText('Pulse')).toBeInTheDocument();
  });

  it('click sets selectedClipId in the store', () => {
    render(
      <DndContext>
        <Clip clip={useAppStore.getState().timeline.clips[0]} />
      </DndContext>
    );
    fireEvent.click(screen.getByText('Pulse'));
    expect(useAppStore.getState().ui.selectedClipId).toBe('c1');
  });

  it('right-edge pointer-drag triggers resizeClip', () => {
    render(
      <DndContext>
        <Clip clip={useAppStore.getState().timeline.clips[0]} />
      </DndContext>
    );
    const handle = screen.getByLabelText('Resize clip');
    fireEvent.pointerDown(handle, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 180 });
    fireEvent.pointerUp(window);
    expect(useAppStore.getState().timeline.clips[0].lengthBeats).toBeGreaterThan(4);
  });
});
```

- [ ] **Step 6: Run + commit**

```bash
npm test -- Timeline
git add components/Workspace/Timeline tests/unit/components/Timeline
git commit -m "feat(components): Timeline (Toolbar, Ruler, Tracks, Clip dnd+resize, Playhead)"
```

---

## Task 22: Waveform component

**Files:**
- Create: `components/Workspace/Timeline/Waveform.tsx`
- Create: `tests/unit/components/Timeline/Waveform.test.tsx`

> Pure visual — receives `peaks: { min: Float32Array; max: Float32Array }` as prop. The parent (a future `Workspace/Timeline` enhancement) drives the worker — out of Plan 5 scope. Here we ship just the renderer + test it against synthetic peaks.

- [ ] **Step 1: Implement**

```tsx
// components/Workspace/Timeline/Waveform.tsx
'use client';

export interface Peaks {
  min: Float32Array;
  max: Float32Array;
}

export function Waveform({
  peaks,
  width = 800,
  height = 48
}: {
  peaks: Peaks | null;
  width?: number;
  height?: number;
}) {
  if (!peaks) return null;
  const n = peaks.min.length;
  const stepX = width / n;
  const mid = height / 2;
  const top = Array.from({ length: n }, (_, i) => `${i * stepX},${mid - peaks.max[i] * mid}`);
  const bot = Array.from({ length: n }, (_, i) => `${(n - 1 - i) * stepX},${mid - peaks.min[n - 1 - i] * mid}`);
  const d = `M ${top.join(' L ')} L ${bot.join(' L ')} Z`;
  return (
    <svg width={width} height={height} className="block">
      <path d={d} fill="var(--a2)" opacity={0.6} />
    </svg>
  );
}
```

- [ ] **Step 2: Test**

```tsx
// tests/unit/components/Timeline/Waveform.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Waveform } from '@/components/Workspace/Timeline/Waveform';

describe('Waveform', () => {
  it('returns null without peaks', () => {
    const { container } = render(<Waveform peaks={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an SVG path from peaks', () => {
    const min = new Float32Array([-0.5, -0.2, -0.8]);
    const max = new Float32Array([0.5, 0.2, 0.8]);
    const { container } = render(<Waveform peaks={{ min, max }} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('path')?.getAttribute('d')).toContain('M');
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
npm test -- Waveform
git add components/Workspace/Timeline/Waveform.tsx tests/unit/components/Timeline/Waveform.test.tsx
git commit -m "feat(components): Waveform renderer (pure, peaks-in)"
```

---

## Task 23: Mobile stubs + responsive page rewrite

**Files:**
- Create: `components/Mobile/MobileTabBar.tsx`
- Rewrite: `app/(studio)/page.tsx`

- [ ] **Step 1: MobileTabBar stub**

```tsx
// components/Mobile/MobileTabBar.tsx
'use client';
export function MobileTabBar() {
  return (
    <nav
      aria-label="Mobile tabs"
      className="sm:hidden h-12 fixed bottom-0 inset-x-0 border-t border-[var(--border)] bg-[var(--surface-1)] flex items-center justify-around"
    >
      <button className="text-xs text-[var(--text-dim)]" disabled>
        Stage
      </button>
      <button className="text-xs text-[var(--text-dim)]" disabled>
        Timeline
      </button>
      <button className="text-xs text-[var(--text-dim)]" disabled>
        Inspector
      </button>
    </nav>
  );
}
```

- [ ] **Step 2: Page rewrite**

```tsx
// app/(studio)/page.tsx
'use client';
import { useAudioEngine } from '@/lib/hooks/useAudioEngine';
import { TopBar } from '@/components/TopBar';
import { Workspace } from '@/components/Workspace';
import { MobileTabBar } from '@/components/Mobile/MobileTabBar';

export default function StudioPage() {
  const { engine } = useAudioEngine();
  return (
    <div className="flex flex-col h-screen bg-[var(--bg)] text-[var(--text)]">
      <TopBar engine={engine} />
      <Workspace />
      <MobileTabBar />
    </div>
  );
}
```

Note: `Workspace` calls `useAudioEngine()` itself (Task 12). That means two engine instances. Refactor: lift `useAudioEngine` to the page, pass `engine` into both `<TopBar engine={…} />` and `<Workspace engine={…} />`. Modify `Workspace` to accept `engine` as a prop instead of calling the hook.

```tsx
// components/Workspace/index.tsx  (replace the body)
'use client';
import { useState } from 'react';
import type { AudioEngine } from '@/lib/audio/engine';
import { LeftPanel } from './LeftPanel';
import { Stage } from './Stage';
import { Timeline } from './Timeline';
import { Inspector } from './Inspector';

export function Workspace({ engine }: { engine: AudioEngine | null }) {
  const [inspectorOpen, setInspectorOpen] = useState(true);
  return (
    <div className="flex flex-1 min-h-0">
      <aside className="w-64 shrink-0 border-r border-[var(--border)] bg-[var(--surface-1)] overflow-y-auto">
        <LeftPanel />
      </aside>
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 min-h-0 relative">
          <Stage engine={engine} />
          <button
            type="button"
            aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
            onClick={() => setInspectorOpen((v) => !v)}
            className="absolute right-2 top-2 lg:hidden h-7 px-2 rounded bg-[var(--surface-2)] text-xs"
          >
            {inspectorOpen ? '›' : '‹'}
          </button>
        </div>
        <div className="h-64 shrink-0 border-t border-[var(--border)] bg-[var(--surface-1)]">
          <Timeline engine={engine} />
        </div>
      </main>
      {inspectorOpen && (
        <aside className="w-72 shrink-0 border-l border-[var(--border)] bg-[var(--surface-1)] overflow-y-auto">
          <Inspector />
        </aside>
      )}
    </div>
  );
}
```

And in `StudioPage`:

```tsx
<Workspace engine={engine} />
```

- [ ] **Step 3: Typecheck + build**

```bash
npm run typecheck
npm run build
```

Expected: build PASS, all chunks present, AWS SDK and Anthropic SDK absent from any `_app` / `page` client chunks.

- [ ] **Step 4: Commit**

```bash
git add components/Mobile components/Workspace/index.tsx app/\(studio\)/page.tsx
git commit -m "feat(components): studio page wires TopBar + Workspace + MobileTabBar (engine lifted to page)"
```

---

## Task 24: Smoke-test pass (manual)

> Not committable. Run the smoke gate from the header. The reviewer subagent will not run this; the human signs it off before declaring Plan 5 done.

- [ ] **Step 1: `npm run dev`**, open `http://localhost:3000`.
- [ ] **Step 2: Upload an image (`+ Image` button)** — JPEG/PNG of any aspect ratio.
- [ ] **Step 3: Verify width × height appears below filename** within 1–2 seconds.
- [ ] **Step 4: Upload an audio file** — verify `duration` appears.
- [ ] **Step 5: From FxLibrary, drag a Pulse plugin onto a track**.
- [ ] **Step 6: Click the clip — Inspector shows controls**. Change intensity — change visible in the stage on next beat.
- [ ] **Step 7: Click ✨ on the image — toast "Analysing image…" → "✨ Preset applied"**. Inspector values update.
- [ ] **Step 8: Resize window to 800px wide** — Inspector toggle button appears at top-right of Stage.
- [ ] **Step 9: Hit Play** — Pulse fires on each beat against the image.

---

## Task 25: Final verification gate

- [ ] **Step 1: Typecheck**

```
npm run typecheck
```

- [ ] **Step 2: Lint**

```
npm run lint
```

- [ ] **Step 3: Automation tests**

```
npm test -- automation
```

Expected: ≥ 12.

- [ ] **Step 4: Storage tests** (regression incl. media-meta + auto-preset-adapter)

```
npm test -- storage
```

- [ ] **Step 5: AI tests**

```
npm test -- ai
```

- [ ] **Step 6: Component tests**

```
npm test -- components
```

Expected: ≥ 30 across Inspector, ParamControl, ErrorBoundary, MediaLibrary, AutoPresetButton, Timeline/Clip, Timeline/Waveform.

- [ ] **Step 7: Integration tests**

```
npm test -- integration
```

Expected: analyze-image (≥ 4) + upload (4) green.

- [ ] **Step 8: Full suite**

```
npm test
```

Expected: ≥ 215 (Plan 4 baseline = 169, Plan 5 adds ≥ 46 new tests).

- [ ] **Step 9: Build**

```
npm run build
```

Expected: PASS. Inspect the build output: `app/api/analyze-image/route.js` chunk present, no Anthropic SDK in client chunks.

- [ ] **Step 10: Update CLAUDE.md plan table**

```diff
- | 5 | UI Components | ⬜ Pending |
+ | 5 | UI Components | ✅ Done |
```

```bash
git add CLAUDE.md
git commit -m "docs: sync plan status — Plan 5 done"
```

---

## Done condition

All 25 tasks committed, all 9 verification steps green, smoke gate signed off by the human. The studio UI works end-to-end against a live R2 bucket and a live Anthropic API key (or with mocks if `ANTHROPIC_API_KEY` is unset — the route returns `503 AI_NOT_CONFIGURED` and the AutoPreset button shows the error toast). **Plan 5.5 (AutomationLane UI) can start** — its only addition is a new `<AutomationLane />` component that writes `AutomationCurve`-shaped values through the existing `setClipParam`; no store, renderer, or types changes are required.

## Open questions for review

1. **Per-clip selection model.** Plan 5 uses `ui.selectedClipId` for the Inspector AND for the AutoPreset target. v0.2 may need multi-select (group editing). For v0.1, single-select is fine. Confirm.
2. **`@anthropic-ai/sdk` bundle size in the route.** The SDK adds ~1.4 MB to the server bundle. Acceptable for the analyze-image route (server-side only). If the cold-start latency on Vercel becomes a problem, switch to a thin `fetch`-based wrapper. Defer to v0.2.
3. **Claude model selection.** `claude-sonnet-4-6` chosen for the cost/latency sweet spot on a single-image vision call (~1–2 s). Haiku 4.5 is cheaper but its image reasoning is less reliable for moodboard-style colour decisions. Confirm Sonnet or downgrade.
4. **System prompt language.** v0.1 system prompt is English. The UI is German (Spec quotes like "Wähle einen Clip oder Effekt aus."). The model interprets schemas and returns numeric values — language-agnostic. Inspector labels stay in source-language (English) per the existing FX definitions. Confirm not splitting.
5. **R2 image fetch in the route.** Assumes the bucket is publicly readable (Plan 4 default). If buckets become private in v0.2, the route needs a signed-URL or server-side `getObject`. Out of scope for Plan 5.
6. **Auto-preset rate limiting.** None in v0.1. A user can click the button repeatedly — each click hits Claude. Documented as a known cost vector; consider a 2-second debounce in v0.2.
7. **`useAudioEngine` action-patching technique.** Replacing `audioActions.setDetectedGrid` at mount time is a non-orthodox Zustand pattern (most apps add a separate channel for engine-side updates). The alternative is a dedicated `audioActions.setDetectedGridFromEngine` that toggles the skip-flag explicitly. Either works — confirm the patch approach is OK, or switch to the explicit channel.
8. **AutomationCurve interpolation modes.** Plan 5 ships `'linear'` only (number-or-step-fallback). Plan 5.5 will add `'step'` and possibly `'ease-in-out'`. The `Interpolation` type is currently `'linear'` literal — Plan 5.5 widens it. Forward-compat is via the type system; no migration needed for stored curves. Confirm.
9. **No worker for the Waveform.** Task 22 lands the renderer; the worker that produces peaks is deferred. Sufficient for v0.1 (manual smoke-test displays an empty placeholder until a future task wires the worker). If the smoke-test acceptance requires a visible waveform on audio upload, surface — would add a Task 22b (~30 lines) to call the existing worker-factory pattern from the audio engine.

---

## Architect-review changelog (rev 1)

Issues raised in the first architect review, with the in-plan fix:

| # | Issue | Resolution |
|---|---|---|
| Blocking 1 | Task 8 imported non-existent `observeCanvasResize`; missed wiring the resize callback to canvas dimensions + `ctx.scale` | Task 8 now uses `attachDprObserver(canvas, ({pxWidth,pxHeight,dpr})=>{ canvas.width=…; canvas.height=…; ctx.setTransform(dpr,0,0,dpr,0,0); })` — Spec §9.1 satisfied |
| Blocking 2 | Task 8 effect deps `[canvasRef, getCurrentTime, getSeekCounter]` would re-mount the renderer on every Workspace render (arrow-fn identity churn) | Task 8 stores `getCurrentTime` / `getSeekCounter` in refs synced on every render; effect deps are empty so the renderer mounts once per canvas |
| Blocking 3 | Task 8 cache only loaded mediaRefs ADDED after mount — never primed from rehydrated state | Task 8 now iterates `useAppStore.getState().media.mediaRefs.filter(kind==='image')` on mount and primes the cache before subscribing |
| Blocking 4 | Plugin-registry contamination across `singleThread` vitest workers — Tasks 15, 18, 20 would silently see `registered=true` with an empty registry | Task 15 (AutoPresetButton), Task 18 (analyze-image integration), and Task 20 (Inspector) all add `_resetBuiltInPluginsForTests(); registerBuiltInPlugins();` to `beforeEach` and import the reset helper |
| Blocking 5 | Task 21 Tracks had `top: i * TRACK_HEIGHT` on relatively-positioned siblings → double-offset layout bug | Dropped the inline `top` — siblings stack via normal flow |
| Non-blocking | Task 18 forwarded the image `content-type` header verbatim to Anthropic, including any `; charset=…` parameters | Route now strips MIME parameters and rejects anything outside `{image/jpeg, image/png, image/webp}` before calling Claude |
| Non-blocking | Task 9 `ParamControl` switch had no `default` arm → TS strict warning on the return path | Added `default: { const _exhaustive: never = schema; … }` exhaustive check |
| Non-blocking | Task 25 CLAUDE.md diff included an unchanged Plan 6 row | Trimmed to the single Plan 5 row |
| Non-blocking | File map over-promised full §9.5 responsive grid; Task 12 only implements one breakpoint | File-map entry for `Workspace/index.tsx` corrected to "three-pane flex with slide-over inspector; full 2-col/stacked breakpoints deferred" |

Issues that the reviewer flagged but were intentionally left for human/open-question disposition (not silently dropped):

- **Open Question 7** — `useAudioEngine`'s action-patching technique. Reviewer "strongly recommends" the alternative (`audioActions.setDetectedGridFromEngine` channel). Surfaced verbatim for the human; no code change in rev 1.
- **`selectedClipId` persistence concern** — added under Open Question 1 for the human (currently lives in `UIState` and is therefore persisted via `partialize`). Easy follow-up if the human wants it transient.
- **`selectedClipId` partialize concern.** Added to Open Question 10 below.

10. **`selectedClipId` persistence.** Plan 5 adds it to `UIState` (Task 15) which means it survives reloads via `partialize`. A stale id pointing at a removed clip is awkward UX. Acceptable for v0.1 (the Inspector silently shows the empty state when the id doesn't resolve); v0.2 should either partialize it out or null it on rehydrate. Confirm acceptable.
