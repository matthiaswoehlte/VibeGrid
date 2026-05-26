# VibeGrid Plan 5.5 — Automation UI, Waveform Worker, Interpolation Modes, Zoom Pulse FX

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project execution policy (overrides skill defaults):** This repo uses **direct-on-main, sequential, one commit per task** — not subagent-per-task dispatch. Implementer runs the verification gate at the end and a single final review (CC #2).

**Goal:** Land the v0.1 automation editing experience end-to-end — users can right-click a slider param in the Inspector to convert it to an automation curve, edit points on a per-clip automation lane below the timeline track, and pick between four interpolation modes (`linear | step | easeIn | easeOut`). Wire the existing `lib/audio/waveform-worker.ts` into the UI via a `useWaveformPeaks` hook so the timeline shows the audio waveform under the ruler. Add **Zoom Pulse** as the 5th FX plugin (image scale-on-beat with decay).

**Architecture:** Four additive layers on top of Plan 5. All four are scoped to keep Plan 5's renderer/store boundaries intact.

1. **Interpolation extension (pure).** The `Interpolation` union in `lib/automation/types.ts` grows from `'linear'` to `'linear' | 'step' | 'easeIn' | 'easeOut'`. `resolveParam` learns three new branches; non-numeric values keep step semantics regardless of the picked mode. Zero on-wire migration — existing clips have `interpolation: 'linear'` and continue to work bit-identical.
2. **Automation editing data path.** A new pure module `lib/automation/operations.ts` handles `addPoint / removePoint / updatePoint / sortPoints / makeCurve / toStaticValue`. The timeline slice gains six action methods that wrap these ops and call through the existing `setClipParam` shape — the renderer keeps reading `clip.params` through `resolveClipParams` unchanged. UI state grows by one field: `expandedAutomationClipId: string | null` (transient, never persisted).
3. **UI surfaces.** Inspector gets a per-param ⚡ "Automate" toggle and an "Edit on timeline" link. The Timeline gets a per-clip AutomationLane (rendered inline below the matching track row when the clip is "expanded for automation"), one sub-row per automated slider param, with draggable point handles, click-to-add, right-click-to-remove, and an interpolation-mode picker.
4. **Waveform pipeline.** `lib/audio/peaks.ts` extracts the worker's downsample math as a pure function (worker imports it). New hook `lib/hooks/useWaveformPeaks.ts` does the fetch + `decodeAudioData` + worker dispatch, with a module-scoped cache keyed by `mediaId`. `<Waveform>` is rewired to consume the worker's tuple format and renders under the ruler spanning the active audio clip.

5. **Zoom Pulse FX (5th plugin).** New plugin `lib/fx/zoom-pulse.ts` with `kind: 'ZoomPulse'`. On each beat the plugin re-draws `rc.imageBitmap` with a centered scale transform; the scale fades back to 1.0 across `beatPhase` controlled by a `decay` slider. Touches the `TrackKind` / `FxKind` unions, the renderer's `RENDER_ORDER` + `KIND_TO_TRACK_KIND` map, the Tracks `PLUGIN_TO_TRACK_KIND`, the Clip `KIND_COLOR`, the `initialTimelineState.tracks` default, and the persist migration (bumped to v3).

**Tech Stack:** React 18, Zustand (existing slices), `@dnd-kit/core` (existing — points use raw pointer events, not dnd-kit), Web Worker via `lib/audio/worker-factory.ts` (existing). No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-19-vibegrid-design.md` §6 (Timeline data model — clips own params), §9 (UI Components — Inspector + Timeline tree), §10 (Store — UIState transient fields not persisted). Plan 5 review §OQ8 (interpolation extension) + §OQ9 (waveform worker deferred to Plan 5.5 or 6) are resolved here.

**Verification gate (must pass before Plan 6 starts):**

```
npm test -- automation        # ≥ 28 tests (Plan 5 had 16 across resolve + types — now includes operations + ease modes)
npm test -- components/Timeline/AutomationLane    # ≥ 6
npm test -- components/Timeline/AutomationPoint   # ≥ 5
npm test -- components/Inspector                  # existing 3 + 4 automate-toggle + 3 edit-link wiring = ≥ 10
npm test -- hooks/useWaveformPeaks                # ≥ 5
npm test -- audio/peaks                           # ≥ 4
npm test -- fx/zoom-pulse                         # ≥ 5
npm test                      # full suite ≥ 300 (Plan 5 baseline = 237; ~65 new)
npm run typecheck
npm run lint
npm run build                 # no AWS SDK / Anthropic SDK leak into client chunks; waveform worker is a separate chunk
```

**Smoke gate (manual, before declaring Plan 5.5 done):**

```
npm run dev
# - Place a Pulse clip on the timeline (or use one from a previous session)
# - Inspector: select the clip → click ⚡ next to "intensity"
#   Expect: the slider label gets an "automated" badge, "Edit on timeline" link appears
# - Click "Edit on timeline" → an automation lane appears under the Pulse track
#   Expect: a single point at beat 0 with the previous static value
# - Click elsewhere in the lane → a new point appears, can be dragged
# - Switch interpolation to "step" → curve path becomes square; "easeIn" → quadratic
# - Hit play with two points (value 0 → 1 over 4 beats, linear)
#   Expect: pulse intensity grows visibly between beats 0–4
# - Upload (or have already uploaded) an audio file
#   Expect: a waveform appears under the ruler within ~500ms
# - Right-click an automation point → it disappears
# - Click ⚡ again on the param in Inspector → curve collapses to a static value
# - Drag a Zoom Pulse clip onto the new Zoom Pulse track
#   Expect: on play, the image scales outward on every beat and fades back
# - Tweak intensity + decay sliders → effect changes live
```

**Dependencies on prior plans:** Plan 5 (Inspector, ParamControl, `setClipParam`, `StaticOrAuto<T>`, `resolveParam`, `useMediaUpload`). Plan 3 (renderer reads through `resolveClipParams`). Plan 2 (`AudioContext` is browser-only — hook must lazy-init via `isClient()`).

**Out of scope (Plan 6 or v0.2):**

- Color / select / toggle automation in the lane UI (data model supports it via step fallback; only sliders get a visual lane in v0.1).
- Multi-clip automation editing (one expanded clip at a time).
- Curve copy/paste between clips.
- Beat-snapped point placement (lane click drops a point at the raw cursor beat — Plan 6 can add snap from `timeline.snap`).
- Persisting `expandedAutomationClipId` across reloads.
- Worker-chunk lazy splitting for the waveform worker — it ships with the studio bundle.

---

## File map

### Pure helpers (no React, no I/O)

| File | Purpose |
|---|---|
| `lib/automation/types.ts` (modify) | Extend `Interpolation` to `'linear' \| 'step' \| 'easeIn' \| 'easeOut'` |
| `lib/automation/resolve.ts` (modify) | Add `easeIn` (t²) + `easeOut` (1−(1−t)²) numeric branches; `step` falls through to existing non-linear path |
| `lib/automation/operations.ts` (create) | Pure: `sortPoints`, `addPoint`, `removePoint`, `updatePoint`, `makeCurve`, `toStaticValue` |
| `lib/audio/peaks.ts` (create) | Pure: `downsamplePeaks(samples: Float32Array, cols: number): WaveformPeaks` — extracted from `waveform-worker.ts` |
| `lib/audio/waveform-worker.ts` (modify) | Import `downsamplePeaks` from `./peaks` instead of inlining the math |

### Store extensions

> **Architecture note:** The current store keeps UI state and its two actions (`setZoom`, `setSelectedClipId`) **inline** at the top level of the `create(...)` factory in `lib/store/index.ts` — there is no `ui-slice.ts` and no `uiActions` namespace. Plan 5.5 follows the same pattern: `expandedAutomationClipId` joins `ui` as a required field, and `setExpandedAutomationClipId` joins `setZoom` / `setSelectedClipId` as a top-level action. Test snippets call `useAppStore.getState().setExpandedAutomationClipId(...)` — NOT `uiActions.setExpandedAutomationClipId(...)`.

| File | Purpose |
|---|---|
| `lib/store/types.ts` (modify) | `TimelineActions`: 6 new methods. `UIState`: add required `expandedAutomationClipId: string \| null`. Top-level `AppState`: add `setExpandedAutomationClipId(id)` next to `setZoom` + `setSelectedClipId` |
| `lib/store/timeline-slice.ts` (modify) | Implement: `convertParamToAutomation`, `convertParamToStatic`, `addParamPoint`, `removeParamPoint`, `updateParamPoint`, `setParamInterpolation` |
| `lib/store/index.ts` (modify) | Inline UIState gets `expandedAutomationClipId: null`. Add top-level `setExpandedAutomationClipId`. `partialize` continues to write only `ui: { zoom: state.ui.zoom }` — new field is transient |
| `components/TopBar/ClearProjectButton.tsx` (modify) | Existing literal `ui: { zoom: 1, selectedClipId: null }` becomes `ui: { zoom: 1, selectedClipId: null, expandedAutomationClipId: null }` so TS strict mode accepts the new required field |
| `tests/unit/components/Inspector.test.tsx` (modify) | Same literal update in the existing `beforeEach` |
| `tests/unit/components/AutoPresetButton.test.tsx` (modify) | Same literal update in the existing `beforeEach` |
| `tests/unit/components/Timeline/Clip.test.tsx` (modify) | Same literal update in the existing `beforeEach` |

### FX plugin (5th)

| File | Purpose |
|---|---|
| `lib/fx/zoom-pulse.ts` (create) | `FxPlugin<ZoomPulseParams>` with `kind: 'ZoomPulse'`, `defaultTrigger: 'beat'`. Sliders: `intensity` (0–1, peak zoom add), `decay` (0–1, fade-back speed). On render: when imageBitmap present + fade > 0, draws the bitmap with `ctx.scale(1 + intensity·fade, …)` centered on canvas |
| `lib/fx/index.ts` (modify) | Register `zoomPulsePlugin` alongside the existing four |
| `lib/timeline/types.ts` (modify) | `TrackKind` += `'zoom-pulse'`; `FxKind` recomputes automatically (it's `Exclude<TrackKind, 'image'>`) |
| `lib/renderer/types.ts` (modify) | `FxKind` (renderer-side, PascalCase) += `'ZoomPulse'` |
| `lib/renderer/loop.ts` (modify) | `RENDER_ORDER` += `'ZoomPulse'` (between Contour and Sweep — image transforms apply before overlay FX); `KIND_TO_TRACK_KIND` += `ZoomPulse: 'zoom-pulse'`; extend the `Contour && !imageBitmap` guard to include `ZoomPulse` |
| `components/Workspace/Timeline/Tracks.tsx` (modify) | `PLUGIN_TO_TRACK_KIND` += `ZoomPulse: 'zoom-pulse'` |
| `components/Workspace/Timeline/Clip.tsx` (modify) | `KIND_COLOR` += a distinct accent for `'zoom-pulse'` (e.g. `'#ff9f43'` orange — visually distinct from existing five entries) |
| `lib/store/timeline-slice.ts` (modify) | `initialTimelineState.tracks` += `{ id: 'track-zoom-pulse', kind: 'zoom-pulse', name: 'Zoom Pulse', muted: false, order: 5 }` |
| `lib/store/index.ts` (modify) | Bump `version: 2 → 3`. Extend migration block to also run the missing-kinds merge when `version < 3` so existing users gain the new track on next reload |
| `tests/unit/fx/zoom-pulse.test.ts` (create) | ≥ 5: plugin shape (id/kind/trigger/preloadState), renders drawImage when imageBitmap + intensity > 0, NO drawImage when imageBitmap missing, higher intensity → larger ctx.scale call, ctx.save/restore balanced |

### React hooks

| File | Purpose |
|---|---|
| `lib/hooks/useWaveformPeaks.ts` (create) | Owns the fetch + `OfflineAudioContext.decodeAudioData` + worker dispatch; module-scoped Map cache by `mediaId`; returns `{ peaks, status }`. **Audio URL fetches from R2 `pub-*.r2.dev` and is subject to the same CORS allowlist as the image cache — see [[r2_setup_gotchas]]; comment in the hook flags this** |

### Components — Inspector

| File | Purpose |
|---|---|
| `components/Workspace/Inspector/AutomateButton.tsx` (create) | Small ⚡ icon button next to each param label; toggles static ↔ automation |
| `components/Workspace/Inspector/index.tsx` (modify) | Render `<AutomateButton>` next to slider params; show "Edit on timeline" / "Hide automation" link when at least one param is automated |

### Components — Timeline

| File | Purpose |
|---|---|
| `components/Workspace/Timeline/AutomationLane.tsx` (create) | One lane container per expanded clip; one sub-row per automated slider param; header has interpolation picker + close button |
| `components/Workspace/Timeline/AutomationPoint.tsx` (create) | SVG circle handle with pointer-drag + right-click delete |
| `components/Workspace/Timeline/AutomationCurvePath.tsx` (create) | Pure SVG path string from points + interpolation + lane size + schema |
| `components/Workspace/Timeline/Tracks.tsx` (modify) | When `ui.expandedAutomationClipId` matches a clip in this track row, render `<AutomationLane>` directly below it |
| `components/Workspace/Timeline/Waveform.tsx` (rewrite) | Consume `WaveformPeaks` tuple format from the worker; SSR-safe; null on empty peaks |
| `components/Workspace/Timeline/index.tsx` (modify) | Mount waveform overlay using `useWaveformPeaks` for the active audio clip's mediaId |

### Tests (≥ 65 new)

| File | Tests |
|---|---|
| `tests/unit/automation/resolve.test.ts` (extend) | + ≥ 6: step holds a.value between points, easeIn quadratic midpoint = 0.25, easeOut quadratic midpoint = 0.75, non-numeric value with easeIn falls back to step, integer-typed value via easeIn returns float, interpolation field absent → assumes linear |
| `tests/unit/automation/operations.test.ts` (create) | ≥ 10: sortPoints orders by beat asc, addPoint inserts & re-sorts, addPoint at duplicate beat keeps both, removePoint drops index, removePoint with invalid index is a no-op, updatePoint merges + re-sorts, makeCurve returns single-point linear curve at given beat, toStaticValue returns points[0].value, toStaticValue on empty curve throws, operations don't mutate input |
| `tests/unit/audio/peaks.test.ts` (create) | ≥ 4: downsample 8 samples to 4 cols → 2 samples/col min+max, sine wave gives symmetric min/max, empty samples → all zeros, targetCols=1 returns global min/max |
| `tests/unit/store/timeline-slice-automation.test.ts` (create) | ≥ 8: convertParamToAutomation wraps static, convertParamToStatic uses points[0], addParamPoint inserts sorted, removeParamPoint drops index, updateParamPoint patches at index, setParamInterpolation switches mode, all six ops are no-ops on missing clip/key, none mutate input |
| `tests/unit/store/ui-state-automation.test.ts` (create) | ≥ 6: default is null, setExpandedAutomationClipId writes the field, partialize result has no expandedAutomationClipId key, removing the expanded clip clears the field, selecting a different clip clears the field, selecting the same clip keeps the lane open |
| `tests/unit/hooks/useWaveformPeaks.test.tsx` (create) | ≥ 5: SSR-safe (returns idle when window undefined), happy path: fetch → decode → worker → peaks, cache hit returns existing peaks without re-fetch, error path sets status=error, AbortController fires on unmount mid-fetch |
| `tests/unit/components/Inspector-automate.test.tsx` (create) | ≥ 4: ⚡ button appears only for slider params, clicking on static converts to single-point curve at playhead beat, clicking again converts back using points[0].value, "Edit on timeline" appears only when ≥ 1 param is automated |
| `tests/unit/components/Timeline/AutomationLane.test.tsx` (create) | ≥ 6: renders nothing when expandedAutomationClipId ≠ clip.id, one sub-row per automated slider param, color-only / toggle-only params are skipped, interpolation picker dispatches setParamInterpolation, close button clears expandedAutomationClipId, click empty lane area dispatches addParamPoint |
| `tests/unit/components/Timeline/AutomationPoint.test.tsx` (create) | ≥ 5: renders at (beat·px, valueY) from schema min/max, pointer-drag updates store with clamped beat+value, right-click on non-last point dispatches removeParamPoint, right-click on the last point collapses to static (no empty-curve throw), pointer-drag clamps to lane bounds |
| `tests/unit/components/Timeline/AutomationCurvePath.test.tsx` (create) | ≥ 3: linear path is M…L…, step path is M…L H V…, easeIn path uses cubic-Bezier control points |

---

## Conventions

- **Interpolation extension is pure data.** No store migration. Old clips with `interpolation: 'linear'` keep working. New clips also default to `'linear'`. The Inspector's "Automate" button always creates a `linear` curve; the user picks a different mode in the AutomationLane header.
- **Only slider params get a visual automation lane in v0.1.** The data model in Plan 5 already supports `AutomationCurve<string>` / `AutomationCurve<boolean>`, but rendering a step curve for a color picker isn't useful UX yet. AutomationLane filters `paramSchema` to `kind === 'slider'` entries.
- **Points are stored sorted.** All store actions that insert/update a point re-run `sortPoints` so downstream code (resolver, curve renderer) can assume monotonic beat order.
- **Pointer events only.** AutomationPoint uses `onPointerDown` + `window.addEventListener('pointermove' / 'pointerup', …)` for drag — the same pattern as `Clip.tsx`'s resize handle. Stays touch-ready for Capacitor v0.2.
- **`expandedAutomationClipId` is transient UI state.** Never goes through `partialize`. Cleared automatically when the user selects a different clip or the clip is removed (handled in Task 5).
- **Waveform peaks are cached per mediaId, in memory only.** Decoded audio buffers are NOT cached (they cost ~10 MB / minute at 44.1 kHz). Once the worker has emitted peaks, the decoded buffer is dropped.
- **Worker constructor goes through `lib/audio/worker-factory.ts`** — never `new Worker(new URL(...))` at a call site outside that file (Next.js Webpack worker-chunk emission constraint, see Plan 2 notes).
- **No e2e tests in this plan.** Memory: `tests/e2e/*` and `docs/Tests/*` are CC #2 territory.
- **One commit per task.** Use `type(scope): description` format. Allowed scopes: `automation`, `audio`, `store`, `hooks`, `inspector`, `timeline`, `tests`.
- **Plugin registry contamination guard.** Any test that mounts the Inspector or Timeline must call `_resetBuiltInPluginsForTests()` in `beforeEach` (Plan 5 pattern).

---

## Task 0: Baseline verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full Plan 5 suite to confirm green baseline**

Run: `npm test -- --run`
Expected: `Test Files 42 passed (42)`, `Tests 237 passed (237)`. If the count is below 237, STOP and surface the regression before starting Plan 5.5.

- [ ] **Step 2: Confirm spec + store state**

Run: `npm run typecheck && npm run lint`
Expected: both clean. If not, STOP.

No commit for this task.

---

## Task 1: Extend Interpolation union + ease modes in resolveParam

**Files:**
- Modify: `lib/automation/types.ts`
- Modify: `lib/automation/resolve.ts`
- Test: `tests/unit/automation/resolve.test.ts` (extend)

> Pure-only change. Touches no React, no store, no renderer. The renderer keeps calling `resolveClipParams` and gets a value out — it doesn't care which mode produced it.

- [ ] **Step 1: Write the failing tests (extend existing file, append a new describe block)**

```ts
// tests/unit/automation/resolve.test.ts — append at the bottom

describe('resolveParam — interpolation modes', () => {
  const base = (interpolation: 'linear' | 'step' | 'easeIn' | 'easeOut') => ({
    mode: 'automation' as const,
    points: [
      { beat: 0, value: 0 },
      { beat: 4, value: 1 }
    ],
    interpolation
  });

  it('step holds a.value between points', () => {
    const curve = base('step');
    expect(resolveParam(curve, 0)).toBe(0);
    expect(resolveParam(curve, 2)).toBe(0); // midpoint still 0
    expect(resolveParam(curve, 3.99)).toBe(0);
    expect(resolveParam(curve, 4)).toBe(1);
  });

  it('easeIn midpoint is t² = 0.25', () => {
    const curve = base('easeIn');
    // t = 0.5 → t² = 0.25
    expect(resolveParam(curve, 2)).toBeCloseTo(0.25, 5);
  });

  it('easeOut midpoint is 1−(1−t)² = 0.75', () => {
    const curve = base('easeOut');
    expect(resolveParam(curve, 2)).toBeCloseTo(0.75, 5);
  });

  it('non-numeric value with easeIn falls back to step (a.value held)', () => {
    const curve: AutomationCurve<string> = {
      mode: 'automation',
      points: [
        { beat: 0, value: '#ff0000' },
        { beat: 4, value: '#00ff00' }
      ],
      // @ts-expect-error — exercising runtime safety for unexpected schemas
      interpolation: 'easeIn'
    };
    expect(resolveParam(curve, 2)).toBe('#ff0000');
  });

  it('integer-typed value via easeIn returns a float (no rounding)', () => {
    const curve = base('easeIn');
    // value is plain JS number — resolver does not coerce to int
    expect(Number.isInteger(resolveParam(curve, 2))).toBe(false);
  });

  it('interpolation field absent → resolver treats as step (safe default)', () => {
    const curve = {
      mode: 'automation' as const,
      points: [
        { beat: 0, value: 0 },
        { beat: 4, value: 1 }
      ]
      // interpolation intentionally omitted
    } as AutomationCurve<number>;
    expect(resolveParam(curve, 2)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests, verify the 6 new ones fail**

Run: `npm test -- automation/resolve --run`
Expected: 6 new tests FAIL with "expected 0.25, got 0.5" (easeIn) / "expected 0.75, got 0.5" (easeOut) — the existing linear path is returning 0.5 for both ease cases.

- [ ] **Step 3: Extend the Interpolation type**

Replace the single line in `lib/automation/types.ts`:

```ts
export type Interpolation = 'linear' | 'step' | 'easeIn' | 'easeOut';
```

- [ ] **Step 4: Extend resolveParam — add the three new branches**

Replace the numeric-interp block in `lib/automation/resolve.ts` (the existing `if (p.interpolation === 'linear' && …)` block) with:

```ts
if (typeof a.value === 'number' && typeof b.value === 'number') {
  const t = (beat - a.beat) / (b.beat - a.beat);
  const va = a.value as number;
  const vb = b.value as number;
  switch (p.interpolation) {
    case 'linear':
      return (va + (vb - va) * t) as T;
    case 'easeIn':
      // Quadratic ease-in: slow start, accelerating finish.
      return (va + (vb - va) * (t * t)) as T;
    case 'easeOut': {
      // Quadratic ease-out: fast start, decelerating finish. 1−(1−t)².
      const inv = 1 - t;
      return (va + (vb - va) * (1 - inv * inv)) as T;
    }
    case 'step':
    default:
      // step + unknown values fall through to "hold a.value" below
      break;
  }
}

// Step fallback — hold a.value until next point. Also handles non-numeric values.
return a.value;
```

- [ ] **Step 5: Run tests, verify all pass**

Run: `npm test -- automation/resolve --run`
Expected: all tests green (16 existing + 6 new = 22).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/automation/types.ts lib/automation/resolve.ts tests/unit/automation/resolve.test.ts
git commit -m "feat(automation): add step + easeIn + easeOut interpolation modes"
```

---

## Task 2: Pure automation operations module

**Files:**
- Create: `lib/automation/operations.ts`
- Create: `tests/unit/automation/operations.test.ts`

> All functions are pure and return new curves — never mutate. The store slice (Task 3) is the only caller; this isolation lets the operations be tested without React or zustand.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/automation/operations.test.ts
import { describe, it, expect } from 'vitest';
import {
  sortPoints,
  addPoint,
  removePoint,
  updatePoint,
  makeCurve,
  toStaticValue
} from '@/lib/automation/operations';
import type { AutomationCurve, AutomationPoint } from '@/lib/automation/types';

const curve = (pts: AutomationPoint<number>[]): AutomationCurve<number> => ({
  mode: 'automation',
  interpolation: 'linear',
  points: pts
});

describe('sortPoints', () => {
  it('orders points by beat ascending', () => {
    const out = sortPoints([
      { beat: 4, value: 1 },
      { beat: 0, value: 0 },
      { beat: 2, value: 0.5 }
    ]);
    expect(out.map((p) => p.beat)).toEqual([0, 2, 4]);
  });

  it('does not mutate input', () => {
    const input = [
      { beat: 4, value: 1 },
      { beat: 0, value: 0 }
    ];
    const copy = [...input];
    sortPoints(input);
    expect(input).toEqual(copy);
  });
});

describe('addPoint', () => {
  it('inserts and re-sorts', () => {
    const c = curve([{ beat: 0, value: 0 }, { beat: 4, value: 1 }]);
    const out = addPoint(c, { beat: 2, value: 0.5 });
    expect(out.points.map((p) => p.beat)).toEqual([0, 2, 4]);
  });

  it('keeps duplicate beats (does not dedupe)', () => {
    const c = curve([{ beat: 0, value: 0 }]);
    const out = addPoint(c, { beat: 0, value: 1 });
    expect(out.points).toHaveLength(2);
  });
});

describe('removePoint', () => {
  it('drops the point at the given index', () => {
    const c = curve([
      { beat: 0, value: 0 },
      { beat: 2, value: 0.5 },
      { beat: 4, value: 1 }
    ]);
    const out = removePoint(c, 1);
    expect(out.points.map((p) => p.beat)).toEqual([0, 4]);
  });

  it('returns the same curve on out-of-range index (no-op)', () => {
    const c = curve([{ beat: 0, value: 0 }]);
    expect(removePoint(c, 5)).toBe(c);
    expect(removePoint(c, -1)).toBe(c);
  });
});

describe('updatePoint', () => {
  it('merges patch at index and re-sorts when beat changes', () => {
    const c = curve([
      { beat: 0, value: 0 },
      { beat: 4, value: 1 }
    ]);
    // move point 0 to beat 6 → should end up last after sort
    const out = updatePoint(c, 0, { beat: 6 });
    expect(out.points.map((p) => p.beat)).toEqual([4, 6]);
    expect(out.points[1].value).toBe(0); // value preserved through the move
  });

  it('returns same curve on out-of-range index', () => {
    const c = curve([{ beat: 0, value: 0 }]);
    expect(updatePoint(c, 5, { beat: 1 })).toBe(c);
  });
});

describe('makeCurve', () => {
  it('returns a single-point linear curve at the given beat', () => {
    const out = makeCurve(0.7, 3);
    expect(out).toEqual({
      mode: 'automation',
      interpolation: 'linear',
      points: [{ beat: 3, value: 0.7 }]
    });
  });

  it('accepts a custom interpolation mode', () => {
    const out = makeCurve(0.7, 0, 'step');
    expect(out.interpolation).toBe('step');
  });
});

describe('toStaticValue', () => {
  it('returns points[0].value', () => {
    const c = curve([{ beat: 0, value: 0.42 }, { beat: 4, value: 1 }]);
    expect(toStaticValue(c)).toBe(0.42);
  });

  it('throws on empty points array (caller must guard)', () => {
    const c = curve([]);
    expect(() => toStaticValue(c)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail with "module not found"**

Run: `npm test -- automation/operations --run`
Expected: import errors — module does not exist yet.

- [ ] **Step 3: Implement `lib/automation/operations.ts`**

```ts
import type { AutomationCurve, AutomationPoint, Interpolation } from './types';

export function sortPoints<T>(points: AutomationPoint<T>[]): AutomationPoint<T>[] {
  // .slice() to avoid mutating input — Array.prototype.sort is in-place.
  return points.slice().sort((a, b) => a.beat - b.beat);
}

export function addPoint<T>(
  curve: AutomationCurve<T>,
  point: AutomationPoint<T>
): AutomationCurve<T> {
  return { ...curve, points: sortPoints([...curve.points, point]) };
}

export function removePoint<T>(
  curve: AutomationCurve<T>,
  index: number
): AutomationCurve<T> {
  if (index < 0 || index >= curve.points.length) return curve;
  const next = curve.points.slice();
  next.splice(index, 1);
  return { ...curve, points: next };
}

export function updatePoint<T>(
  curve: AutomationCurve<T>,
  index: number,
  patch: Partial<AutomationPoint<T>>
): AutomationCurve<T> {
  if (index < 0 || index >= curve.points.length) return curve;
  const next = curve.points.slice();
  next[index] = { ...next[index], ...patch };
  return { ...curve, points: sortPoints(next) };
}

export function makeCurve<T>(
  initial: T,
  beat: number,
  interpolation: Interpolation = 'linear'
): AutomationCurve<T> {
  return {
    mode: 'automation',
    interpolation,
    points: [{ beat, value: initial }]
  };
}

export function toStaticValue<T>(curve: AutomationCurve<T>): T {
  if (curve.points.length === 0) {
    throw new Error('toStaticValue: empty AutomationCurve.points');
  }
  return curve.points[0].value;
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `npm test -- automation/operations --run`
Expected: 10 tests green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/automation/operations.ts tests/unit/automation/operations.test.ts
git commit -m "feat(automation): pure operations for point/curve mutation"
```

---

## Task 3: Store extensions — automation actions + expandedAutomationClipId

**Files:**
- Modify: `lib/store/types.ts`
- Modify: `lib/store/timeline-slice.ts`
- Modify: `lib/store/index.ts` (inline UIState + top-level action + partialize verification)
- Modify: `components/TopBar/ClearProjectButton.tsx` (extend the inline UI literal)
- Modify: `tests/unit/components/Inspector.test.tsx` (extend the inline UI literal)
- Modify: `tests/unit/components/AutoPresetButton.test.tsx` (extend the inline UI literal)
- Modify: `tests/unit/components/Timeline/Clip.test.tsx` (extend the inline UI literal)
- Create: `tests/unit/store/timeline-slice-automation.test.ts`
- Create: `tests/unit/store/ui-state-automation.test.ts`

> The store is the only place the UI talks to. All six new TimelineActions wrap the pure ops from Task 2. The new UIState field is transient — verify `partialize` doesn't include it. **The pattern is inline UI actions** (no `ui-slice.ts`, no `uiActions` namespace) to match `setZoom` and `setSelectedClipId`. Existing files that construct full `ui` literals must be extended to include the new field — strict TS will flag any miss.

- [ ] **Step 1: Write the failing tests for timeline-slice**

```ts
// tests/unit/store/timeline-slice-automation.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { isAutomationCurve } from '@/lib/automation/resolve';
import type { AutomationCurve } from '@/lib/automation/types';

const CLIP_ID = 'clip-auto-1';

beforeEach(() => {
  useAppStore.setState((s) => ({
    timeline: {
      ...s.timeline,
      clips: [
        {
          id: CLIP_ID,
          trackId: 'track-pulse',
          kind: 'pulse',
          fxId: 'pulse',
          startBeat: 0,
          lengthBeats: 8,
          label: 'Pulse',
          params: { intensity: 0.5, color: '#ff00ff' }
        }
      ]
    }
  }));
});

describe('timelineActions — convertParamToAutomation', () => {
  it('wraps a static value as a single-point linear curve at beat 0', () => {
    useAppStore.getState().timelineActions.convertParamToAutomation(CLIP_ID, 'intensity', 0);
    const v = useAppStore.getState().timeline.clips[0].params!.intensity;
    expect(isAutomationCurve(v)).toBe(true);
    const c = v as AutomationCurve<number>;
    expect(c.interpolation).toBe('linear');
    expect(c.points).toEqual([{ beat: 0, value: 0.5 }]);
  });

  it('is a no-op if param is already automation', () => {
    useAppStore.getState().timelineActions.convertParamToAutomation(CLIP_ID, 'intensity', 0);
    const before = useAppStore.getState().timeline.clips[0].params!.intensity;
    useAppStore.getState().timelineActions.convertParamToAutomation(CLIP_ID, 'intensity', 0);
    const after = useAppStore.getState().timeline.clips[0].params!.intensity;
    expect(after).toBe(before); // reference-equal: skipped
  });

  it('is a no-op on unknown clip', () => {
    const before = useAppStore.getState().timeline.clips[0];
    useAppStore.getState().timelineActions.convertParamToAutomation('does-not-exist', 'intensity', 0);
    expect(useAppStore.getState().timeline.clips[0]).toBe(before);
  });
});

describe('timelineActions — convertParamToStatic', () => {
  it('extracts points[0].value back to a plain value', () => {
    useAppStore.getState().timelineActions.convertParamToAutomation(CLIP_ID, 'intensity', 0);
    useAppStore.getState().timelineActions.convertParamToStatic(CLIP_ID, 'intensity');
    expect(useAppStore.getState().timeline.clips[0].params!.intensity).toBe(0.5);
  });

  it('is a no-op if param is already static', () => {
    const before = useAppStore.getState().timeline.clips[0];
    useAppStore.getState().timelineActions.convertParamToStatic(CLIP_ID, 'intensity');
    expect(useAppStore.getState().timeline.clips[0]).toBe(before);
  });
});

describe('timelineActions — point operations', () => {
  beforeEach(() => {
    useAppStore.getState().timelineActions.convertParamToAutomation(CLIP_ID, 'intensity', 0);
  });

  it('addParamPoint inserts a sorted point', () => {
    useAppStore.getState().timelineActions.addParamPoint(CLIP_ID, 'intensity', { beat: 4, value: 1 });
    const c = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(c.points.map((p) => p.beat)).toEqual([0, 4]);
  });

  it('removeParamPoint drops by index', () => {
    useAppStore.getState().timelineActions.addParamPoint(CLIP_ID, 'intensity', { beat: 4, value: 1 });
    useAppStore.getState().timelineActions.removeParamPoint(CLIP_ID, 'intensity', 0);
    const c = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(c.points.map((p) => p.beat)).toEqual([4]);
  });

  it('updateParamPoint moves a point and re-sorts', () => {
    useAppStore.getState().timelineActions.addParamPoint(CLIP_ID, 'intensity', { beat: 4, value: 1 });
    useAppStore.getState().timelineActions.updateParamPoint(CLIP_ID, 'intensity', 0, { beat: 6 });
    const c = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(c.points.map((p) => p.beat)).toEqual([4, 6]);
  });

  it('setParamInterpolation switches mode', () => {
    useAppStore.getState().timelineActions.setParamInterpolation(CLIP_ID, 'intensity', 'easeOut');
    const c = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(c.interpolation).toBe('easeOut');
  });

  it('all point ops are no-ops on missing clip or non-automation param', () => {
    const before = useAppStore.getState().timeline.clips[0];
    useAppStore.getState().timelineActions.addParamPoint(CLIP_ID, 'color', { beat: 0, value: '#fff' });
    useAppStore.getState().timelineActions.removeParamPoint('nope', 'intensity', 0);
    useAppStore.getState().timelineActions.updateParamPoint('nope', 'intensity', 0, { beat: 1 });
    useAppStore.getState().timelineActions.setParamInterpolation('nope', 'intensity', 'step');
    // intensity curve preserved
    expect(useAppStore.getState().timeline.clips[0].params!.intensity).toEqual(before.params!.intensity);
  });
});
```

- [ ] **Step 2: Write the failing tests for UI state**

```ts
// tests/unit/store/ui-state-automation.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';

beforeEach(() => {
  useAppStore.setState((s) => ({
    ui: { ...s.ui, expandedAutomationClipId: null }
  }));
});

describe('UI state — expandedAutomationClipId', () => {
  it('defaults to null after a reset', () => {
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBeNull();
  });

  it('setExpandedAutomationClipId writes the field', () => {
    useAppStore.getState().setExpandedAutomationClipId('clip-x');
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBe('clip-x');
    useAppStore.getState().setExpandedAutomationClipId(null);
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBeNull();
  });

  it('partialize excludes expandedAutomationClipId (only zoom persists)', () => {
    // The persist middleware writes synchronously via createJSONStorage(localStorage).
    if (typeof window === 'undefined') return; // SSR guard
    useAppStore.getState().setExpandedAutomationClipId('should-not-persist');
    // The actual persist `name` is set in lib/store/index.ts as 'vibegrid-store'.
    const raw = window.localStorage.getItem('vibegrid-store');
    if (!raw) {
      // persist may not have flushed yet under jsdom — skip rather than false-pass
      return;
    }
    const parsed = JSON.parse(raw);
    expect(parsed.state.ui?.expandedAutomationClipId).toBeUndefined();
    expect(parsed.state.ui?.zoom).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npm test -- store/timeline-slice-automation store/ui-state-automation --run`
Expected: all tests fail — actions don't exist yet, `expandedAutomationClipId` is not in `UIState`.

- [ ] **Step 4: Extend `lib/store/types.ts`**

Locate the `UIState` interface and add the field:

```ts
export interface UIState {
  zoom: number;
  selectedClipId: string | null;
  expandedAutomationClipId: string | null; // transient — never persisted
}
```

Locate the top-level `AppState` interface (where `setZoom` and `setSelectedClipId` are declared as top-level methods, NOT inside a `uiActions` nested namespace) and add next to them:

```ts
setExpandedAutomationClipId(clipId: string | null): void;
```

Locate `TimelineActions` and add the six new methods:

```ts
convertParamToAutomation(clipId: string, key: string, beat: number): void;
convertParamToStatic(clipId: string, key: string): void;
addParamPoint(clipId: string, key: string, point: AutomationPoint<unknown>): void;
removeParamPoint(clipId: string, key: string, index: number): void;
updateParamPoint(clipId: string, key: string, index: number, patch: Partial<AutomationPoint<unknown>>): void;
setParamInterpolation(clipId: string, key: string, interpolation: Interpolation): void;
```

Add imports at the top of the file:

```ts
import type { AutomationPoint, Interpolation } from '@/lib/automation/types';
```

- [ ] **Step 5: Implement actions in `lib/store/timeline-slice.ts`**

Add imports at the top:

```ts
import { isAutomationCurve } from '@/lib/automation/resolve';
import { makeCurve, toStaticValue, addPoint, removePoint, updatePoint } from '@/lib/automation/operations';
import type { AutomationCurve, AutomationPoint, Interpolation } from '@/lib/automation/types';
```

Inside `createTimelineSlice`, define a closure-based helper that uses the enclosing `set` directly — DO NOT use `Parameters<typeof createTimelineSlice>[0]` indirection (TS-circular and fragile).

```ts
// Inside createTimelineSlice's function body, before the returned object:
const patchClipParam = (
  clipId: string,
  key: string,
  transform: (current: unknown) => unknown
): void => {
  set((state) => ({
    timeline: {
      ...state.timeline,
      clips: state.timeline.clips.map((c) => {
        if (c.id !== clipId) return c;
        const params = c.params ?? {};
        if (!(key in params)) return c;
        const next = transform(params[key]);
        if (next === params[key]) return c;
        return { ...c, params: { ...params, [key]: next } };
      })
    }
  }));
};
```

> Helper note: `patchClipParam` is closed over the slice's `set` — it's not exported. Both helper and the six new actions are no-ops when the clip or key is missing, which matches the test contract.

Actions (inside `timelineActions:`):

```ts
convertParamToAutomation: (clipId, key, beat) =>
  patchClipParam(clipId, key, (current) =>
    isAutomationCurve(current) ? current : makeCurve(current, beat, 'linear')
  ),

convertParamToStatic: (clipId, key) =>
  patchClipParam(clipId, key, (current) =>
    isAutomationCurve(current) ? toStaticValue(current) : current
  ),

addParamPoint: (clipId, key, point) =>
  patchClipParam(clipId, key, (current) =>
    isAutomationCurve(current)
      ? addPoint(current as AutomationCurve<unknown>, point as AutomationPoint<unknown>)
      : current
  ),

removeParamPoint: (clipId, key, index) =>
  patchClipParam(clipId, key, (current) =>
    isAutomationCurve(current)
      ? removePoint(current as AutomationCurve<unknown>, index)
      : current
  ),

updateParamPoint: (clipId, key, index, patch) =>
  patchClipParam(clipId, key, (current) =>
    isAutomationCurve(current)
      ? updatePoint(current as AutomationCurve<unknown>, index, patch as Partial<AutomationPoint<unknown>>)
      : current
  ),

setParamInterpolation: (clipId, key, interpolation) =>
  patchClipParam(clipId, key, (current) =>
    isAutomationCurve(current)
      ? { ...(current as AutomationCurve<unknown>), interpolation }
      : current
  ),
```

- [ ] **Step 6: Extend the inline UI in `lib/store/index.ts`**

In `lib/store/index.ts`, the `create(...)` factory (around lines 11–14) holds the inline UI state and its two top-level actions. Make three changes:

1. Add `expandedAutomationClipId: null` to the `ui` initial literal.
2. Add a new top-level action `setExpandedAutomationClipId` next to `setSelectedClipId`.
3. Update the `partialize` comment to mention the new transient field.

```ts
// inside create(...) — UI lives inline; no ui-slice.ts in this project.
ui: { zoom: 1, selectedClipId: null, expandedAutomationClipId: null },
setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
setSelectedClipId: (id) => set((s) => ({ ui: { ...s.ui, selectedClipId: id } })),
setExpandedAutomationClipId: (clipId) =>
  set((s) => ({ ui: { ...s.ui, expandedAutomationClipId: clipId } })),
```

In the `partialize` block, the existing `ui: { zoom: state.ui.zoom }` line is already correct. Update the comment immediately above it:

```ts
// Both selectedClipId and expandedAutomationClipId are transient UI state.
// Persisting them would confuse users on reload (Inspector jumps to a clip
// they didn't select; automation lane re-opens without context). Only `zoom`
// survives reloads.
ui: { zoom: state.ui.zoom },
```

- [ ] **Step 7: Update the 4 existing inline `ui: { … }` literals**

Strict TS will refuse the existing literals once `expandedAutomationClipId` is required. Update each one in place — add `expandedAutomationClipId: null`. Files (verified via grep at plan-write time):

```
components/TopBar/ClearProjectButton.tsx           — inside the onClick reset state
tests/unit/components/Inspector.test.tsx           — beforeEach setState call
tests/unit/components/AutoPresetButton.test.tsx    — beforeEach setState call
tests/unit/components/Timeline/Clip.test.tsx       — beforeEach setState call
```

Each call site currently reads:

```ts
ui: { zoom: 1, selectedClipId: null }
```

Replace with:

```ts
ui: { zoom: 1, selectedClipId: null, expandedAutomationClipId: null }
```

- [ ] **Step 8: Run tests, verify all pass**

Run: `npm test -- store/timeline-slice-automation store/ui-state-automation --run`
Expected: 11 tests green (8 timeline + 3 ui-state).

- [ ] **Step 9: Run full store test slice — no regressions**

Run: `npm test -- store --run`
Expected: all store tests green.

- [ ] **Step 10: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add lib/store/types.ts lib/store/timeline-slice.ts lib/store/index.ts \
        components/TopBar/ClearProjectButton.tsx \
        tests/unit/components/Inspector.test.tsx \
        tests/unit/components/AutoPresetButton.test.tsx \
        tests/unit/components/Timeline/Clip.test.tsx \
        tests/unit/store/timeline-slice-automation.test.ts tests/unit/store/ui-state-automation.test.ts
git commit -m "feat(store): automation point actions + expandedAutomationClipId UI state"
```

---

## Task 4: Inspector — Automate toggle button

**Files:**
- Create: `components/Workspace/Inspector/AutomateButton.tsx`
- Modify: `components/Workspace/Inspector/index.tsx`
- Create: `tests/unit/components/Inspector-automate.test.tsx`

> The button is small and sits next to each slider param's label. Clicking on a static param converts it to a single-point curve at the current playhead beat; clicking on an automated param collapses the curve back to a static value (using `points[0].value`).

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/Inspector-automate.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { Inspector } from '@/components/Workspace/Inspector';
import { _resetBuiltInPluginsForTests } from '@/lib/fx';
import { registerBuiltInPlugins } from '@/lib/fx';
import { isAutomationCurve } from '@/lib/automation/resolve';
import type { AutomationCurve } from '@/lib/automation/types';

const CLIP_ID = 'clip-auto-1';

beforeEach(() => {
  _resetBuiltInPluginsForTests();
  registerBuiltInPlugins();
  useAppStore.setState((s) => ({
    timeline: {
      ...s.timeline,
      playhead: { beats: 2, playing: false },
      clips: [
        {
          id: CLIP_ID,
          trackId: 'track-pulse',
          kind: 'pulse',
          fxId: 'pulse',
          startBeat: 0,
          lengthBeats: 8,
          label: 'Pulse',
          params: { intensity: 0.5, color: '#ff00ff' }
        }
      ]
    },
    ui: { ...s.ui, selectedClipId: CLIP_ID, expandedAutomationClipId: null }
  }));
});

describe('Inspector — Automate button', () => {
  it('renders an Automate button only for slider params', () => {
    render(<Inspector />);
    // intensity is slider → button present
    expect(screen.getByRole('button', { name: /automate intensity/i })).toBeDefined();
    // color is color picker → no automate button
    expect(screen.queryByRole('button', { name: /automate color/i })).toBeNull();
  });

  it('converts static → automation on click (uses playhead beat)', () => {
    render(<Inspector />);
    fireEvent.click(screen.getByRole('button', { name: /automate intensity/i }));
    const v = useAppStore.getState().timeline.clips[0].params!.intensity;
    expect(isAutomationCurve(v)).toBe(true);
    const c = v as AutomationCurve<number>;
    expect(c.points).toEqual([{ beat: 2, value: 0.5 }]);
  });

  it('converts automation → static on second click (uses points[0].value)', () => {
    useAppStore.getState().timelineActions.convertParamToAutomation(CLIP_ID, 'intensity', 0);
    useAppStore.getState().timelineActions.updateParamPoint(CLIP_ID, 'intensity', 0, { value: 0.9 });
    render(<Inspector />);
    fireEvent.click(screen.getByRole('button', { name: /automate intensity/i }));
    expect(useAppStore.getState().timeline.clips[0].params!.intensity).toBe(0.9);
  });

  it('"Edit on timeline" link appears only when at least one param is automated', () => {
    render(<Inspector />);
    expect(screen.queryByRole('button', { name: /edit on timeline/i })).toBeNull();
    useAppStore.getState().timelineActions.convertParamToAutomation(CLIP_ID, 'intensity', 0);
    // re-render naturally — fire a no-op state update so React rebuilds
    render(<Inspector />);
    // there will be two Inspectors now in the DOM — second one has the link
    const edits = screen.getAllByRole('button', { name: /edit on timeline/i });
    expect(edits.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- components/Inspector-automate --run`
Expected: 4 tests fail — AutomateButton doesn't exist, Inspector doesn't render it.

- [ ] **Step 3: Implement `components/Workspace/Inspector/AutomateButton.tsx`**

```tsx
'use client';
import { useAppStore } from '@/lib/store';
import { isAutomationCurve } from '@/lib/automation/resolve';

export function AutomateButton({
  clipId,
  paramKey,
  paramLabel,
  value
}: {
  clipId: string;
  paramKey: string;
  paramLabel: string;
  value: unknown;
}) {
  const playheadBeats = useAppStore((s) => s.timeline.playhead.beats);
  const convertToAuto = useAppStore((s) => s.timelineActions.convertParamToAutomation);
  const convertToStatic = useAppStore((s) => s.timelineActions.convertParamToStatic);
  const automated = isAutomationCurve(value);

  const onClick = () => {
    if (automated) {
      convertToStatic(clipId, paramKey);
    } else {
      convertToAuto(clipId, paramKey, playheadBeats);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Automate ${paramLabel}`}
      aria-pressed={automated}
      className={
        'ml-2 inline-flex h-5 w-5 items-center justify-center rounded text-[10px] ' +
        (automated
          ? 'bg-[var(--a2)] text-white'
          : 'bg-[var(--surface-3)] text-[var(--text-dim)] hover:text-[var(--text)]')
      }
      title={automated ? 'Remove automation' : 'Add automation'}
    >
      ⚡
    </button>
  );
}
```

- [ ] **Step 4: Modify `components/Workspace/Inspector/index.tsx`**

Within the existing `Object.entries(plugin.paramSchema).map(...)` block, render the AutomateButton next to the param label for slider params only, and add the "Edit on timeline" link. Replace the existing `<label key={key} className="block">` block with:

```tsx
{Object.entries(plugin.paramSchema).map(([key, schema]) => {
  const raw = (params as Record<string, unknown>)[key];
  const automated = isAutomationCurve(raw);
  const display = automated ? raw.points[0]?.value : raw;
  const showAutomate = schema.kind === 'slider';
  return (
    <label key={key} className="block">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-[var(--text-dim)] flex items-center">
          {schema.label}
          {showAutomate && (
            <AutomateButton
              clipId={clip.id}
              paramKey={key}
              paramLabel={schema.label}
              value={raw}
            />
          )}
        </span>
        {automated && (
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
```

Add the import at the top of the file:

```tsx
import { AutomateButton } from './AutomateButton';
```

Below the param map, add the "Edit on timeline" link block:

```tsx
{Object.values(params).some((v) => isAutomationCurve(v)) && (
  <div className="px-3 pt-1">
    <EditOnTimelineLink clipId={clip.id} />
  </div>
)}
```

> `EditOnTimelineLink` is implemented in Task 5. For Task 4, define it inline as a stub at the bottom of the file so this task's tests compile:

```tsx
function EditOnTimelineLink({ clipId: _clipId }: { clipId: string }) {
  return (
    <button type="button" className="text-xs text-[var(--a2)] underline">
      Edit on timeline
    </button>
  );
}
```

> Task 5 replaces the stub with the wired-up version.

- [ ] **Step 5: Run tests, verify all pass**

Run: `npm test -- components/Inspector-automate components/Inspector --run`
Expected: 4 new + 3 existing = 7 tests green. If existing tests fail because the DOM layout changed (e.g., the "automated" badge moved), update the queries in the existing test file to match the new layout — the badge is still text "automated", but its container changed.

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add components/Workspace/Inspector/AutomateButton.tsx components/Workspace/Inspector/index.tsx \
        tests/unit/components/Inspector-automate.test.tsx
git commit -m "feat(inspector): per-slider Automate toggle + Edit on timeline stub"
```

---

## Task 5: Wire "Edit on timeline" link to expandedAutomationClipId

**Files:**
- Modify: `components/Workspace/Inspector/index.tsx`

> Replace the Task 4 stub with the real wiring. Clicking toggles `expandedAutomationClipId` between `clip.id` (open) and `null` (closed).

- [ ] **Step 1: Replace the stub `EditOnTimelineLink` in `components/Workspace/Inspector/index.tsx`**

```tsx
function EditOnTimelineLink({ clipId }: { clipId: string }) {
  const expandedId = useAppStore((s) => s.ui.expandedAutomationClipId);
  const setExpanded = useAppStore((s) => s.setExpandedAutomationClipId);
  const open = expandedId === clipId;
  return (
    <button
      type="button"
      onClick={() => setExpanded(open ? null : clipId)}
      className="text-xs text-[var(--a2)] underline hover:text-[var(--a1)]"
      aria-pressed={open}
    >
      {open ? 'Hide automation' : 'Edit on timeline'}
    </button>
  );
}
```

- [ ] **Step 2: Write the failing test (extend Inspector-automate.test.tsx)**

Append to `tests/unit/components/Inspector-automate.test.tsx`:

```tsx
describe('Inspector — Edit on timeline wiring', () => {
  beforeEach(() => {
    useAppStore.getState().timelineActions.convertParamToAutomation(CLIP_ID, 'intensity', 0);
  });

  it('clicking sets expandedAutomationClipId to clip.id', () => {
    render(<Inspector />);
    fireEvent.click(screen.getByRole('button', { name: /edit on timeline/i }));
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBe(CLIP_ID);
  });

  it('button text flips to "Hide automation" when open', () => {
    useAppStore.getState().setExpandedAutomationClipId(CLIP_ID);
    render(<Inspector />);
    expect(screen.getByRole('button', { name: /hide automation/i })).toBeDefined();
  });

  it('clicking again clears expandedAutomationClipId', () => {
    useAppStore.getState().setExpandedAutomationClipId(CLIP_ID);
    render(<Inspector />);
    fireEvent.click(screen.getByRole('button', { name: /hide automation/i }));
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests, verify all pass**

Run: `npm test -- components/Inspector-automate --run`
Expected: 7 tests green (4 from Task 4 + 3 new).

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add components/Workspace/Inspector/index.tsx tests/unit/components/Inspector-automate.test.tsx
git commit -m "feat(inspector): wire Edit on timeline to expandedAutomationClipId"
```

---

## Task 6: AutomationCurvePath (pure SVG path)

**Files:**
- Create: `components/Workspace/Timeline/AutomationCurvePath.tsx`
- Create: `tests/unit/components/Timeline/AutomationCurvePath.test.tsx`

> Renders a connected curve through the points using the curve's interpolation mode. Pure mapping: takes (points, interpolation, width, height, valueMin, valueMax, lengthBeats) and returns an SVG `<path d>` string. Extracted so it can be unit-tested without DOM.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/Timeline/AutomationCurvePath.test.tsx
import { describe, it, expect } from 'vitest';
import { buildCurvePath } from '@/components/Workspace/Timeline/AutomationCurvePath';
import type { AutomationPoint } from '@/lib/automation/types';

const opts = { widthPx: 100, heightPx: 50, valueMin: 0, valueMax: 1, lengthBeats: 4 };

describe('buildCurvePath', () => {
  it('linear path connects points with straight lines (M…L…)', () => {
    const pts: AutomationPoint<number>[] = [
      { beat: 0, value: 0 },
      { beat: 4, value: 1 }
    ];
    const d = buildCurvePath(pts, 'linear', opts);
    // x: 0 → 100 (full width), y: heightPx → 0 (inverted; value 0 at bottom)
    expect(d).toBe('M 0,50 L 100,0');
  });

  it('step path uses horizontal-then-vertical segments', () => {
    const pts: AutomationPoint<number>[] = [
      { beat: 0, value: 0 },
      { beat: 4, value: 1 }
    ];
    const d = buildCurvePath(pts, 'step', opts);
    // Hold value 0 across the segment, then jump up at beat 4
    expect(d).toBe('M 0,50 L 100,50 L 100,0');
  });

  it('easeIn path uses a cubic Bezier control point pulled toward start', () => {
    const pts: AutomationPoint<number>[] = [
      { beat: 0, value: 0 },
      { beat: 4, value: 1 }
    ];
    const d = buildCurvePath(pts, 'easeIn', opts);
    // M start, C cp1 cp2 end. Just assert the command shape; numeric cp values
    // are documented in the implementation.
    expect(d).toMatch(/^M 0,50 C [\d.]+,50 [\d.]+,0 100,0$/);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail (module not found)**

Run: `npm test -- AutomationCurvePath --run`

- [ ] **Step 3: Implement `components/Workspace/Timeline/AutomationCurvePath.tsx`**

```tsx
import type { AutomationPoint, Interpolation } from '@/lib/automation/types';

interface BuildOpts {
  widthPx: number;
  heightPx: number;
  valueMin: number;
  valueMax: number;
  lengthBeats: number;
}

function project(point: AutomationPoint<number>, o: BuildOpts): { x: number; y: number } {
  const x = (point.beat / o.lengthBeats) * o.widthPx;
  // value 0 at bottom, value max at top — invert Y
  const range = o.valueMax - o.valueMin || 1;
  const norm = (point.value - o.valueMin) / range;
  const y = o.heightPx - norm * o.heightPx;
  return { x, y };
}

/**
 * Pure: produce an SVG path string for the given points + interpolation.
 *
 * @param points Must be sorted by beat asc (the store keeps them that way).
 * @param interpolation Curve mode.
 * @param o Projection options: lane size + param schema's min/max + clip length in beats.
 */
export function buildCurvePath(
  points: AutomationPoint<number>[],
  interpolation: Interpolation,
  o: BuildOpts
): string {
  if (points.length === 0) return '';
  const projected = points.map((p) => project(p, o));
  const segs: string[] = [`M ${projected[0].x},${projected[0].y}`];
  for (let i = 1; i < projected.length; i++) {
    const a = projected[i - 1];
    const b = projected[i];
    if (interpolation === 'linear') {
      segs.push(`L ${b.x},${b.y}`);
    } else if (interpolation === 'step') {
      // hold a.y until b.x, then jump to b.y
      segs.push(`L ${b.x},${a.y}`);
      segs.push(`L ${b.x},${b.y}`);
    } else {
      // easeIn / easeOut → cubic Bezier with control points biased to one end
      // easeIn: control points pulled toward A (slow start) → cp1 = (a.x, a.y), cp2 = (b.x, a.y)
      // easeOut: control points pulled toward B (slow finish) → cp1 = (a.x, b.y), cp2 = (b.x, b.y)
      // (matches the y-position blend the resolver produces — quadratic in Y, cubic for the SVG curve.)
      const cp1 = interpolation === 'easeIn' ? { x: a.x, y: a.y } : { x: a.x, y: b.y };
      const cp2 = interpolation === 'easeIn' ? { x: b.x, y: a.y } : { x: b.x, y: b.y };
      segs.push(`C ${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${b.x},${b.y}`);
    }
  }
  return segs.join(' ');
}

/** Convenience component: renders the path as an SVG <path>. */
export function AutomationCurvePath({
  points,
  interpolation,
  widthPx,
  heightPx,
  valueMin,
  valueMax,
  lengthBeats,
  className
}: BuildOpts & {
  points: AutomationPoint<number>[];
  interpolation: Interpolation;
  className?: string;
}) {
  const d = buildCurvePath(points, interpolation, {
    widthPx,
    heightPx,
    valueMin,
    valueMax,
    lengthBeats
  });
  return <path d={d} fill="none" stroke="var(--a2)" strokeWidth={1.5} className={className} />;
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `npm test -- AutomationCurvePath --run`
Expected: 3 tests green.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/Workspace/Timeline/AutomationCurvePath.tsx \
        tests/unit/components/Timeline/AutomationCurvePath.test.tsx
git commit -m "feat(timeline): pure SVG path builder for automation curves"
```

---

## Task 7: AutomationPoint component (drag + delete)

**Files:**
- Create: `components/Workspace/Timeline/AutomationPoint.tsx`
- Create: `tests/unit/components/Timeline/AutomationPoint.test.tsx`

> Single SVG circle with pointer-drag updating the store live. Right-click removes the point. Drag clamps beat to `[0, lengthBeats]` and value to `[paramSchema.min, paramSchema.max]`. Same window-listener pattern as `Clip.tsx`'s resize handle.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/Timeline/AutomationPoint.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { AutomationPoint as PointDot } from '@/components/Workspace/Timeline/AutomationPoint';
import type { AutomationCurve } from '@/lib/automation/types';

const CLIP_ID = 'clip-auto-1';
const KEY = 'intensity';

beforeEach(() => {
  useAppStore.setState((s) => ({
    timeline: {
      ...s.timeline,
      clips: [
        {
          id: CLIP_ID,
          trackId: 'track-pulse',
          kind: 'pulse',
          fxId: 'pulse',
          startBeat: 0,
          lengthBeats: 8,
          label: 'Pulse',
          params: {
            intensity: {
              mode: 'automation',
              interpolation: 'linear',
              points: [
                { beat: 0, value: 0 },
                { beat: 4, value: 1 }
              ]
            } satisfies AutomationCurve<number>
          }
        }
      ]
    }
  }));
});

const baseProps = {
  clipId: CLIP_ID,
  paramKey: KEY,
  pointIndex: 0,
  beat: 0,
  value: 0,
  lengthBeats: 8,
  laneWidthPx: 160, // 20 px per beat
  laneHeightPx: 50,
  valueMin: 0,
  valueMax: 1
};

const renderInSvg = (extra?: Partial<typeof baseProps>) =>
  render(
    <svg width={baseProps.laneWidthPx} height={baseProps.laneHeightPx}>
      <PointDot {...baseProps} {...extra} />
    </svg>
  );

describe('AutomationPoint', () => {
  it('renders at (beat·px, valueY) from schema min/max', () => {
    renderInSvg();
    const dot = screen.getByLabelText(/automation point 1/i);
    // beat=0 → x=0; value=0 → y=laneHeightPx=50
    expect(dot.getAttribute('cx')).toBe('0');
    expect(dot.getAttribute('cy')).toBe('50');
  });

  it('right-click on a non-last point dispatches removeParamPoint', () => {
    renderInSvg();
    fireEvent.contextMenu(screen.getByLabelText(/automation point 1/i));
    const v = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(v.points.map((p) => p.beat)).toEqual([4]);
  });

  it('right-click on the LAST remaining point collapses to static (no empty-curve throw)', () => {
    // Replace the two-point curve with a single-point curve to set up the edge case.
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: s.timeline.clips.map((c) =>
          c.id === CLIP_ID
            ? {
                ...c,
                params: {
                  intensity: {
                    mode: 'automation',
                    interpolation: 'linear',
                    points: [{ beat: 0, value: 0.5 }]
                  } satisfies AutomationCurve<number>
                }
              }
            : c
        )
      }
    }));
    renderInSvg({ value: 0.5 });
    fireEvent.contextMenu(screen.getByLabelText(/automation point 1/i));
    expect(useAppStore.getState().timeline.clips[0].params!.intensity).toBe(0.5);
  });

  it('pointer-drag updates store with clamped beat+value', () => {
    renderInSvg();
    const dot = screen.getByLabelText(/automation point 1/i);
    fireEvent.pointerDown(dot, { clientX: 0, clientY: 50 });
    // Move to (40, 25): 40 / 20 = beat 2; y=25 → norm=0.5 → value=0.5
    fireEvent.pointerMove(window, { clientX: 40, clientY: 25 });
    fireEvent.pointerUp(window, { clientX: 40, clientY: 25 });
    const v = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(v.points[0].beat).toBeCloseTo(2, 5);
    expect(v.points[0].value).toBeCloseTo(0.5, 5);
  });

  it('pointer-drag clamps to lane bounds', () => {
    renderInSvg();
    const dot = screen.getByLabelText(/automation point 1/i);
    fireEvent.pointerDown(dot, { clientX: 0, clientY: 50 });
    // Move to (-100, -100) — should clamp to (0, 0) in (beat, y), i.e. (beat=0, value=1)
    fireEvent.pointerMove(window, { clientX: -100, clientY: -100 });
    fireEvent.pointerUp(window, { clientX: -100, clientY: -100 });
    const v = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(v.points[0].beat).toBeCloseTo(0, 5);
    expect(v.points[0].value).toBeCloseTo(1, 5);
  });
});
```

> Note: the test mocks `getBoundingClientRect` implicitly by setting up the SVG inside jsdom; the component must use `currentTarget.ownerSVGElement` and `getCTM()`-relative coordinates OR compute deltas off the down-event coords. We pick deltas — robust under jsdom which returns zero rects.

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- Timeline/AutomationPoint --run`

- [ ] **Step 3: Implement `components/Workspace/Timeline/AutomationPoint.tsx`**

```tsx
'use client';
import { useAppStore } from '@/lib/store';

export function AutomationPoint({
  clipId,
  paramKey,
  pointIndex,
  beat,
  value,
  lengthBeats,
  laneWidthPx,
  laneHeightPx,
  valueMin,
  valueMax
}: {
  clipId: string;
  paramKey: string;
  pointIndex: number;
  beat: number;
  value: number;
  lengthBeats: number;
  laneWidthPx: number;
  laneHeightPx: number;
  valueMin: number;
  valueMax: number;
}) {
  const updateParamPoint = useAppStore((s) => s.timelineActions.updateParamPoint);
  const removeParamPoint = useAppStore((s) => s.timelineActions.removeParamPoint);
  const range = valueMax - valueMin || 1;
  const cx = (beat / lengthBeats) * laneWidthPx;
  const cy = laneHeightPx - ((value - valueMin) / range) * laneHeightPx;

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startBeat = beat;
    const startValue = value;
    const pxPerBeat = laneWidthPx / lengthBeats;

    const move = (ev: PointerEvent) => {
      const dxBeats = (ev.clientX - startX) / pxPerBeat;
      const dyValue = -((ev.clientY - startY) / laneHeightPx) * range; // up = increase
      const nextBeat = Math.max(0, Math.min(lengthBeats, startBeat + dxBeats));
      const nextValue = Math.max(valueMin, Math.min(valueMax, startValue + dyValue));
      updateParamPoint(clipId, paramKey, pointIndex, { beat: nextBeat, value: nextValue });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Guard against right-clicking the last point and emptying the curve —
  // resolveParam throws on an empty points array. If this would be the last
  // point, collapse the param back to a static value using points[0].value
  // (which IS this point — same shape as the Inspector ⚡ flow).
  const totalPoints = useAppStore(
    (s) => {
      const clip = s.timeline.clips.find((c) => c.id === clipId);
      const val = clip?.params?.[paramKey];
      if (val && typeof val === 'object' && 'points' in val) {
        return (val as { points: unknown[] }).points.length;
      }
      return 0;
    }
  );
  const convertToStatic = useAppStore((s) => s.timelineActions.convertParamToStatic);

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (totalPoints <= 1) {
      // Last point — collapse to static instead of emptying the curve.
      convertToStatic(clipId, paramKey);
    } else {
      removeParamPoint(clipId, paramKey, pointIndex);
    }
  };

  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill="var(--a2)"
      stroke="var(--bg)"
      strokeWidth={1.5}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      role="button"
      aria-label={`Automation point ${pointIndex + 1}`}
      style={{ cursor: 'grab' }}
    />
  );
}
```

> Why deltas instead of absolute coords: jsdom returns zero-sized `getBoundingClientRect` for SVG children, so converting screen-X back to SVG-X via `getScreenCTM()` is fragile in tests. Deltas off the pointer-down event coords sidestep this completely and match the project's `Clip.tsx` resize-handle pattern.

- [ ] **Step 4: Run tests, verify all pass**

Run: `npm test -- Timeline/AutomationPoint --run`
Expected: 5 tests green.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/Workspace/Timeline/AutomationPoint.tsx \
        tests/unit/components/Timeline/AutomationPoint.test.tsx
git commit -m "feat(timeline): AutomationPoint with drag + right-click delete"
```

---

## Task 8: AutomationLane component

**Files:**
- Create: `components/Workspace/Timeline/AutomationLane.tsx`
- Create: `tests/unit/components/Timeline/AutomationLane.test.tsx`

> One lane container per expanded clip. Renders one sub-row per automated **slider** param. Each sub-row has: a header (param label + interpolation picker + close button), an SVG area with the curve path + point handles, and a click-on-empty-area handler that adds a new point at the cursor's (beat, value).

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/Timeline/AutomationLane.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { _resetBuiltInPluginsForTests, registerBuiltInPlugins } from '@/lib/fx';
import { AutomationLane } from '@/components/Workspace/Timeline/AutomationLane';
import type { AutomationCurve } from '@/lib/automation/types';

const CLIP_ID = 'clip-auto-1';
const PX_PER_BEAT = 40;

beforeEach(() => {
  _resetBuiltInPluginsForTests();
  registerBuiltInPlugins();
  useAppStore.setState((s) => ({
    timeline: {
      ...s.timeline,
      clips: [
        {
          id: CLIP_ID,
          trackId: 'track-pulse',
          kind: 'pulse',
          fxId: 'pulse',
          startBeat: 0,
          lengthBeats: 8,
          label: 'Pulse',
          params: {
            intensity: {
              mode: 'automation',
              interpolation: 'linear',
              points: [{ beat: 0, value: 0 }, { beat: 4, value: 1 }]
            } satisfies AutomationCurve<number>,
            color: '#ff00ff'
          }
        }
      ]
    },
    ui: { ...s.ui, zoom: 1, expandedAutomationClipId: CLIP_ID }
  }));
});

describe('AutomationLane', () => {
  it('renders nothing when expandedAutomationClipId !== clip.id', () => {
    useAppStore.getState().setExpandedAutomationClipId(null);
    const { container } = render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one sub-row per automated slider param (skips color/toggle)', () => {
    render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    expect(screen.getAllByTestId('automation-lane-row')).toHaveLength(1);
  });

  it('shows the param label + interpolation picker in the header', () => {
    render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    expect(screen.getByText(/intensity/i)).toBeDefined();
    expect(screen.getByRole('combobox', { name: /interpolation/i })).toBeDefined();
  });

  it('changing the interpolation picker dispatches setParamInterpolation', () => {
    render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    fireEvent.change(screen.getByRole('combobox', { name: /interpolation/i }), {
      target: { value: 'easeOut' }
    });
    const v = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(v.interpolation).toBe('easeOut');
  });

  it('close button clears expandedAutomationClipId', () => {
    render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    fireEvent.click(screen.getByRole('button', { name: /close automation/i }));
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBeNull();
  });

  it('clicking the empty lane area adds a new point', () => {
    render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    const surface = screen.getByTestId('automation-lane-surface');
    // simulate a click at lane-relative (80px, 25px). With laneWidthPx = lengthBeats * px = 8*40 = 320,
    // that puts the new point at beat 80/40 = 2, value (1 - 25/50) = 0.5.
    // jsdom's getBoundingClientRect returns zeros, so the component reads offsetX from the event.
    fireEvent.pointerDown(surface, { clientX: 80, clientY: 25, button: 0 });
    const v = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(v.points.length).toBe(3); // 2 initial + 1 added
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- Timeline/AutomationLane --run`

- [ ] **Step 3: Implement `components/Workspace/Timeline/AutomationLane.tsx`**

```tsx
'use client';
import { useAppStore } from '@/lib/store';
import { getPlugin } from '@/lib/renderer/registry';
import { isAutomationCurve } from '@/lib/automation/resolve';
import type { AutomationCurve, Interpolation } from '@/lib/automation/types';
import { AutomationPoint as PointDot } from './AutomationPoint';
import { AutomationCurvePath } from './AutomationCurvePath';

const LANE_HEIGHT = 50;

const INTERPOLATION_MODES: Interpolation[] = ['linear', 'step', 'easeIn', 'easeOut'];

export function AutomationLane({
  clipId,
  pxPerBeat
}: {
  clipId: string;
  pxPerBeat: number;
}) {
  const expandedId = useAppStore((s) => s.ui.expandedAutomationClipId);
  const setExpanded = useAppStore((s) => s.setExpandedAutomationClipId);
  const clip = useAppStore((s) => s.timeline.clips.find((c) => c.id === clipId));
  const setParamInterpolation = useAppStore((s) => s.timelineActions.setParamInterpolation);
  const addParamPoint = useAppStore((s) => s.timelineActions.addParamPoint);

  if (!clip || expandedId !== clipId) return null;
  if (!clip.fxId) return null;
  const plugin = getPlugin(clip.fxId);
  if (!plugin) return null;

  // Only slider params with active automation curves are visualized in v0.1.
  const params = (clip.params ?? {}) as Record<string, unknown>;
  const automated = Object.entries(plugin.paramSchema).filter(([k, schema]) => {
    return schema.kind === 'slider' && isAutomationCurve(params[k]);
  });
  if (automated.length === 0) return null;

  const laneWidthPx = clip.lengthBeats * pxPerBeat;
  const offsetLeftPx = clip.startBeat * pxPerBeat;

  return (
    <div
      className="relative bg-[var(--surface-1)] border-y border-[var(--border)]"
      data-testid="automation-lane"
    >
      {automated.map(([key, schema]) => {
        if (schema.kind !== 'slider') return null;
        const curve = params[key] as AutomationCurve<number>;
        return (
          <div key={key} className="flex items-stretch" data-testid="automation-lane-row">
            <div className="shrink-0 w-[80px] sticky left-0 z-20 bg-[var(--surface-2)] border-r border-[var(--border)] px-2 py-1 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
                {schema.label}
              </span>
              <div className="flex items-center gap-1">
                <select
                  aria-label={`Interpolation for ${schema.label}`}
                  className="text-[10px] bg-[var(--surface-3)] text-[var(--text)] rounded px-1 py-0.5"
                  value={curve.interpolation}
                  onChange={(e) => setParamInterpolation(clipId, key, e.target.value as Interpolation)}
                >
                  {INTERPOLATION_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="Close automation"
                  onClick={() => setExpanded(null)}
                  className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="relative" style={{ marginLeft: offsetLeftPx, width: laneWidthPx, height: LANE_HEIGHT }}>
              <svg
                width={laneWidthPx}
                height={LANE_HEIGHT}
                data-testid="automation-lane-surface"
                onPointerDown={(e) => {
                  // Add a point only if the user clicked the SVG background (not a point handle).
                  if ((e.target as Element).tagName === 'circle') return;
                  const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                  // jsdom returns zero-sized rect; fall back to event.clientX/Y as raw offset for tests.
                  const localX = rect.width > 0 ? e.clientX - rect.left : e.clientX;
                  const localY = rect.height > 0 ? e.clientY - rect.top : e.clientY;
                  const beat = Math.max(0, Math.min(clip.lengthBeats, (localX / laneWidthPx) * clip.lengthBeats));
                  const range = schema.max - schema.min;
                  const norm = 1 - localY / LANE_HEIGHT;
                  const value = Math.max(schema.min, Math.min(schema.max, schema.min + norm * range));
                  addParamPoint(clipId, key, { beat, value });
                }}
              >
                <AutomationCurvePath
                  points={curve.points}
                  interpolation={curve.interpolation}
                  widthPx={laneWidthPx}
                  heightPx={LANE_HEIGHT}
                  valueMin={schema.min}
                  valueMax={schema.max}
                  lengthBeats={clip.lengthBeats}
                />
                {curve.points.map((pt, i) => (
                  <PointDot
                    key={i}
                    clipId={clipId}
                    paramKey={key}
                    pointIndex={i}
                    beat={pt.beat}
                    value={pt.value}
                    lengthBeats={clip.lengthBeats}
                    laneWidthPx={laneWidthPx}
                    laneHeightPx={LANE_HEIGHT}
                    valueMin={schema.min}
                    valueMax={schema.max}
                  />
                ))}
              </svg>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `npm test -- Timeline/AutomationLane --run`
Expected: 6 tests green.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/Workspace/Timeline/AutomationLane.tsx \
        tests/unit/components/Timeline/AutomationLane.test.tsx
git commit -m "feat(timeline): AutomationLane with header, points, and click-to-add"
```

---

## Task 9: Mount AutomationLane in Tracks

**Files:**
- Modify: `components/Workspace/Timeline/Tracks.tsx`

> Insert the lane right after the matching track row as a sibling node. The lane uses natural (auto) height so multiple automated slider params (e.g. Sweep's `speed` + `radius`) stack cleanly. The lane node is INSIDE the existing `<DndContext>` — that's intentional and safe: dnd-kit's `PointerSensor` has `activationConstraint: { distance: 5 }` and `useDraggable` is only attached to `<Clip>`, so neither the lane surface nor the point handles trigger drag tracking.
>
> No new tests for Tracks — Task 8's AutomationLane tests + the existing Tracks tests cover this together. The smoke gate (Task 16, step 6) explicitly walks the drag-inside-DndContext path.

- [ ] **Step 1: Modify `components/Workspace/Timeline/Tracks.tsx`**

Add import at the top:

```ts
import { AutomationLane } from './AutomationLane';
```

Add the reactive subscription near the other `useAppStore` calls at the top of `Tracks`:

```ts
const expandedAutomationClipId = useAppStore((s) => s.ui.expandedAutomationClipId);
```

> Note: We MUST subscribe via `useAppStore((s) => …)` so the component re-renders when the field changes. `useAppStore.getState()` inside a `.map()` body would read the value once and never update.

Replace the existing `tracks.map(...)` body with this complete snippet. The change is purely additive — the existing label + clip area markup is preserved verbatim, and a conditional sibling lane row is appended.

```tsx
{tracks.map((t) => {
  const expandedClip =
    expandedAutomationClipId
      ? clips.find((c) => c.trackId === t.id && c.id === expandedAutomationClipId)
      : undefined;
  return (
    <div key={t.id}>
      <div
        className="flex border-b border-[var(--border)]"
        style={{ height: TRACK_HEIGHT, width: TRACK_LABEL_WIDTH + totalBeats * px }}
      >
        <div
          className="shrink-0 sticky left-0 z-20 bg-[var(--surface-1)] border-r border-[var(--border)] px-2 flex items-center text-[10px] uppercase tracking-wider text-[var(--text-muted)] select-none"
          style={{ width: TRACK_LABEL_WIDTH }}
        >
          {t.name}
        </div>
        <div
          className="relative shrink-0"
          style={{ width: totalBeats * px }}
          data-track-id={t.id}
          data-track-kind={t.kind}
        >
          {clips
            .filter((c) => c.trackId === t.id)
            .map((c) => (
              <Clip key={c.id} clip={c} />
            ))}
        </div>
      </div>
      {expandedClip && (
        <div
          className="relative border-b border-[var(--border)]"
          style={{ width: TRACK_LABEL_WIDTH + totalBeats * px }}
        >
          {/* Height is intentionally not fixed — the lane auto-grows for N
              automated params (Sweep has two: speed + radius). */}
          <AutomationLane clipId={expandedClip.id} pxPerBeat={px} />
        </div>
      )}
    </div>
  );
})}
```

- [ ] **Step 2: Run Tracks tests to confirm no regression**

Run: `npm test -- components/Timeline --run`
Expected: existing Timeline tests + new AutomationLane tests green.

- [ ] **Step 3: Run typecheck + lint + full test suite**

Run: `npm run typecheck && npm run lint && npm test -- --run`
Expected: ≥ 280 tests green at this midpoint (final gate is ≥ 300 — see Task 15), no typecheck or lint errors.

- [ ] **Step 4: Commit**

```bash
git add components/Workspace/Timeline/Tracks.tsx
git commit -m "feat(timeline): mount AutomationLane below the matching track row"
```

---

## Task 10: Pure peaks downsampler + worker refactor

**Files:**
- Create: `lib/audio/peaks.ts`
- Modify: `lib/audio/waveform-worker.ts`
- Create: `tests/unit/audio/peaks.test.ts`

> Extract the worker's downsample math into a pure function so it can be unit-tested and reused. The worker becomes a thin postMessage wrapper.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/audio/peaks.test.ts
import { describe, it, expect } from 'vitest';
import { downsamplePeaks } from '@/lib/audio/peaks';

describe('downsamplePeaks', () => {
  it('downsamples 8 samples to 4 cols → 2 samples/col min+max', () => {
    const data = new Float32Array([0.1, 0.5, -0.3, 0.8, 0.0, -0.5, 0.2, 0.4]);
    const peaks = downsamplePeaks(data, 4);
    expect(peaks).toEqual([
      [0.1, 0.5],     // [0.1, 0.5]
      [-0.3, 0.8],    // [-0.3, 0.8]
      [-0.5, 0.0],    // [0.0, -0.5]
      [0.2, 0.4]      // [0.2, 0.4]
    ]);
  });

  it('symmetric sine wave gives symmetric min/max per column', () => {
    const data = new Float32Array(1024);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin((i / data.length) * Math.PI * 2);
    const peaks = downsamplePeaks(data, 16);
    // each column straddles a portion of the cycle — min should be ≤ 0, max should be ≥ 0
    for (const [min, max] of peaks) {
      expect(min).toBeLessThanOrEqual(0);
      expect(max).toBeGreaterThanOrEqual(0);
    }
  });

  it('empty samples produce all-zero peaks (no NaN from division-by-zero)', () => {
    const peaks = downsamplePeaks(new Float32Array(0), 4);
    for (const [min, max] of peaks) {
      expect(min).toBe(0);
      expect(max).toBe(0);
    }
  });

  it('targetCols=1 returns the global min/max', () => {
    const data = new Float32Array([-0.7, 0.3, 0.9, -0.2]);
    const peaks = downsamplePeaks(data, 1);
    expect(peaks).toEqual([[-0.7, 0.9]]);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail (module not found)**

Run: `npm test -- audio/peaks --run`

- [ ] **Step 3: Implement `lib/audio/peaks.ts`**

```ts
export type WaveformPeaks = Array<[min: number, max: number]>;

/**
 * Pure: scan a sample buffer and return `targetCols` (min, max) pairs.
 *
 * Worker and main-thread fallbacks share this implementation so the unit
 * tests on the pure function also cover the worker's behavior.
 */
export function downsamplePeaks(data: Float32Array, targetCols: number): WaveformPeaks {
  const peaks: WaveformPeaks = [];
  if (targetCols <= 0) return peaks;
  if (data.length === 0) {
    for (let c = 0; c < targetCols; c++) peaks.push([0, 0]);
    return peaks;
  }
  const samplesPerCol = data.length / targetCols;
  for (let c = 0; c < targetCols; c++) {
    const start = Math.floor(c * samplesPerCol);
    const end = Math.min(data.length, Math.floor((c + 1) * samplesPerCol));
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i++) {
      const s = data[i];
      if (s < min) min = s;
      if (s > max) max = s;
    }
    peaks.push([min, max]);
  }
  return peaks;
}
```

- [ ] **Step 4: Refactor `lib/audio/waveform-worker.ts` to import the pure function**

```ts
/// <reference lib="webworker" />
import { downsamplePeaks, type WaveformPeaks } from './peaks';

export type WaveformWorkerInbound = {
  type: 'downsample';
  data: Float32Array;
  targetCols: number;
};

export type { WaveformPeaks };

export type WaveformWorkerOutbound =
  | { type: 'peaks'; payload: WaveformPeaks }
  | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<WaveformWorkerInbound>) => {
  if (e.data.type !== 'downsample') return;
  try {
    const payload = downsamplePeaks(e.data.data, e.data.targetCols);
    (self as DedicatedWorkerGlobalScope).postMessage({
      type: 'peaks',
      payload
    } satisfies WaveformWorkerOutbound);
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err)
    } satisfies WaveformWorkerOutbound);
  }
};

export {};
```

- [ ] **Step 5: Run tests + full suite — no regressions**

Run: `npm test -- audio/peaks --run` then `npm test -- --run`
Expected: 4 new tests + all existing tests still green.

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/audio/peaks.ts lib/audio/waveform-worker.ts tests/unit/audio/peaks.test.ts
git commit -m "refactor(audio): extract pure downsamplePeaks from waveform-worker"
```

---

## Task 11: useWaveformPeaks hook

**Files:**
- Create: `lib/hooks/useWaveformPeaks.ts`
- Create: `tests/unit/hooks/useWaveformPeaks.test.tsx`

> Owns the full pipeline for one media URL: fetch → `decodeAudioData` → worker → peaks. Module-scoped Map cache keyed by `mediaId`. AbortController on unmount. SSR-safe.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/hooks/useWaveformPeaks.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWaveformPeaks, _resetPeaksCacheForTests } from '@/lib/hooks/useWaveformPeaks';

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage = vi.fn((msg: { type: 'downsample'; data: Float32Array; targetCols: number }) => {
    // Reply asynchronously
    queueMicrotask(() => {
      this.onmessage?.(new MessageEvent('message', {
        data: { type: 'peaks', payload: [[-0.5, 0.5], [-0.3, 0.3]] }
      }));
    });
  });
  terminate = vi.fn();
}

let mockWorker: MockWorker;
const createWorker = () => {
  mockWorker = new MockWorker();
  return mockWorker as unknown as Worker;
};

class MockOfflineCtx {
  constructor(_ch: number, _len: number, _rate: number) {}
  decodeAudioData = vi.fn(async (_buf: ArrayBuffer) => {
    return {
      length: 4,
      duration: 1,
      sampleRate: 44100,
      numberOfChannels: 1,
      getChannelData: (_ch: number) => new Float32Array([0.1, -0.2, 0.3, -0.4])
    } as unknown as AudioBuffer;
  });
}

beforeEach(() => {
  _resetPeaksCacheForTests();
  vi.restoreAllMocks();
  // Use OfflineAudioContext via globalThis since AudioContext isn't in jsdom
  (globalThis as unknown as { OfflineAudioContext: typeof MockOfflineCtx }).OfflineAudioContext =
    MockOfflineCtx;
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8)
  })) as unknown as typeof fetch;
});

describe('useWaveformPeaks', () => {
  it('returns idle status when audioUrl is null', () => {
    const { result } = renderHook(() =>
      useWaveformPeaks({ mediaId: 'm1', audioUrl: null, targetCols: 2, createWorker })
    );
    expect(result.current.status).toBe('idle');
    expect(result.current.peaks).toBeNull();
  });

  it('happy path: fetch → decode → worker → peaks', async () => {
    const { result } = renderHook(() =>
      useWaveformPeaks({ mediaId: 'm1', audioUrl: 'https://x/a.mp3', targetCols: 2, createWorker })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.peaks).toEqual([[-0.5, 0.5], [-0.3, 0.3]]);
  });

  it('cache hit returns existing peaks without re-fetching', async () => {
    const { result: r1 } = renderHook(() =>
      useWaveformPeaks({ mediaId: 'm1', audioUrl: 'https://x/a.mp3', targetCols: 2, createWorker })
    );
    await waitFor(() => expect(r1.current.status).toBe('ready'));
    const callsBefore = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const { result: r2 } = renderHook(() =>
      useWaveformPeaks({ mediaId: 'm1', audioUrl: 'https://x/a.mp3', targetCols: 2, createWorker })
    );
    await waitFor(() => expect(r2.current.status).toBe('ready'));
    const callsAfter = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(callsAfter).toBe(callsBefore); // no additional fetch
    expect(r2.current.peaks).toEqual([[-0.5, 0.5], [-0.3, 0.3]]);
  });

  it('error path sets status=error when fetch fails', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) })) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useWaveformPeaks({ mediaId: 'm-err', audioUrl: 'https://x/bad.mp3', targetCols: 2, createWorker })
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.peaks).toBeNull();
  });

  it('unmount aborts in-flight load', async () => {
    let abortSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
      abortSignal = init?.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        init?.signal?.addEventListener('abort', () => resolve({
          ok: false, status: 0, arrayBuffer: async () => new ArrayBuffer(0)
        } as Response));
      });
    }) as unknown as typeof fetch;

    const { unmount } = renderHook(() =>
      useWaveformPeaks({ mediaId: 'm-abort', audioUrl: 'https://x/a.mp3', targetCols: 2, createWorker })
    );
    unmount();
    await waitFor(() => expect(abortSignal?.aborted).toBe(true));
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- hooks/useWaveformPeaks --run`

- [ ] **Step 3: Implement `lib/hooks/useWaveformPeaks.ts`**

```ts
'use client';
import { useEffect, useState } from 'react';
import { isClient } from '@/lib/utils/is-client';
import { downsamplePeaks, type WaveformPeaks } from '@/lib/audio/peaks';
import { createWaveformWorker as defaultCreateWorker } from '@/lib/audio/worker-factory';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface PeaksCacheEntry {
  peaks: WaveformPeaks;
  targetCols: number;
}

// Module-scoped cache. Survives component remounts (StrictMode-safe).
// Reset between unit tests via _resetPeaksCacheForTests.
const cache = new Map<string, PeaksCacheEntry>();

export function _resetPeaksCacheForTests(): void {
  cache.clear();
}

export interface UseWaveformPeaksOpts {
  mediaId: string | null;
  audioUrl: string | null;
  targetCols?: number;
  /** Override the worker factory for tests. */
  createWorker?: () => Worker;
}

export interface UseWaveformPeaksResult {
  peaks: WaveformPeaks | null;
  status: Status;
}

export function useWaveformPeaks(opts: UseWaveformPeaksOpts): UseWaveformPeaksResult {
  const { mediaId, audioUrl, targetCols = 1024, createWorker = defaultCreateWorker } = opts;
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(() => {
    if (!mediaId) return null;
    return cache.get(mediaId)?.peaks ?? null;
  });
  const [status, setStatus] = useState<Status>(() => {
    if (!mediaId || !audioUrl) return 'idle';
    return cache.has(mediaId) ? 'ready' : 'loading';
  });

  useEffect(() => {
    if (!isClient()) return;
    if (!mediaId || !audioUrl) {
      setStatus('idle');
      setPeaks(null);
      return;
    }

    const cached = cache.get(mediaId);
    if (cached && cached.targetCols === targetCols) {
      setPeaks(cached.peaks);
      setStatus('ready');
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    let worker: Worker | null = null;

    (async () => {
      setStatus('loading');
      try {
        // Audio URL points to R2 `pub-*.r2.dev`. This fetch is subject to the
        // R2 CORS allowlist — the bucket must permit the current origin (dev:
        // localhost, prod: vercel domain). See scripts/diagnose-r2.mjs and the
        // CORS section in r2_setup_gotchas. A CORS rejection surfaces here as
        // a TypeError, NOT a non-200 response, and lands in the catch below.
        const resp = await fetch(audioUrl, { signal: controller.signal });
        if (!resp.ok) throw new Error(`fetch ${audioUrl} ${resp.status}`);
        const buf = await resp.arrayBuffer();
        if (cancelled) return;

        // OfflineAudioContext is widely supported. AudioContext with sampleRate
        // can also decode, but OAC doesn't require user gesture (Web Audio
        // autoplay policy) and we don't need playback graph wiring here.
        const Ctx =
          typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
        if (!Ctx) throw new Error('OfflineAudioContext unavailable');
        const ctx = new Ctx(1, 1, 44100);
        const audioBuffer = await ctx.decodeAudioData(buf);
        if (cancelled) return;
        const samples = audioBuffer.getChannelData(0);

        worker = createWorker();
        const result = await new Promise<WaveformPeaks>((resolve, reject) => {
          if (!worker) {
            reject(new Error('worker init failed'));
            return;
          }
          worker.onmessage = (e: MessageEvent) => {
            const msg = e.data as { type: 'peaks'; payload: WaveformPeaks } | { type: 'error'; message: string };
            if (msg.type === 'peaks') resolve(msg.payload);
            else reject(new Error(msg.message));
          };
          worker.postMessage({ type: 'downsample', data: samples, targetCols });
        });
        if (cancelled) return;

        cache.set(mediaId, { peaks: result, targetCols });
        setPeaks(result);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return; // unmount or change
        // Main-thread fallback when worker fails — rare; keeps the UI populated.
        // eslint-disable-next-line no-console
        console.warn('[useWaveformPeaks] worker path failed:', err);
        setStatus('error');
        setPeaks(null);
      } finally {
        worker?.terminate();
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      worker?.terminate();
    };
  }, [mediaId, audioUrl, targetCols, createWorker]);

  return { peaks, status };
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `npm test -- hooks/useWaveformPeaks --run`
Expected: 5 tests green.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/hooks/useWaveformPeaks.ts tests/unit/hooks/useWaveformPeaks.test.tsx
git commit -m "feat(hooks): useWaveformPeaks with cache + worker pipeline"
```

---

## Task 12: Wire Waveform into Timeline

**Files:**
- Modify: `components/Workspace/Timeline/Waveform.tsx`
- Modify: `components/Workspace/Timeline/index.tsx`
- Modify: `tests/unit/components/Timeline/Waveform.test.tsx`

> `<Waveform>` switches to the worker's tuple format. The Timeline component reads the active audio clip's URL via `useAppStore`, calls `useWaveformPeaks`, and overlays the SVG above the ruler/tracks area.
>
> **Breaking API change confirmed safe:** Plan 5's `Waveform.tsx` exported `{ min: Float32Array; max: Float32Array }` as its props shape — but no caller actually fed it peaks (the worker was wired up but no hook bridged it). Before changing the signature, grep for any leftover Plan-5 caller importing the old shape:
>
> ```bash
> grep -rn "Waveform" components/ --include="*.tsx" | grep -v "Waveform.tsx\|Waveform.test"
> ```
>
> If the only matches are the new mount in `Timeline/index.tsx` (this task) and the test file, the rewrite is clean.

- [ ] **Step 1: Rewrite `components/Workspace/Timeline/Waveform.tsx`**

```tsx
'use client';
import type { WaveformPeaks } from '@/lib/audio/peaks';

export function Waveform({
  peaks,
  width = 800,
  height = 32
}: {
  peaks: WaveformPeaks | null;
  width?: number;
  height?: number;
}) {
  if (!peaks || peaks.length === 0) return null;
  const n = peaks.length;
  const stepX = width / n;
  const mid = height / 2;
  // Build a closed shape from min-line then back along the max-line.
  const top = peaks.map(([_min, max], i) => `${i * stepX},${mid - max * mid}`);
  const bot = [...peaks]
    .reverse()
    .map(([min, _max], j) => `${(n - 1 - j) * stepX},${mid - min * mid}`);
  const d = `M ${top.join(' L ')} L ${bot.join(' L ')} Z`;
  return (
    <svg width={width} height={height} className="block" aria-label="audio waveform">
      <path d={d} fill="var(--a2)" opacity={0.5} />
    </svg>
  );
}
```

- [ ] **Step 2: Update the existing Waveform test for the new tuple format**

Open `tests/unit/components/Timeline/Waveform.test.tsx` and replace its body with:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Waveform } from '@/components/Workspace/Timeline/Waveform';

describe('Waveform', () => {
  it('renders nothing when peaks is null', () => {
    const { container } = render(<Waveform peaks={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when peaks is empty', () => {
    const { container } = render(<Waveform peaks={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a path with M…L commands from peaks', () => {
    const { container } = render(
      <Waveform peaks={[[-0.5, 0.5], [-0.3, 0.3]]} width={100} height={50} />
    );
    const path = container.querySelector('path');
    expect(path?.getAttribute('d')).toMatch(/^M /);
    expect(path?.getAttribute('d')).toMatch(/L /);
  });
});
```

- [ ] **Step 3: Modify `components/Workspace/Timeline/index.tsx` to mount the waveform**

```tsx
'use client';
import { useMemo } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAppStore } from '@/lib/store';
import { computeTotalBeats } from '@/lib/timeline/total-beats';
import { useWaveformPeaks } from '@/lib/hooks/useWaveformPeaks';
import { Toolbar } from './Toolbar';
import { Ruler } from './Ruler';
import { Tracks } from './Tracks';
import { Playhead } from './Playhead';
import { Waveform } from './Waveform';
import type { AudioEngine } from '@/lib/audio/engine';

const BEAT_PX_BASE = 40;

export function Timeline({ engine }: { engine: AudioEngine | null }) {
  const clips = useAppStore((s) => s.timeline.clips);
  const audioRefs = useAppStore((s) => s.media.mediaRefs);
  const bpm = useAppStore((s) => s.audio.grid.bpm);
  const zoom = useAppStore((s) => s.ui.zoom);
  const totalBeats = useMemo(() => {
    const lastAudio = [...audioRefs].reverse().find((m) => m.kind === 'audio' && m.duration);
    return computeTotalBeats(clips, lastAudio?.duration, bpm);
  }, [clips, audioRefs, bpm]);

  // First audio ref wins — multi-audio is v0.2.
  const activeAudio = audioRefs.find((m) => m.kind === 'audio' && m.url);
  const { peaks } = useWaveformPeaks({
    mediaId: activeAudio?.id ?? null,
    audioUrl: activeAudio?.url ?? null,
    targetCols: Math.min(2048, Math.floor(totalBeats * BEAT_PX_BASE * zoom))
  });

  const pxPerBeat = BEAT_PX_BASE * zoom;

  return (
    <ErrorBoundary name="Timeline">
      <div className="h-full flex flex-col">
        <Toolbar />
        <div className="flex-1 overflow-auto relative">
          <Ruler totalBeats={totalBeats} />
          {peaks && (
            <div
              className="absolute pointer-events-none"
              style={{ left: 80 /* TRACK_LABEL_WIDTH */, top: 24 /* below Ruler */ }}
            >
              <Waveform peaks={peaks} width={totalBeats * pxPerBeat} height={32} />
            </div>
          )}
          <Tracks totalBeats={totalBeats} />
          <Playhead engine={engine} totalBeats={totalBeats} />
        </div>
      </div>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `npm test -- Timeline/Waveform Timeline --run`
Expected: existing Timeline tests + 3 Waveform tests green. The Timeline test may need to mock `useWaveformPeaks` if it now throws under jsdom — if so, add at the top of the test file:

```ts
vi.mock('@/lib/hooks/useWaveformPeaks', () => ({
  useWaveformPeaks: () => ({ peaks: null, status: 'idle' })
}));
```

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/Workspace/Timeline/Waveform.tsx components/Workspace/Timeline/index.tsx \
        tests/unit/components/Timeline/Waveform.test.tsx
git commit -m "feat(timeline): mount waveform overlay via useWaveformPeaks"
```

---

## Task 13: Cleanup expandedAutomationClipId on clip removal + selection change

**Files:**
- Modify: `lib/store/timeline-slice.ts` (`removeClip` cleanup)
- Modify: `lib/store/index.ts` (`setSelectedClipId` cleanup — this action lives inline at the top level, NOT inside the timeline slice)
- Modify: `tests/unit/store/ui-state-automation.test.ts` (extend with cleanup tests)

> Two cleanup paths so the lane never refers to a deleted or unselected clip:
> 1. When `removeClip(id)` runs and `id === expandedAutomationClipId`, clear the UI field.
> 2. When `setSelectedClipId(newId)` runs and it differs from the previously expanded clip, clear the UI field.

> Implementation note: `setSelectedClipId` is declared INLINE in `lib/store/index.ts` (around line 14), not in a slice file. `removeClip` is in `lib/store/timeline-slice.ts`. Both are top-level methods on the store.

- [ ] **Step 1: Write the failing test (extend `tests/unit/store/ui-state-automation.test.ts`)**

Append:

```ts
describe('expandedAutomationClipId cleanup', () => {
  beforeEach(() => {
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: [
          {
            id: 'clip-x',
            trackId: 'track-pulse',
            kind: 'pulse',
            fxId: 'pulse',
            startBeat: 0,
            lengthBeats: 4,
            label: 'X'
          }
        ]
      },
      ui: { zoom: s.ui.zoom, selectedClipId: 'clip-x', expandedAutomationClipId: 'clip-x' }
    }));
  });

  it('removing the expanded clip clears expandedAutomationClipId', () => {
    useAppStore.getState().timelineActions.removeClip('clip-x');
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBeNull();
  });

  it('selecting a different clip clears expandedAutomationClipId', () => {
    useAppStore.getState().setSelectedClipId('clip-y');
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBeNull();
  });

  it('selecting the same clip keeps the lane open', () => {
    useAppStore.getState().setSelectedClipId('clip-x');
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBe('clip-x');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- store/ui-state-automation --run`

- [ ] **Step 3a: Wire cleanup in `lib/store/timeline-slice.ts`**

`removeClip` currently looks like:

```ts
removeClip: (clipId) => set({ timeline: ops.removeClip(get().timeline, clipId) }),
```

Replace with:

```ts
removeClip: (clipId) =>
  set((s) => ({
    timeline: ops.removeClip(s.timeline, clipId),
    ui:
      s.ui.expandedAutomationClipId === clipId
        ? { ...s.ui, expandedAutomationClipId: null }
        : s.ui
  })),
```

- [ ] **Step 3b: Wire cleanup in `lib/store/index.ts`**

`setSelectedClipId` is declared inline at the top level. Replace:

```ts
setSelectedClipId: (id) => set((s) => ({ ui: { ...s.ui, selectedClipId: id } })),
```

with:

```ts
setSelectedClipId: (id) =>
  set((s) => ({
    ui:
      id !== s.ui.expandedAutomationClipId
        ? { ...s.ui, selectedClipId: id, expandedAutomationClipId: null }
        : { ...s.ui, selectedClipId: id }
  })),
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `npm test -- store/ui-state-automation --run`
Expected: 6 tests green (3 original + 3 cleanup).

- [ ] **Step 5: Full suite — no regressions**

Run: `npm test -- --run`
Expected: ≥ 295 tests green.

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/store/timeline-slice.ts lib/store/index.ts \
        tests/unit/store/ui-state-automation.test.ts
git commit -m "fix(store): clear expandedAutomationClipId on clip remove + select change"
```

---

## Task 14: Zoom Pulse FX plugin (5th plugin)

**Files:**
- Create: `lib/fx/zoom-pulse.ts`
- Modify: `lib/fx/index.ts` (register the new plugin)
- Modify: `lib/timeline/types.ts` (extend `TrackKind`)
- Modify: `lib/renderer/types.ts` (extend `FxKind`)
- Modify: `lib/renderer/loop.ts` (`RENDER_ORDER`, `KIND_TO_TRACK_KIND`, the `Contour && !imageBitmap` guard)
- Modify: `components/Workspace/Timeline/Tracks.tsx` (`PLUGIN_TO_TRACK_KIND`)
- Modify: `components/Workspace/Timeline/Clip.tsx` (`KIND_COLOR`)
- Modify: `lib/store/timeline-slice.ts` (add the zoom-pulse track to `initialTimelineState.tracks`)
- Modify: `lib/store/index.ts` (bump persist `version: 2 → 3`, extend migration to `version < 3`)
- Create: `tests/unit/fx/zoom-pulse.test.ts`

> Zoom Pulse re-draws `rc.imageBitmap` on each beat with a centered scale transform. `intensity` (0–1) sets the peak zoom add; `decay` (0–1) sets the fade-back speed across `beatPhase`. The plugin only runs when an image is on stage and when `fade > 0` (skips redundant scale=1 redraws). Scope is intentionally surgical — the plugin sits in the renderer-loop's `RENDER_ORDER` and follows the same shape as Contour (which is the other plugin that reads `rc.imageBitmap`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/fx/zoom-pulse.test.ts
import { describe, it, expect } from 'vitest';
import { zoomPulsePlugin } from '@/lib/fx/zoom-pulse';
import { makeRenderContext } from './_helpers';

describe('zoomPulsePlugin', () => {
  it('has the correct plugin shape', () => {
    expect(zoomPulsePlugin.id).toBe('zoom-pulse');
    expect(zoomPulsePlugin.kind).toBe('ZoomPulse');
    expect(zoomPulsePlugin.defaultTrigger).toBe('beat');
    expect(zoomPulsePlugin.preloadState).toBe('ready');
    expect(zoomPulsePlugin.paramSchema.intensity.kind).toBe('slider');
    expect(zoomPulsePlugin.paramSchema.decay.kind).toBe('slider');
  });

  it('draws the image with a scale transform when imageBitmap + onBeat + intensity > 0', () => {
    const bitmap = { width: 400, height: 300 } as unknown as ImageBitmap;
    const rc = makeRenderContext({ isOnBeat: true, beatPhase: 0, width: 800, height: 450, imageBitmap: bitmap });
    zoomPulsePlugin.render(rc, { intensity: 0.5, decay: 0.5 });
    const calls = (rc.ctx as unknown as { __calls: Array<{ method: string; args: unknown[] }> }).__calls;
    const scale = calls.find((c) => c.method === 'scale');
    const draw = calls.find((c) => c.method === 'drawImage');
    expect(scale).toBeDefined();
    expect(scale!.args[0]).toBeGreaterThan(1); // zoomed
    expect(draw).toBeDefined();
  });

  it('does NOT draw when imageBitmap is missing', () => {
    const rc = makeRenderContext({ isOnBeat: true, beatPhase: 0, imageBitmap: undefined });
    zoomPulsePlugin.render(rc, { intensity: 0.5, decay: 0.5 });
    const calls = (rc.ctx as unknown as { __calls: Array<{ method: string }> }).__calls;
    expect(calls.find((c) => c.method === 'drawImage')).toBeUndefined();
  });

  it('higher intensity → larger scale factor', () => {
    const bitmap = { width: 400, height: 300 } as unknown as ImageBitmap;
    const rcLow = makeRenderContext({ isOnBeat: true, beatPhase: 0, imageBitmap: bitmap });
    const rcHigh = makeRenderContext({ isOnBeat: true, beatPhase: 0, imageBitmap: bitmap });
    zoomPulsePlugin.render(rcLow, { intensity: 0.2, decay: 0.5 });
    zoomPulsePlugin.render(rcHigh, { intensity: 0.8, decay: 0.5 });
    const scaleLow = (rcLow.ctx as unknown as { __calls: Array<{ method: string; args: unknown[] }> })
      .__calls.find((c) => c.method === 'scale');
    const scaleHigh = (rcHigh.ctx as unknown as { __calls: Array<{ method: string; args: unknown[] }> })
      .__calls.find((c) => c.method === 'scale');
    expect((scaleHigh!.args[0] as number) > (scaleLow!.args[0] as number)).toBe(true);
  });

  it('ctx.save and ctx.restore are balanced', () => {
    const bitmap = { width: 400, height: 300 } as unknown as ImageBitmap;
    const rc = makeRenderContext({ isOnBeat: true, beatPhase: 0, imageBitmap: bitmap });
    zoomPulsePlugin.render(rc, { intensity: 0.5, decay: 0.5 });
    const calls = (rc.ctx as unknown as { __calls: Array<{ method: string }> }).__calls;
    const saves = calls.filter((c) => c.method === 'save').length;
    const restores = calls.filter((c) => c.method === 'restore').length;
    expect(saves).toBe(restores);
    expect(saves).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail (module not found)**

Run: `npm test -- fx/zoom-pulse --run`

- [ ] **Step 3: Extend the renderer `FxKind` union**

In `lib/renderer/types.ts`:

```ts
export type FxKind = 'Contour' | 'Pulse' | 'Sweep' | 'Particle' | 'ZoomPulse';
```

In `lib/timeline/types.ts`:

```ts
export type TrackKind = 'image' | 'contour' | 'sweep' | 'pulse' | 'particles' | 'zoom-pulse';
```

(`FxKind` in `lib/timeline/types.ts` is `Exclude<TrackKind, 'image'>`, so it picks up `'zoom-pulse'` automatically.)

- [ ] **Step 4: Implement `lib/fx/zoom-pulse.ts`**

```ts
import type { FxPlugin } from '@/lib/renderer/types';

interface ZoomPulseParams {
  intensity: number;
  decay: number;
}

/**
 * Re-draws the active image bitmap with a centered scale transform that peaks
 * on each beat (`beatPhase = 0`) and fades back to 1.0 across the beat.
 * `decay` controls how steep the fade is. Skips rendering entirely when the
 * scale would be exactly 1.0 — avoids a redundant overlay of the same image.
 */
export const zoomPulsePlugin: FxPlugin<ZoomPulseParams> = {
  id: 'zoom-pulse',
  name: 'Zoom Pulse',
  kind: 'ZoomPulse',
  defaultTrigger: 'beat',
  preloadState: 'ready',
  paramSchema: {
    intensity: {
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.3,
      label: 'Zoom intensity'
    },
    decay: {
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
      label: 'Decay'
    }
  },
  getDefaultParams: () => ({ intensity: 0.3, decay: 0.5 }),
  async preload() {
    // No preload step — preloadState stays 'ready'.
  },
  render(rc, params) {
    if (!rc.imageBitmap) return;
    // Fade: 1.0 on the beat, decaying to 0 across the rest. Higher `decay`
    // makes the fade steeper (returns to 1.0 faster).
    const fade = Math.max(0, 1 - rc.beatPhase * (1 + params.decay * 3));
    if (fade <= 0 || params.intensity <= 0) return;
    const scale = 1 + params.intensity * fade;
    if (scale === 1) return;

    const bm = rc.imageBitmap;
    rc.ctx.save();
    rc.ctx.translate(rc.width / 2, rc.height / 2);
    rc.ctx.scale(scale, scale);
    rc.ctx.translate(-rc.width / 2, -rc.height / 2);
    // Inline drawImage-cover math — keeps the plugin from importing the
    // renderer's private helper. Same math as drawImageCover in loop.ts.
    const cover = Math.max(rc.width / bm.width, rc.height / bm.height);
    const sw = bm.width * cover;
    const sh = bm.height * cover;
    const sx = (rc.width - sw) / 2;
    const sy = (rc.height - sh) / 2;
    rc.ctx.drawImage(bm, sx, sy, sw, sh);
    rc.ctx.restore();
  }
};
```

- [ ] **Step 5: Register the plugin in `lib/fx/index.ts`**

```ts
import { register, _resetRegistryForTests } from '@/lib/renderer/registry';
import { pulsePlugin } from './pulse';
import { sweepPlugin } from './sweep';
import { particlesPlugin } from './particles';
import { contourPlugin } from './contour';
import { zoomPulsePlugin } from './zoom-pulse';

let registered = false;

export function registerBuiltInPlugins(): void {
  if (registered) return;
  register(pulsePlugin);
  register(sweepPlugin);
  register(particlesPlugin);
  register(contourPlugin);
  register(zoomPulsePlugin);
  registered = true;
}

export function _resetBuiltInPluginsForTests(): void {
  _resetRegistryForTests();
  registered = false;
}
```

- [ ] **Step 6: Update the renderer loop**

In `lib/renderer/loop.ts`:

```ts
// Image transforms apply BEFORE overlay FX. Order: Contour (edge detection) →
// ZoomPulse (image scale punch) → Sweep → Particle → Pulse (flash overlay).
const RENDER_ORDER: FxKind[] = ['Contour', 'ZoomPulse', 'Sweep', 'Particle', 'Pulse'];

const KIND_TO_TRACK_KIND: Record<FxKind, TrackFxKind> = {
  Contour: 'contour',
  ZoomPulse: 'zoom-pulse',
  Pulse: 'pulse',
  Sweep: 'sweep',
  Particle: 'particles'
};
```

Extend the bitmap guard to include ZoomPulse (around the line `if (plugin.kind === 'Contour' && !imageBitmap) continue;`):

```ts
if ((plugin.kind === 'Contour' || plugin.kind === 'ZoomPulse') && !imageBitmap) continue;
```

- [ ] **Step 7: Update the Tracks/Clip lookups**

In `components/Workspace/Timeline/Tracks.tsx`:

```ts
const PLUGIN_TO_TRACK_KIND: Record<PluginFxKind, TrackKind> = {
  Contour: 'contour',
  Pulse: 'pulse',
  Sweep: 'sweep',
  Particle: 'particles',
  ZoomPulse: 'zoom-pulse'
};
```

In `components/Workspace/Timeline/Clip.tsx`:

```ts
const KIND_COLOR: Record<TrackKind, string> = {
  image: '#5a8fff',
  contour: '#a86bff',
  sweep: '#ff6b9d',
  particles: '#2ee0d0',
  pulse: '#ffd166',
  'zoom-pulse': '#ff9f43' // orange — distinct from the other five
};
```

- [ ] **Step 8: Add the default track in `lib/store/timeline-slice.ts`**

```ts
export const initialTimelineState: TimelineState = {
  tracks: [
    { id: 'track-image', kind: 'image', name: 'Image', muted: false, order: 0 },
    { id: 'track-contour', kind: 'contour', name: 'Contour', muted: false, order: 1 },
    { id: 'track-zoom-pulse', kind: 'zoom-pulse', name: 'Zoom Pulse', muted: false, order: 2 },
    { id: 'track-sweep', kind: 'sweep', name: 'Sweep', muted: false, order: 3 },
    { id: 'track-particles', kind: 'particles', name: 'Particles', muted: false, order: 4 },
    { id: 'track-pulse', kind: 'pulse', name: 'Pulse', muted: false, order: 5 }
  ],
  // ...rest unchanged
};
```

(The `order` values for sweep/particles/pulse shift by 1 to keep them contiguous. This is cosmetic — `order` only drives the visual stacking in the LayersList.)

- [ ] **Step 9: Bump the persist version + migration in `lib/store/index.ts`**

Change `version: 2` to `version: 3`. Extend the migration:

```ts
migrate: (persistedState, version) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = persistedState as any;
  // v1 → v2: ensure all default TrackKind tracks exist (Plan 5 fix).
  // v2 → v3: same merge re-runs after Plan 5.5 adds the zoom-pulse track.
  if (version < 3 && s?.timeline) {
    const existing: Track[] = Array.isArray(s.timeline.tracks) ? s.timeline.tracks : [];
    const existingKinds = new Set(existing.map((t) => t.kind));
    const missing = initialTimelineState.tracks.filter((t) => !existingKinds.has(t.kind));
    s.timeline.tracks = [...existing, ...missing].sort((a, b) => a.order - b.order);
  }
  return s;
},
```

- [ ] **Step 10: Run tests + verification**

```bash
npm test -- fx/zoom-pulse --run
npm test -- --run
npm run typecheck
npm run lint
```

Expected: 5 new zoom-pulse tests green; full suite passes; typecheck + lint clean. Failures here usually indicate a missed enum union member — grep `'Contour' | 'Pulse'` in the codebase for any spot that exhaustive-checks `FxKind` and add `'ZoomPulse'`.

- [ ] **Step 11: Commit**

```bash
git add lib/fx/zoom-pulse.ts lib/fx/index.ts \
        lib/timeline/types.ts lib/renderer/types.ts lib/renderer/loop.ts \
        components/Workspace/Timeline/Tracks.tsx components/Workspace/Timeline/Clip.tsx \
        lib/store/timeline-slice.ts lib/store/index.ts \
        tests/unit/fx/zoom-pulse.test.ts
git commit -m "feat(fx): add Zoom Pulse plugin with intensity + decay sliders"
```

---

## Task 15: Verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run full verification gate**

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Expected:
- typecheck: clean
- lint: clean
- test: ≥ 300 tests green (Plan 5 baseline 237 + automation/waveform ~58 + zoom-pulse 5)
- build: studio page bundle size within ~5% of Plan 5 baseline (~122 kB). Waveform worker emits its own chunk. No AWS SDK / Anthropic SDK in the client bundle.

- [ ] **Step 2: Verify worker chunk emission**

Inspect `.next/static/chunks/` after build for a file matching `waveform-worker.*.js`. If missing, the worker bundle didn't emit — investigate `lib/audio/worker-factory.ts` (do NOT add `{ type: 'module' }`; see Plan 2 notes).

```bash
ls .next/static/chunks/ | grep -i waveform || echo "MISSING — investigate worker emission"
```

- [ ] **Step 3: No commit. Move to the manual smoke gate.**

---

## Task 16: Manual smoke gate

**Files:** none (manual verification)

- [ ] **Step 1: Run dev server**

```bash
npm run dev
```

Open http://localhost:3000.

- [ ] **Step 2: Walk the smoke checklist (from the plan header)**

For each step, take a screenshot or note pass/fail:

1. Upload an audio file → waveform appears under the ruler within ~1 s.
2. Place a Pulse clip → select it in Inspector.
3. Click ⚡ next to "intensity" → "automated" badge appears, "Edit on timeline" link shows.
4. Click "Edit on timeline" → automation lane appears below the Pulse track row.
5. Click on the lane → a second point appears.
6. Drag the second point → curve updates live; value clamps to slider range.
7. Switch interpolation to "step" → curve becomes square; "easeIn" → quadratic; "easeOut" → mirror quadratic.
8. Hit play with two points (intensity 0 → 1 over 4 beats, linear) → pulse intensity grows visibly across beats.
9. Right-click an automation point → it disappears.
10. Click ⚡ again on intensity → curve collapses; static value preserved; lane closes (because no params are automated).
11. Delete the clip → lane is gone, no console errors.
12. Reload page → `expandedAutomationClipId` is null (not persisted); previously-automated curves on remaining clips ARE preserved (they live in `clip.params`, which IS persisted); the new `Zoom Pulse` track shows up in the LayersList after migration (v2 → v3).
13. Drag a Zoom Pulse FX from the FxLibrary onto the new Zoom Pulse track. Place an image on the image track. Hit play → on each beat the image briefly "punches" outward then settles back. Adjust `intensity` and `decay` sliders → see the effect change in real time.
14. ⚡-automate the Zoom Pulse `intensity` → add two points (0.0 at beat 0, 0.8 at beat 8) → playback shows zoom growing across the eight beats.

- [ ] **Step 3: If anything fails, file the issue, do NOT commit. Fix and re-run from Task 15.**

- [ ] **Step 4: When all 14 smoke items pass, no commit needed.**

> Plan 5.5 complete. The "final review" step is owned by CC #2 — see `docs/Tests/` for the QA prompt template.

---

## Risk + watchlist summary

| Risk | Where | Mitigation in this plan |
|---|---|---|
| StrictMode double-mount re-runs `useWaveformPeaks` fetch | `lib/hooks/useWaveformPeaks.ts` | Module-scoped `cache` Map survives unmount/remount; second mount finds the entry and skips fetch |
| Worker chunk fails to emit under Next.js webpack | `lib/audio/worker-factory.ts` (unchanged) | Task 15 Step 2 explicitly checks for the emitted chunk |
| Pointer event hijacking by dnd-kit on clip drag | `components/Workspace/Timeline/Tracks.tsx` | AutomationLane renders as a sibling DOM node INSIDE the existing `<DndContext>`, but dnd-kit only steals events from `useDraggable` elements (only `<Clip>` uses it). With `activationConstraint: { distance: 5 }` and stopPropagation on point-handle pointerdown, the lane's surface click + point drags both stay isolated. The smoke gate (Task 16) walks this path explicitly |
| Persisted v2 store gets the new zoom-pulse track via migration | `lib/store/index.ts` migrate | Task 14 Step 9 bumps `version: 2 → 3` and extends the `version < 3` branch to re-run the missing-kinds merge — existing users get the new track on next reload |
| Exhaustive switches on `FxKind` miss `'ZoomPulse'` | various | Task 14 Step 10 grep instruction; TS will also flag any `_exhaustive: never` site (e.g. `ParamControl.tsx`'s default case pattern) |
| jsdom returns zero `getBoundingClientRect` for SVG | tests for AutomationPoint + AutomationLane | Components use pointer-event deltas, not absolute coords from rects |
| `decodeAudioData` not available in jsdom | `tests/unit/hooks/useWaveformPeaks.test.tsx` | Test stubs `globalThis.OfflineAudioContext` |
| `selectedClipId` mismatch with `expandedAutomationClipId` after Inspector edits | `lib/store/index.ts` `setSelectedClipId` | Task 13 wires the cleanup |
| Color/select/toggle params get an "Automate" button | `components/Workspace/Inspector/index.tsx` | Inspector renders the button only when `schema.kind === 'slider'` |
| Persisted automation curves from a previous session collide with new `Interpolation` values | `lib/automation/resolve.ts` | Unknown / missing `interpolation` falls through to step (safe default) — Task 1 covers this with a dedicated test |

## Out-of-plan items deferred to Plan 6

- Responsive layout (Spec §9.5: 2-col / stacked breakpoints, MobileTabBar wiring).
- Beat-snap on automation lane click (use `timeline.snap` to round to nearest beat / bar).
- Color and select param automation lanes (data model already supports it).
- Persisted `expandedAutomationClipId`.
- Worker code-splitting for the waveform worker.

Plan 5.5 ends; Plan 6 (Export Pipeline) starts on a clean baseline.
