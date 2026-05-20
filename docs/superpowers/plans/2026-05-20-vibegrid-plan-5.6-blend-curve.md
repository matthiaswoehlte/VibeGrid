# VibeGrid Plan 5.6 — Blend Curve Transitions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project execution policy (overrides skill defaults):** direct-on-main, sequential, one commit per task. Final review (CC #2) at the end — no per-task subagent ceremony.

**Goal:** Two clips on the same track that overlap in beat range produce a smooth crossfade. Each clip carries a reserved `__blend` AutomationCurve that drives its incoming transition; the outgoing clip's alpha is the complement. The user picks the curve shape (`linear | easeIn | easeOut`) from a new "Transition" section in the Inspector that only appears when the selected clip has an overlap. Reuses every piece of the automation infrastructure from Plan 5.5 — no new curve math, no new resolver.

**Architecture:** Four additive layers on top of Plan 5.5.

1. **Operations relaxation.** `lib/timeline/operations.ts` no longer throws `OperationError('OVERLAP', …)`. Same-track clips MAY share beat ranges. Existing OVERLAP-throw tests are updated to assert the new "overlap allowed" semantics.
2. **Pure overlap helpers.** New module `lib/timeline/overlap.ts` exposes `findIncomingOverlap(state, clipId)` (returns the preceding clip on the same track whose tail intersects this clip's head, or `null`) and `overlapRange(a, b)` (returns `[start, end]` of the half-open intersection).
3. **Reserved `__blend` param + auto-lifecycle.** Each Clip can carry `params['__blend']: AutomationCurve<number>` representing the incoming-side crossfade. The timeline slice's `addClip` / `moveClip` / `resizeClip` actions run a post-write step that walks affected clips and regenerates their `__blend` to match the current overlap (preserving any user-chosen interpolation mode). Pure helper `makeDefaultBlend(overlapStart, overlapEnd, interpolation)` builds the two-point linear-default curve. Any param key starting with `__` is reserved for internal use and never surfaces in the regular Inspector controls or the AutomationLane.
4. **Renderer integration.** `lib/renderer/loop.ts` wraps each rendered clip in a `ctx.save() / globalAlpha *= α / ctx.restore()` envelope, where `α` is derived from the clip's `__blend` resolved at the current beat (incoming side) and from the next-incoming-clip's `__blend` (outgoing side). Image-clip draws and FX `plugin.render(...)` calls both go through this envelope.
5. **Inspector "Transition" section.** New component `components/Workspace/Inspector/TransitionSection.tsx` renders ONLY when `findIncomingOverlap(timeline, clip.id)` returns a clip. It shows a single `<select>` for the interpolation mode and dispatches `setBlendInterpolation(clipId, mode)`. The normal param list and the AutomationLane both filter out keys starting with `__`.

**Tech Stack:** existing — Zustand store, automation primitives from Plan 5.5, renderer. No new dependencies.

**Spec reference:** Plan 5.5 review §OQ8 introduced the multi-mode `Interpolation` union. Plan 1 originally specified non-overlapping clips on the same track; Plan 5.6 supersedes that constraint for the transition use case.

**Verification gate (must pass before Plan 6 starts):**

```
npm test -- timeline/overlap          # ≥ 9 (5 findIncomingOverlap + 3 overlapRange + 1 isReservedParamKey)
npm test -- timeline/operations       # existing tests updated for overlap-allowed semantics
npm test -- store/blend-lifecycle     # ≥ 6 (default applied on add, range tracks on move/resize, interpolation preserved, no-blend when no overlap, regenerate on adjacent change, cleanup on neighbor removal)
npm test -- renderer/blend            # ≥ 4 (alpha=1 outside overlap, alpha=resolveParam during overlap, complement on outgoing, image+FX clips both apply alpha)
npm test -- components/Inspector      # existing 10 + 3 Transition section = ≥ 13
npm test                              # full suite ≥ 325 (Plan 5.5 final = 309; ~16 new)
npm run typecheck
npm run lint
npm run build
```

**Smoke gate (manual, before declaring Plan 5.6 done):**

```
npm run dev
# - Place a Pulse clip from beat 0 to beat 8.
# - Place a second Pulse clip on the same track from beat 6 to beat 14 (overlapping the first by 2 beats).
#   Expect: drop succeeds (no toast error about OVERLAP).
# - Select the second clip → Inspector shows a new "Transition" section with a curve-mode select (linear).
# - Hit play. Around beat 6 → 8: the first Pulse fades out while the second fades in.
# - Switch Transition mode to "easeIn" → the second clip's fade-in starts slow and snaps quickly to full near beat 8.
# - Switch to "easeOut" → opposite shape.
# - Move the second clip so it starts at beat 7 → fade range adjusts automatically; Transition still says easeOut (preserved).
# - Move the second clip so it no longer overlaps → Inspector hides the Transition section.
# - Repeat with two image clips overlapping → image crossfade visible on the canvas.
```

**Dependencies on prior plans:** Plan 5.5 (Interpolation enum, `resolveParam`, isAutomationCurve, makeCurve). Plan 3 (renderer loop). Plan 1 (timeline operations + selectors).

**Out of scope (Plan 6 or v0.2):**

- 3-clip chain overlaps with simultaneous incoming AND outgoing alpha multiplication beyond v0.1's "first incoming wins" rule (the implementation handles this correctly via per-clip __blend but the UI never exposes it).
- Editable blend curve POINTS in the AutomationLane — `__blend` is interpolation-mode-only.
- Blend across DIFFERENT tracks (image-to-FX transitions, etc.).
- Snap-to-bar for the overlap boundary.

---

## File map

### Pure helpers (no React, no I/O)

| File | Purpose |
|---|---|
| `lib/timeline/overlap.ts` (create) | `findIncomingOverlap(state, clipId)`, `overlapRange(a, b)`, `RESERVED_PARAM_PREFIX = '__'`, `isReservedParamKey(key)` |
| `lib/timeline/blend.ts` (create) | `makeDefaultBlend(overlapStart, overlapEnd, interpolation)` returns an `AutomationCurve<number>` with two points (0→1 across the range), `BLEND_KEY = '__blend'` |
| `lib/timeline/operations.ts` (modify) | Drop OVERLAP throws in `addClip` / `moveClip` / `resizeClip`. Overlap is now a legal state |

### Store

| File | Purpose |
|---|---|
| `lib/store/types.ts` (modify) | Add `setBlendInterpolation(clipId: string, interpolation: Interpolation): void` to `TimelineActions` |
| `lib/store/timeline-slice.ts` (modify) | After every add/move/resize, walk the affected track's clips and regenerate `__blend` via `regenerateBlendsForTrack(state, trackId)` (new pure helper). Implement `setBlendInterpolation` |
| `lib/timeline/blend-lifecycle.ts` (create) | Pure `regenerateBlendsForTrack(state, trackId)` — for each clip on the track, set/clear `params.__blend` based on whether an incoming overlap exists; preserve previously-set interpolation when regenerating |

### Renderer

| File | Purpose |
|---|---|
| `lib/renderer/blend.ts` (create) | `computeClipAlpha(state, clip, beats)` — looks at clip's `__blend` (incoming) and the next-clip's `__blend` (outgoing), returns the final alpha for THIS clip at `beats`. Pure; renderer-friendly |
| `lib/renderer/loop.ts` (modify) | In the image-clip draw block AND inside the FX kind loop, wrap each render in `ctx.save() / globalAlpha *= computeClipAlpha(...) / ctx.restore()` when alpha < 1 |
| `lib/fx/pulse.ts` (modify) | Change `ctx.globalAlpha = decay * params.intensity` → `ctx.globalAlpha *= decay * params.intensity` so the outer crossfade alpha cascades multiplicatively |
| `lib/fx/sweep.ts` (modify) | Same fix: `ctx.globalAlpha = 0.5` → `ctx.globalAlpha *= 0.5` |
| `lib/fx/particles.ts` (modify) | Capture outer alpha once before the per-particle loop, then write `ctx.globalAlpha = baseAlpha * (1 - lifeT)` per particle. A naive `*=` inside the loop would compound across particles |

### Components

| File | Purpose |
|---|---|
| `components/Workspace/Inspector/TransitionSection.tsx` (create) | Renders only when the clip has an incoming overlap. Single `<select>` for interpolation mode. Dispatches `setBlendInterpolation` |
| `components/Workspace/Inspector/index.tsx` (modify) | Filter out params with keys starting with `__` from the main loop. Render `<TransitionSection clipId={clip.id} />` below the param list |
| `components/Workspace/Timeline/AutomationLane.tsx` (modify) | Filter out params with keys starting with `__` when listing automated params (the AutomationLane only edits user-facing automation) |

### Tests (≥ 21 new)

| File | Tests |
|---|---|
| `tests/unit/timeline/overlap.test.ts` (create) | ≥ 8: findIncomingOverlap returns null when no preceding clip, returns the preceding clip when ranges intersect, returns null when ranges are exactly adjacent (half-open), returns null across different tracks, picks the CLOSEST preceding clip if multiple; overlapRange computes intersection, returns null when ranges don't intersect, half-open semantics for adjacent ranges |
| `tests/unit/timeline/blend.test.ts` (create) | ≥ 4: makeDefaultBlend builds a two-point curve from 0 to 1 across the given range, default interpolation is 'linear', accepts a custom interpolation mode, points are at the exact range boundaries |
| `tests/unit/timeline/operations.test.ts` (update) | Replace 3 `OVERLAP throws` assertions with `overlap allowed` assertions: addClip/moveClip/resizeClip return a valid state even when ranges intersect on the same track. Same-clipId self-overlap (e.g. resize to longer) is still allowed |
| `tests/unit/store/blend-lifecycle.test.ts` (create) | ≥ 6: adding a clip that overlaps an existing clip auto-creates a default __blend on the incoming clip; moving a clip into an overlap creates __blend; moving out of overlap clears __blend; previously-set interpolation survives a range change; resizing a neighbor regenerates the overlapping clip's __blend; removing the preceding clip clears the incoming __blend |
| `tests/unit/renderer/blend.test.ts` (create) | ≥ 4: computeClipAlpha returns 1 when no overlap touches this clip at the beat, returns the __blend value during incoming overlap, returns 1 − next.__blend during outgoing overlap, multiplies incoming × (1 − outgoing) when both overlaps touch simultaneously (3-clip chain edge case) |
| `tests/unit/components/Inspector-transition.test.tsx` (create) | ≥ 3: TransitionSection does NOT render when the selected clip has no incoming overlap; renders a select with the current interpolation; changing the select dispatches setBlendInterpolation |

---

## Conventions

- **Reserved-param prefix is `__`.** Keys starting with double-underscore are internal — never appear in the Inspector's main param list, never get an ⚡ button, never appear in the AutomationLane. Easy to extend later (`__crossfade`, `__transform`, etc.).
- **`__blend` is auto-managed.** The user never directly edits the points. Points are always computed from the current overlap range. The user only picks the interpolation mode via the Transition section. This keeps the data model simple — store actions own the curve, never the UI.
- **Interpolation is preserved across regeneration.** If the user picked `easeOut` and then moves the clip, the new `__blend` is regenerated with the same `easeOut` mode. Only the point beats change.
- **Half-open beat ranges.** `[startBeat, startBeat + lengthBeats)`. Two clips are "exactly adjacent" (no overlap) when `a.end === b.start`. Same convention as `hasOverlap` in the existing selectors.
- **Per-clip __blend governs INCOMING transition only.** The outgoing alpha is derived from the NEXT clip's `__blend`. This avoids needing two curves per clip and matches the user's design.
- **3-clip chain rule (out of scope but defined):** A clip in the MIDDLE of three overlapping clips has both an incoming and outgoing overlap. `computeClipAlpha` multiplies `incomingAlpha × (1 − outgoingAlpha)` in that case. The Inspector still only exposes the incoming side.
- **No e2e tests in this plan.** Memory: `tests/e2e/*` and `docs/Tests/*` are CC #2 territory.
- **One commit per task** with `type(scope): description`. Allowed scopes: `timeline`, `store`, `renderer`, `inspector`, `tests`, `chore`.

---

## Task 0: Baseline verification

**Files:** none

- [ ] **Step 1: Run the Plan 5.5 baseline**

```bash
npm test -- --run
npm run typecheck
npm run lint
```

Expected: 309 tests green (Plan 5.5 final), typecheck + lint clean. If lower, STOP.

No commit.

---

## Task 1: Pure overlap helpers

**Files:**
- Create: `lib/timeline/overlap.ts`
- Create: `tests/unit/timeline/overlap.test.ts`

> Pure helpers. Detect the preceding overlapping clip on the same track and compute the intersection beat range. Half-open semantics — exactly adjacent (end === start) does NOT count as overlap.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/timeline/overlap.test.ts
import { describe, it, expect } from 'vitest';
import { findIncomingOverlap, overlapRange, isReservedParamKey } from '@/lib/timeline/overlap';
import type { Clip, TimelineState } from '@/lib/timeline/types';

const baseState: TimelineState = {
  tracks: [{ id: 't-pulse', kind: 'pulse', name: 'P', muted: false, order: 0 }],
  clips: [],
  playhead: { beats: 0, playing: false },
  zoom: 1,
  snap: 'beat'
};

const clip = (id: string, trackId: string, startBeat: number, lengthBeats: number): Clip => ({
  id,
  trackId,
  kind: 'pulse',
  fxId: 'pulse',
  startBeat,
  lengthBeats,
  label: id
});

describe('findIncomingOverlap', () => {
  it('returns null when the clip has no preceding neighbor on the same track', () => {
    const state = { ...baseState, clips: [clip('a', 't-pulse', 0, 4)] };
    expect(findIncomingOverlap(state, 'a')).toBeNull();
  });

  it('returns the preceding clip when ranges intersect', () => {
    const state = {
      ...baseState,
      clips: [clip('a', 't-pulse', 0, 8), clip('b', 't-pulse', 6, 8)]
    };
    expect(findIncomingOverlap(state, 'b')?.id).toBe('a');
  });

  it('returns null when ranges are exactly adjacent (half-open)', () => {
    const state = {
      ...baseState,
      clips: [clip('a', 't-pulse', 0, 4), clip('b', 't-pulse', 4, 4)]
    };
    expect(findIncomingOverlap(state, 'b')).toBeNull();
  });

  it('ignores clips on different tracks', () => {
    const state: TimelineState = {
      ...baseState,
      tracks: [
        ...baseState.tracks,
        { id: 't-sweep', kind: 'sweep', name: 'S', muted: false, order: 1 }
      ],
      clips: [clip('a', 't-sweep', 0, 8), clip('b', 't-pulse', 4, 4)]
    };
    expect(findIncomingOverlap(state, 'b')).toBeNull();
  });

  it('picks the closest preceding clip when multiple precede', () => {
    const state = {
      ...baseState,
      clips: [
        clip('a', 't-pulse', 0, 10),
        clip('b', 't-pulse', 2, 6),
        clip('c', 't-pulse', 7, 4)
      ]
    };
    // c starts at 7 — b ends at 8, a ends at 10. Both intersect c. b is closer (later start).
    expect(findIncomingOverlap(state, 'c')?.id).toBe('b');
  });

  it('returns null for unknown clipId', () => {
    expect(findIncomingOverlap(baseState, 'nope')).toBeNull();
  });
});

describe('overlapRange', () => {
  it('computes the intersection of two intersecting ranges', () => {
    const a = clip('a', 't-pulse', 0, 8);
    const b = clip('b', 't-pulse', 6, 8);
    expect(overlapRange(a, b)).toEqual([6, 8]);
  });

  it('returns null when ranges do not intersect', () => {
    const a = clip('a', 't-pulse', 0, 4);
    const b = clip('b', 't-pulse', 10, 4);
    expect(overlapRange(a, b)).toBeNull();
  });

  it('returns null for exactly adjacent ranges (half-open)', () => {
    const a = clip('a', 't-pulse', 0, 4);
    const b = clip('b', 't-pulse', 4, 4);
    expect(overlapRange(a, b)).toBeNull();
  });
});

describe('isReservedParamKey', () => {
  it('detects __ prefix', () => {
    expect(isReservedParamKey('__blend')).toBe(true);
    expect(isReservedParamKey('intensity')).toBe(false);
    expect(isReservedParamKey('_private')).toBe(false); // single underscore is fine
  });
});
```

- [ ] **Step 2: Run, verify it fails (module not found)**

Run: `npm test -- timeline/overlap --run`

- [ ] **Step 3: Implement `lib/timeline/overlap.ts`**

```ts
import type { Clip, TimelineState } from './types';

export const RESERVED_PARAM_PREFIX = '__';

export function isReservedParamKey(key: string): boolean {
  return key.startsWith(RESERVED_PARAM_PREFIX);
}

/**
 * Return the clip on the same track whose tail intersects this clip's head,
 * or null when no such clip exists. Half-open ranges — exactly adjacent
 * (a.end === b.start) does NOT count as an overlap.
 *
 * When multiple preceding clips overlap, the CLOSEST one (latest startBeat)
 * wins — this matches the visual order the user sees.
 */
export function findIncomingOverlap(state: TimelineState, clipId: string): Clip | null {
  const clip = state.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  let best: Clip | null = null;
  for (const other of state.clips) {
    if (other.id === clip.id) continue;
    if (other.trackId !== clip.trackId) continue;
    if (other.startBeat >= clip.startBeat) continue; // not preceding
    const otherEnd = other.startBeat + other.lengthBeats;
    if (otherEnd <= clip.startBeat) continue; // adjacent or earlier — no overlap
    if (!best || other.startBeat > best.startBeat) best = other;
  }
  return best;
}

/**
 * Return [start, end] of the half-open intersection of two clips' beat ranges,
 * or null when they don't intersect. Both clips must be on the same track —
 * the caller is responsible for that check.
 */
export function overlapRange(a: Clip, b: Clip): [number, number] | null {
  const aEnd = a.startBeat + a.lengthBeats;
  const bEnd = b.startBeat + b.lengthBeats;
  const start = Math.max(a.startBeat, b.startBeat);
  const end = Math.min(aEnd, bEnd);
  if (start >= end) return null;
  return [start, end];
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `npm test -- timeline/overlap --run`
Expected: 9 tests green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add lib/timeline/overlap.ts tests/unit/timeline/overlap.test.ts
git commit -m "feat(timeline): pure overlap helpers (findIncomingOverlap, overlapRange)"
```

---

## Task 2: Default blend curve builder

**Files:**
- Create: `lib/timeline/blend.ts`
- Create: `tests/unit/timeline/blend.test.ts`

> The `__blend` curve is always a two-point linear ramp from 0 (start of overlap) to 1 (end of overlap). Helper builds it; the interpolation mode is configurable.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/timeline/blend.test.ts
import { describe, it, expect } from 'vitest';
import { makeDefaultBlend, BLEND_KEY } from '@/lib/timeline/blend';

describe('makeDefaultBlend', () => {
  it('builds a two-point curve from 0 to 1 across the given range', () => {
    const curve = makeDefaultBlend(6, 8);
    expect(curve.mode).toBe('automation');
    expect(curve.points).toEqual([
      { beat: 6, value: 0 },
      { beat: 8, value: 1 }
    ]);
  });

  it('defaults to linear interpolation', () => {
    expect(makeDefaultBlend(0, 4).interpolation).toBe('linear');
  });

  it('accepts a custom interpolation mode', () => {
    expect(makeDefaultBlend(0, 4, 'easeIn').interpolation).toBe('easeIn');
  });

  it('exposes the reserved key constant', () => {
    expect(BLEND_KEY).toBe('__blend');
  });
});
```

- [ ] **Step 2: Run, verify it fails (module not found)**

Run: `npm test -- timeline/blend --run`

- [ ] **Step 3: Implement `lib/timeline/blend.ts`**

```ts
import type { AutomationCurve, Interpolation } from '@/lib/automation/types';

export const BLEND_KEY = '__blend';

/**
 * Build a two-point `__blend` curve that ramps the incoming clip from 0 to 1
 * across the overlap range. The user can later change the interpolation via
 * the Inspector Transition section — points stay at the range boundaries.
 */
export function makeDefaultBlend(
  overlapStart: number,
  overlapEnd: number,
  interpolation: Interpolation = 'linear'
): AutomationCurve<number> {
  return {
    mode: 'automation',
    interpolation,
    points: [
      { beat: overlapStart, value: 0 },
      { beat: overlapEnd, value: 1 }
    ]
  };
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `npm test -- timeline/blend --run`
Expected: 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/timeline/blend.ts tests/unit/timeline/blend.test.ts
git commit -m "feat(timeline): makeDefaultBlend builder + BLEND_KEY constant"
```

---

## Task 3: Relax overlap-throws in operations

**Files:**
- Modify: `lib/timeline/operations.ts`
- Modify: `tests/unit/timeline/operations.test.ts`

> Three existing operations throw `OperationError('OVERLAP', …)`. Drop those throws — overlaps are now valid (the renderer treats them as transitions). The `hasOverlap` selector stays as-is; callers that still want to detect overlap can use it directly.

- [ ] **Step 1: Update existing operations tests**

`tests/unit/timeline/operations.test.ts` has five lines mentioning `OVERLAP` across FOUR tests (the constructor test contributes two lines) — grep first to confirm: `grep -n OVERLAP tests/unit/timeline/operations.test.ts`. Expected matches:

1. Line ~16: `const err = new OperationError('OVERLAP', 'Clip overlaps existing clip');` (constructor smoke test)
2. Line ~19: `expect(err.code).toBe('OVERLAP');` (same test as #1)
3. Line ~45: `it('throws OperationError(OVERLAP) when proposed clip intersects existing on same track', ...)`
4. Line ~100: `it('throws OVERLAP when the moved clip would collide ...', ...)`
5. Line ~152: `it('throws OVERLAP when the new length would extend ...', ...)`

For the constructor smoke test (#1-2): switch the sample code to one that's still in the union, e.g.:

```ts
const err = new OperationError('CLIP_NOT_FOUND', 'Clip not found');
// ...
expect(err.code).toBe('CLIP_NOT_FOUND');
```

For the three throws cases (#3-5): replace with overlap-allowed assertions. Example pattern:

```ts
// Before:
it('throws OVERLAP when adding to an occupied range', () => {
  const s1 = addClip(emptyState, { ... beat 0, length 4 });
  expect(() => addClip(s1, { ... beat 2, length 4 })).toThrow(/OVERLAP/);
});

// After:
it('allows adding a clip that overlaps an existing clip on the same track', () => {
  const s1 = addClip(emptyState, { ... beat 0, length 4 });
  const s2 = addClip(s1, { ... beat 2, length 4 });
  expect(s2.clips).toHaveLength(2);
  expect(s2.clips.map((c) => c.startBeat)).toEqual([0, 2]);
});
```

Repeat the same shape change for `moveClip` and `resizeClip`. If `Step 7 typecheck` still fails after this, grep again — there may be a `try { ... } catch (e: OperationError) { if (e.code === 'OVERLAP') ... }` pattern somewhere else (last check: `Tracks.tsx`'s drop handler catches but doesn't filter by code, so it's OK).

- [ ] **Step 2: Run tests, verify they fail (operations still throw)**

Run: `npm test -- timeline/operations --run`

- [ ] **Step 3: Drop the throws in `lib/timeline/operations.ts`**

Remove three `if (hasOverlap(...)) throw new OperationError('OVERLAP', ...)` blocks — one in `addClip`, `moveClip`, `resizeClip`. Keep the `CLIP_NOT_FOUND` / `TRACK_NOT_FOUND` / `INVALID_LENGTH` throws.

After the change, `addClip` becomes:

```ts
export function addClip(state: TimelineState, clip: Clip): TimelineState {
  return { ...state, clips: [...state.clips, clip] };
}
```

`moveClip` and `resizeClip` similarly lose their OVERLAP guard but keep their other validations.

Update the doc comment on each: remove the `@throws {OperationError} code=OVERLAP …` line.

- [ ] **Step 4: Drop `OVERLAP` from the OperationErrorCode union**

Currently:

```ts
export type OperationErrorCode =
  | 'OVERLAP'
  | 'CLIP_NOT_FOUND'
  | 'TRACK_NOT_FOUND'
  | 'INVALID_LENGTH';
```

Becomes:

```ts
export type OperationErrorCode = 'CLIP_NOT_FOUND' | 'TRACK_NOT_FOUND' | 'INVALID_LENGTH';
```

- [ ] **Step 5: Find any consumer still referencing the OVERLAP code**

```bash
grep -rn "OVERLAP" --include="*.ts" --include="*.tsx" .
```

Expect: only the test file and the operations file (now both updated). If `Tracks.tsx` or any other component catches `OVERLAP` specifically, update it to drop that branch — drops should just succeed silently.

The user-facing `Tracks.tsx` currently surfaces overlap errors via `toast.error('Drop failed: …')`. With the throw gone, that path simply won't trigger for overlaps — drops succeed. Leave the try/catch in place since other operation errors (CLIP_NOT_FOUND) can still surface.

- [ ] **Step 6: Run full test suite**

Run: `npm test -- --run`
Expected: full suite green, no test references stale `OVERLAP` behavior. Test count temporarily unchanged.

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npm run lint`

- [ ] **Step 8: Commit**

```bash
git add lib/timeline/operations.ts tests/unit/timeline/operations.test.ts
git commit -m "feat(timeline): allow same-track clip overlaps (transition prerequisite)"
```

---

## Task 4: Auto-blend lifecycle in the store

**Files:**
- Create: `lib/timeline/blend-lifecycle.ts`
- Modify: `lib/store/types.ts`
- Modify: `lib/store/timeline-slice.ts`
- Create: `tests/unit/store/blend-lifecycle.test.ts`

> Whenever a clip is added, moved, or resized, regenerate `__blend` for every clip on the affected track. Each clip's `__blend` reflects its CURRENT incoming overlap (if any). Previously-set interpolation is preserved.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/store/blend-lifecycle.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { isAutomationCurve } from '@/lib/automation/resolve';
import { BLEND_KEY } from '@/lib/timeline/blend';
import type { AutomationCurve } from '@/lib/automation/types';
import type { Clip } from '@/lib/timeline/types';

const mkClip = (id: string, start: number, length: number): Clip => ({
  id,
  trackId: 'track-pulse',
  kind: 'pulse',
  fxId: 'pulse',
  startBeat: start,
  lengthBeats: length,
  label: id
});

beforeEach(() => {
  useAppStore.setState((s) => ({
    timeline: { ...s.timeline, clips: [] }
  }));
});

describe('blend lifecycle — addClip', () => {
  it('adds a default __blend when the new clip overlaps an existing one', () => {
    useAppStore.getState().timelineActions.addClip(mkClip('a', 0, 8));
    useAppStore.getState().timelineActions.addClip(mkClip('b', 6, 8));
    const b = useAppStore.getState().timeline.clips.find((c) => c.id === 'b')!;
    const blend = b.params?.[BLEND_KEY];
    expect(isAutomationCurve(blend)).toBe(true);
    const curve = blend as AutomationCurve<number>;
    expect(curve.interpolation).toBe('linear');
    expect(curve.points).toEqual([
      { beat: 6, value: 0 },
      { beat: 8, value: 1 }
    ]);
  });

  it('does NOT add __blend when there is no overlap', () => {
    useAppStore.getState().timelineActions.addClip(mkClip('a', 0, 4));
    useAppStore.getState().timelineActions.addClip(mkClip('b', 8, 4));
    const b = useAppStore.getState().timeline.clips.find((c) => c.id === 'b')!;
    expect(b.params?.[BLEND_KEY]).toBeUndefined();
  });
});

describe('blend lifecycle — moveClip', () => {
  beforeEach(() => {
    useAppStore.getState().timelineActions.addClip(mkClip('a', 0, 8));
    useAppStore.getState().timelineActions.addClip(mkClip('b', 10, 4));
  });

  it('creates __blend when moving the clip into an overlap', () => {
    useAppStore.getState().timelineActions.moveClip('b', 6);
    const b = useAppStore.getState().timeline.clips.find((c) => c.id === 'b')!;
    expect(isAutomationCurve(b.params?.[BLEND_KEY])).toBe(true);
  });

  it('clears __blend when moving the clip out of overlap', () => {
    useAppStore.getState().timelineActions.moveClip('b', 6);
    useAppStore.getState().timelineActions.moveClip('b', 20);
    const b = useAppStore.getState().timeline.clips.find((c) => c.id === 'b')!;
    expect(b.params?.[BLEND_KEY]).toBeUndefined();
  });
});

describe('blend lifecycle — setBlendInterpolation + regenerate preservation', () => {
  beforeEach(() => {
    useAppStore.getState().timelineActions.addClip(mkClip('a', 0, 8));
    useAppStore.getState().timelineActions.addClip(mkClip('b', 6, 8));
    useAppStore.getState().timelineActions.setBlendInterpolation('b', 'easeOut');
  });

  it('preserves previously-set interpolation across a range change', () => {
    useAppStore.getState().timelineActions.moveClip('b', 5);
    const b = useAppStore.getState().timeline.clips.find((c) => c.id === 'b')!;
    const curve = b.params?.[BLEND_KEY] as AutomationCurve<number>;
    expect(curve.interpolation).toBe('easeOut');
    expect(curve.points[0].beat).toBe(5);
    expect(curve.points[1].beat).toBe(8);
  });
});

describe('blend lifecycle — removeClip', () => {
  it('clears the successor\'s __blend when the predecessor is removed', () => {
    useAppStore.getState().timelineActions.addClip(mkClip('a', 0, 8));
    useAppStore.getState().timelineActions.addClip(mkClip('b', 6, 4));
    useAppStore.getState().timelineActions.removeClip('a');
    const b = useAppStore.getState().timeline.clips.find((c) => c.id === 'b')!;
    expect(b.params?.[BLEND_KEY]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify they fail**

Run: `npm test -- store/blend-lifecycle --run`

- [ ] **Step 3: Implement `lib/timeline/blend-lifecycle.ts`**

```ts
import type { TimelineState, Clip } from './types';
import { findIncomingOverlap, overlapRange, isReservedParamKey } from './overlap';
import { makeDefaultBlend, BLEND_KEY } from './blend';
import { isAutomationCurve } from '@/lib/automation/resolve';
import type { AutomationCurve, Interpolation } from '@/lib/automation/types';

/**
 * For every clip on `trackId`, set or clear `params.__blend` to match the
 * current overlap state. Pure — returns a new state. Preserves each clip's
 * previously-chosen interpolation mode when re-generating the curve.
 *
 * Implementation note: we walk clip-by-clip rather than batch because each
 * clip's overlap is independent. The cost is O(N²) over clips on the track,
 * which is fine for the < 50 clips a typical v0.1 song will have.
 */
export function regenerateBlendsForTrack(
  state: TimelineState,
  trackId: string
): TimelineState {
  const nextClips = state.clips.map((c) => {
    if (c.trackId !== trackId) return c;
    const incoming = findIncomingOverlap(state, c.id);
    const existingParams = c.params ?? {};
    const existingBlend = existingParams[BLEND_KEY];
    const previousInterp =
      isAutomationCurve(existingBlend) && (existingBlend as AutomationCurve<number>).interpolation
        ? (existingBlend as AutomationCurve<number>).interpolation
        : ('linear' as Interpolation);

    if (!incoming) {
      // No incoming overlap — drop __blend if present.
      if (!(BLEND_KEY in existingParams)) return c;
      const nextParams: Record<string, unknown> = { ...existingParams };
      delete nextParams[BLEND_KEY];
      return { ...c, params: nextParams };
    }

    const range = overlapRange(incoming, c);
    if (!range) return c; // defensive — findIncomingOverlap implies a range exists
    const nextBlend = makeDefaultBlend(range[0], range[1], previousInterp);
    return { ...c, params: { ...existingParams, [BLEND_KEY]: nextBlend } };
  });

  return { ...state, clips: nextClips };
}

/** Re-export so callers can use the prefix for filtering. */
export { isReservedParamKey };
```

- [ ] **Step 4: Extend `lib/store/types.ts`**

Add to `TimelineActions`:

```ts
setBlendInterpolation(clipId: string, interpolation: Interpolation): void;
```

(`Interpolation` already imported in Plan 5.5.)

- [ ] **Step 5: Wire the lifecycle into `lib/store/timeline-slice.ts`**

Import the helper at the top:

```ts
import { regenerateBlendsForTrack } from '@/lib/timeline/blend-lifecycle';
import { BLEND_KEY } from '@/lib/timeline/blend';
import type { Interpolation } from '@/lib/automation/types';
```

Wrap `addClip`, `moveClip`, `resizeClip`, and `removeClip` so each runs `regenerateBlendsForTrack(nextState, trackId)` after the operation. The `trackId` is the clip's `trackId`. For `removeClip`, derive it from the original clip BEFORE removal.

```ts
addClip: (clip) => {
  const intermediate = ops.addClip(get().timeline, clip);
  set({ timeline: regenerateBlendsForTrack(intermediate, clip.trackId) });
},

moveClip: (clipId, newStartBeat) => {
  const current = get().timeline.clips.find((c) => c.id === clipId);
  if (!current) return;
  const intermediate = ops.moveClip(get().timeline, clipId, newStartBeat);
  set({ timeline: regenerateBlendsForTrack(intermediate, current.trackId) });
},

resizeClip: (clipId, newLengthBeats) => {
  const current = get().timeline.clips.find((c) => c.id === clipId);
  if (!current) return;
  const intermediate = ops.resizeClip(get().timeline, clipId, newLengthBeats);
  set({ timeline: regenerateBlendsForTrack(intermediate, current.trackId) });
},

removeClip: (clipId) => {
  const current = get().timeline.clips.find((c) => c.id === clipId);
  set((s) => {
    const intermediate = ops.removeClip(s.timeline, clipId);
    const regenerated = current
      ? regenerateBlendsForTrack(intermediate, current.trackId)
      : intermediate;
    return {
      timeline: regenerated,
      ui:
        s.ui.expandedAutomationClipId === clipId
          ? { ...s.ui, expandedAutomationClipId: null }
          : s.ui
    };
  });
},
```

> The expandedAutomationClipId cleanup from Plan 5.5 Task 13 stays in place — only the timeline section is wrapped.

Add `setBlendInterpolation` in the actions object:

```ts
setBlendInterpolation: (clipId, interpolation) => {
  set((s) => {
    const clips = s.timeline.clips.map((c) => {
      if (c.id !== clipId) return c;
      const blend = c.params?.[BLEND_KEY];
      if (!isAutomationCurve(blend)) return c;
      return {
        ...c,
        params: {
          ...c.params!,
          [BLEND_KEY]: { ...(blend as AutomationCurve<unknown>), interpolation }
        }
      };
    });
    return { timeline: { ...s.timeline, clips } };
  });
},
```

- [ ] **Step 6: Run tests, verify they pass**

Run: `npm test -- store/blend-lifecycle --run`
Expected: 6 tests green.

- [ ] **Step 7: Run full suite — no regressions**

Run: `npm test -- --run`
Expected: ≥ 320 tests green (309 + 9 overlap + 4 blend + 6 lifecycle = 328, minus any updated operations tests).

- [ ] **Step 8: Typecheck + lint**

Run: `npm run typecheck && npm run lint`

- [ ] **Step 9: Commit**

```bash
git add lib/timeline/blend-lifecycle.ts lib/store/types.ts lib/store/timeline-slice.ts \
        tests/unit/store/blend-lifecycle.test.ts
git commit -m "feat(store): auto-manage __blend on clip lifecycle changes"
```

---

## Task 5: Renderer integration — computeClipAlpha + wrap clip draws

**Files:**
- Create: `lib/renderer/blend.ts`
- Modify: `lib/renderer/loop.ts`
- Create: `tests/unit/renderer/blend.test.ts`

> `computeClipAlpha` is pure: it reads the clip's `__blend` for the incoming side and the NEXT clip's `__blend` for the outgoing side, then returns a final alpha. The renderer loop wraps each clip-render in a `ctx.save() / globalAlpha *= alpha / ctx.restore()` envelope when the alpha differs from 1.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/renderer/blend.test.ts
import { describe, it, expect } from 'vitest';
import { computeClipAlpha } from '@/lib/renderer/blend';
import { makeDefaultBlend, BLEND_KEY } from '@/lib/timeline/blend';
import type { Clip, TimelineState } from '@/lib/timeline/types';

const mkClip = (id: string, start: number, length: number, params?: Record<string, unknown>): Clip => ({
  id,
  trackId: 't-pulse',
  kind: 'pulse',
  fxId: 'pulse',
  startBeat: start,
  lengthBeats: length,
  label: id,
  params
});

const baseState = (clips: Clip[]): TimelineState => ({
  tracks: [{ id: 't-pulse', kind: 'pulse', name: 'P', muted: false, order: 0 }],
  clips,
  playhead: { beats: 0, playing: false },
  zoom: 1,
  snap: 'beat'
});

describe('computeClipAlpha', () => {
  it('returns 1 when no overlap touches the clip at this beat', () => {
    const a = mkClip('a', 0, 4);
    const b = mkClip('b', 10, 4);
    const state = baseState([a, b]);
    expect(computeClipAlpha(state, b, 11)).toBe(1);
  });

  it('returns the __blend value during the incoming overlap', () => {
    const a = mkClip('a', 0, 8);
    const b = mkClip('b', 6, 8, { [BLEND_KEY]: makeDefaultBlend(6, 8, 'linear') });
    const state = baseState([a, b]);
    // At beat 7: t = (7-6)/(8-6) = 0.5 → linear → 0.5
    expect(computeClipAlpha(state, b, 7)).toBeCloseTo(0.5, 5);
  });

  it('returns 1 - next.__blend during the outgoing overlap', () => {
    const a = mkClip('a', 0, 8);
    const b = mkClip('b', 6, 8, { [BLEND_KEY]: makeDefaultBlend(6, 8, 'linear') });
    const state = baseState([a, b]);
    // a is outgoing. At beat 7: b's blend = 0.5 → a's alpha = 1 - 0.5 = 0.5
    expect(computeClipAlpha(state, a, 7)).toBeCloseTo(0.5, 5);
  });

  it('multiplies incoming and outgoing alphas for a 3-clip chain middle', () => {
    const a = mkClip('a', 0, 8);
    const b = mkClip('b', 6, 6, { [BLEND_KEY]: makeDefaultBlend(6, 8, 'linear') });
    const c = mkClip('c', 10, 6, { [BLEND_KEY]: makeDefaultBlend(10, 12, 'linear') });
    const state = baseState([a, b, c]);
    // At beat 7: b is in incoming overlap with a (b.blend = 0.5)
    //            b is also active. c not active yet.
    // No outgoing overlap for b at beat 7. Alpha = 0.5
    expect(computeClipAlpha(state, b, 7)).toBeCloseTo(0.5, 5);
    // At beat 11: b in outgoing overlap with c (c.blend at 11 = 0.5)
    //             b's alpha = 1 - 0.5 = 0.5
    expect(computeClipAlpha(state, b, 11)).toBeCloseTo(0.5, 5);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm test -- renderer/blend --run`

- [ ] **Step 3: Implement `lib/renderer/blend.ts`**

```ts
import type { Clip, TimelineState } from '@/lib/timeline/types';
import { resolveParam, isAutomationCurve } from '@/lib/automation/resolve';
import { findIncomingOverlap } from '@/lib/timeline/overlap';
import { BLEND_KEY } from '@/lib/timeline/blend';
import type { AutomationCurve } from '@/lib/automation/types';

/**
 * Final alpha for `clip` at the given beat. Returns 1 when no overlap on
 * the same track touches this clip at this beat. Otherwise:
 *
 *   - If `clip` is in its OWN incoming overlap (preceded by another clip
 *     that hasn't ended yet), alpha = resolveParam(clip.__blend, beats).
 *   - If `clip` has a successor whose incoming overlap covers this beat,
 *     alpha multiplied by (1 - resolveParam(next.__blend, beats)).
 *
 * Both sides multiply for the 3-clip-chain middle. Outside any overlap,
 * alpha = 1.
 */
export function computeClipAlpha(state: TimelineState, clip: Clip, beats: number): number {
  let alpha = 1;

  // Incoming side: is this clip currently inside its own incoming overlap?
  const incoming = findIncomingOverlap(state, clip.id);
  if (incoming) {
    const overlapStart = clip.startBeat;
    const overlapEnd = incoming.startBeat + incoming.lengthBeats;
    if (beats >= overlapStart && beats < overlapEnd) {
      const blend = clip.params?.[BLEND_KEY];
      if (isAutomationCurve(blend)) {
        alpha *= resolveParam(blend as AutomationCurve<number>, beats);
      }
    }
  }

  // Outgoing side: is the NEXT clip's incoming overlap currently covering us?
  // The next clip is the one whose incoming overlap points to us.
  const next = state.clips.find((c) => {
    if (c.trackId !== clip.trackId) return false;
    if (c.id === clip.id) return false;
    const pre = findIncomingOverlap(state, c.id);
    return pre?.id === clip.id;
  });
  if (next) {
    const overlapStart = next.startBeat;
    const overlapEnd = clip.startBeat + clip.lengthBeats;
    if (beats >= overlapStart && beats < overlapEnd) {
      const blend = next.params?.[BLEND_KEY];
      if (isAutomationCurve(blend)) {
        alpha *= 1 - resolveParam(blend as AutomationCurve<number>, beats);
      }
    }
  }

  return alpha;
}
```

- [ ] **Step 4: Wire alpha into `lib/renderer/loop.ts`**

Import `computeClipAlpha`:

```ts
import { computeClipAlpha } from './blend';
```

Wrap the image-clip draw:

```ts
if (imageClip && imageBitmap) {
  const alpha = computeClipAlpha(timeline, imageClip, beats);
  if (alpha < 1) {
    ctx!.save();
    ctx!.globalAlpha *= alpha;
  }
  drawImageContain(ctx!, imageBitmap, w, h);
  if (alpha < 1) ctx!.restore();
}
```

Wrap each FX clip render inside the inner loop:

```ts
const alpha = computeClipAlpha(timeline, clip, beats);
const usesAlpha = alpha < 1;
if (usesAlpha) {
  ctx!.save();
  ctx!.globalAlpha *= alpha;
}
try {
  plugin.render(rc, resolveClipParams(rawParams, beats));
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn(`[renderer] plugin "${plugin.id}" render() threw:`, err);
}
if (usesAlpha) ctx!.restore();
```

> Replace the existing `try { plugin.render(...) } catch (...) {...}` block — keep the try/catch wrapping the render so a plugin throwing doesn't leave globalAlpha modified. The `ctx.restore()` runs after the catch.

Refinement: ensure `restore()` runs even when `render` throws. Use try/finally:

```ts
const alpha = computeClipAlpha(timeline, clip, beats);
const usesAlpha = alpha < 1;
if (usesAlpha) {
  ctx!.save();
  ctx!.globalAlpha *= alpha;
}
try {
  plugin.render(rc, resolveClipParams(rawParams, beats));
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn(`[renderer] plugin "${plugin.id}" render() threw:`, err);
} finally {
  if (usesAlpha) ctx!.restore();
}
```

- [ ] **Step 5: Patch the three FX plugins to compose globalAlpha multiplicatively**

The outer `globalAlpha *= alpha` set by the wrapper around `plugin.render(...)` would be **silently overwritten** by the plugins that currently assign globalAlpha directly. Without this patch, Pulse / Sweep / Particles clips never crossfade — the outer alpha is clobbered before the actual `fillRect` / `arc` runs.

Three edits:

**`lib/fx/pulse.ts`** — `render()`:

```ts
// Before
rc.ctx.globalAlpha = decay * params.intensity;
// After
rc.ctx.globalAlpha *= decay * params.intensity;
```

The `ctx.save()` two lines above already snapshots the outer globalAlpha. The `*=` multiplies on top of it. `ctx.restore()` pops back. Result: the actual fillRect runs at `outer * decay * intensity`.

**`lib/fx/sweep.ts`** — inside the orb loop:

```ts
// Before
rc.ctx.globalAlpha = 0.5;
// After
rc.ctx.globalAlpha *= 0.5;
```

Same logic: the `ctx.save()` at the top of each orb iteration captures the current globalAlpha; `*=` composes; `ctx.restore()` pops.

**`lib/fx/particles.ts`** — capture outer alpha BEFORE the loop, set per-particle as `baseAlpha * (1 - lifeT)`. The naive `*= (1 - lifeT)` would compound across particles since the loop shares one outer `ctx.save()`.

```ts
// Inside render():
rc.ctx.save();
const baseAlpha = rc.ctx.globalAlpha;
rc.ctx.fillStyle = params.color;
for (const p of pool) {
  if (!p.alive) continue;
  const age = rc.time - p.bornAt;
  if (age >= params.life) {
    p.alive = false;
    continue;
  }
  const dt = 1 / 60;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  const lifeT = age / params.life;
  rc.ctx.globalAlpha = baseAlpha * (1 - lifeT); // was: 1 - lifeT
  rc.ctx.beginPath();
  rc.ctx.arc(p.x, p.y, params.size, 0, Math.PI * 2);
  rc.ctx.fill();
}
rc.ctx.restore();
```

The existing pulse / sweep / particles unit tests check that `fillRect` / `arc` / `fill` calls happen — not the globalAlpha values — so they should remain green after this change.

- [ ] **Step 6: Run tests, verify they pass**

Run: `npm test -- renderer/blend fx/pulse fx/sweep fx/particles --run`
Expected: 4 new blend tests + all existing fx tests still green.

- [ ] **Step 7: Run full suite — no regressions**

Run: `npm test -- --run`

- [ ] **Step 8: Typecheck + lint**

Run: `npm run typecheck && npm run lint`

- [ ] **Step 9: Commit**

```bash
git add lib/renderer/blend.ts lib/renderer/loop.ts lib/fx/pulse.ts lib/fx/sweep.ts lib/fx/particles.ts \
        tests/unit/renderer/blend.test.ts
git commit -m "feat(renderer): apply __blend alpha to overlapping clip draws"
```

---

## Task 6: Hide reserved params from Inspector + AutomationLane

**Files:**
- Modify: `components/Workspace/Inspector/index.tsx`
- Modify: `components/Workspace/Timeline/AutomationLane.tsx`

> Keys with the `__` prefix are internal — they must not show up in the main param controls (they have no plugin paramSchema entry anyway, so they wouldn't render — but we ALSO need the AutomationLane filter to skip them defensively when they happen to be in clip.params alongside slider params).

- [ ] **Step 1: Modify the Inspector main loop guard**

In `components/Workspace/Inspector/index.tsx`, the existing main loop already iterates `plugin.paramSchema` entries, so `__blend` (which is NOT in any plugin's schema) never appears in the controls list. No change needed there.

But the "Edit on timeline" link visibility check is based on:

```tsx
{Object.values(params as Record<string, unknown>).some((v) => isAutomationCurve(v)) && (
  <div className="pt-1">
    <EditOnTimelineLink clipId={clip.id} />
  </div>
)}
```

This would light up even if the ONLY automation curve in `params` is `__blend`. We don't want that — `__blend` is not user-editable on the lane. Filter it out:

Add at the top of the file:

```tsx
import { isReservedParamKey } from '@/lib/timeline/overlap';
```

Replace the link visibility check:

```tsx
{Object.entries(params as Record<string, unknown>)
  .filter(([k]) => !isReservedParamKey(k))
  .some(([, v]) => isAutomationCurve(v)) && (
  <div className="pt-1">
    <EditOnTimelineLink clipId={clip.id} />
  </div>
)}
```

- [ ] **Step 2: Modify the AutomationLane filter**

In `components/Workspace/Timeline/AutomationLane.tsx`, the existing filter is:

```tsx
const automated = Object.entries(plugin.paramSchema).filter(([k, schema]) => {
  return schema.kind === 'slider' && isAutomationCurve(params[k]);
});
```

This already only looks at keys present in `plugin.paramSchema`. Since `__blend` is not in any schema, it's already excluded. No change required — but add a defensive filter to future-proof:

```tsx
const automated = Object.entries(plugin.paramSchema).filter(([k, schema]) => {
  if (isReservedParamKey(k)) return false;
  return schema.kind === 'slider' && isAutomationCurve(params[k]);
});
```

Import the helper at the top:

```ts
import { isReservedParamKey } from '@/lib/timeline/overlap';
```

- [ ] **Step 3: Run existing component tests**

Run: `npm test -- components/Inspector components/Timeline/AutomationLane --run`
Expected: all existing tests still green (no behavior change — `__blend` was already excluded by schema-key iteration).

- [ ] **Step 4: Commit**

```bash
git add components/Workspace/Inspector/index.tsx components/Workspace/Timeline/AutomationLane.tsx
git commit -m "chore(ui): defensive filter for reserved __ params in Inspector + AutomationLane"
```

---

## Task 7: Inspector Transition section

**Files:**
- Create: `components/Workspace/Inspector/TransitionSection.tsx`
- Modify: `components/Workspace/Inspector/index.tsx`
- Create: `tests/unit/components/Inspector-transition.test.tsx`

> The Transition section appears below the param list ONLY when `findIncomingOverlap(timeline, clip.id)` returns a clip. Single control: `<select>` for interpolation mode. Dispatches `setBlendInterpolation`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/Inspector-transition.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { Inspector } from '@/components/Workspace/Inspector';
import { _resetBuiltInPluginsForTests, registerBuiltInPlugins } from '@/lib/fx';
import { BLEND_KEY } from '@/lib/timeline/blend';
import type { AutomationCurve } from '@/lib/automation/types';

beforeEach(() => {
  _resetBuiltInPluginsForTests();
  registerBuiltInPlugins();
  useAppStore.setState((s) => ({
    timeline: { ...s.timeline, clips: [] }
  }));
});

const setupOverlap = () => {
  useAppStore.getState().timelineActions.addClip({
    id: 'a',
    trackId: 'track-pulse',
    kind: 'pulse',
    fxId: 'pulse',
    startBeat: 0,
    lengthBeats: 8,
    label: 'A'
  });
  useAppStore.getState().timelineActions.addClip({
    id: 'b',
    trackId: 'track-pulse',
    kind: 'pulse',
    fxId: 'pulse',
    startBeat: 6,
    lengthBeats: 8,
    label: 'B'
  });
  useAppStore.getState().setSelectedClipId('b');
};

describe('Inspector — Transition section', () => {
  it('does NOT render when the selected clip has no incoming overlap', () => {
    useAppStore.getState().timelineActions.addClip({
      id: 'solo',
      trackId: 'track-pulse',
      kind: 'pulse',
      fxId: 'pulse',
      startBeat: 0,
      lengthBeats: 4,
      label: 'Solo'
    });
    useAppStore.getState().setSelectedClipId('solo');
    render(<Inspector />);
    expect(screen.queryByText(/transition/i)).toBeNull();
  });

  it('renders the interpolation select reflecting the current __blend mode', () => {
    setupOverlap();
    render(<Inspector />);
    const select = screen.getByRole('combobox', { name: /transition curve/i }) as HTMLSelectElement;
    expect(select.value).toBe('linear');
  });

  it('changing the select dispatches setBlendInterpolation', () => {
    setupOverlap();
    render(<Inspector />);
    fireEvent.change(screen.getByRole('combobox', { name: /transition curve/i }), {
      target: { value: 'easeIn' }
    });
    const b = useAppStore.getState().timeline.clips.find((c) => c.id === 'b')!;
    const curve = b.params?.[BLEND_KEY] as AutomationCurve<number>;
    expect(curve.interpolation).toBe('easeIn');
  });
});
```

- [ ] **Step 2: Run, verify fails**

Run: `npm test -- components/Inspector-transition --run`

- [ ] **Step 3: Implement `components/Workspace/Inspector/TransitionSection.tsx`**

```tsx
'use client';
import { useAppStore } from '@/lib/store';
import { findIncomingOverlap } from '@/lib/timeline/overlap';
import { BLEND_KEY } from '@/lib/timeline/blend';
import { isAutomationCurve } from '@/lib/automation/resolve';
import type { AutomationCurve, Interpolation } from '@/lib/automation/types';

const MODES: Interpolation[] = ['linear', 'easeIn', 'easeOut'];

export function TransitionSection({ clipId }: { clipId: string }) {
  const timeline = useAppStore((s) => s.timeline);
  const setBlendInterpolation = useAppStore((s) => s.timelineActions.setBlendInterpolation);

  const incoming = findIncomingOverlap(timeline, clipId);
  if (!incoming) return null;

  const clip = timeline.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const blend = clip.params?.[BLEND_KEY];
  // __blend should be present (the lifecycle added it), but if it isn't yet
  // (e.g. a race during initial mount), don't crash — bail out.
  if (!isAutomationCurve(blend)) return null;

  const curve = blend as AutomationCurve<number>;

  return (
    <div className="border-t border-[var(--border)] mt-3 pt-2 px-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-1">
        Transition
      </div>
      <label className="block text-xs text-[var(--text-dim)]">
        Curve
        <select
          aria-label="Transition curve"
          className="ml-2 text-xs bg-[var(--surface-3)] text-[var(--text)] rounded px-1 py-0.5"
          value={curve.interpolation}
          onChange={(e) => setBlendInterpolation(clipId, e.target.value as Interpolation)}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Mount it in `components/Workspace/Inspector/index.tsx`**

Add import:

```tsx
import { TransitionSection } from './TransitionSection';
```

Below the param map block (and below the existing "Edit on timeline" block), insert:

```tsx
<TransitionSection clipId={clip.id} />
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npm test -- components/Inspector-transition --run`
Expected: 3 tests green.

- [ ] **Step 6: Run full suite — no regressions**

Run: `npm test -- --run`

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npm run lint`

- [ ] **Step 8: Commit**

```bash
git add components/Workspace/Inspector/TransitionSection.tsx components/Workspace/Inspector/index.tsx \
        tests/unit/components/Inspector-transition.test.tsx
git commit -m "feat(inspector): Transition section with curve-mode picker"
```

---

## Task 8: Verification gate

**Files:** none

- [ ] **Step 1: Run the full gate**

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Expected:
- typecheck: clean
- lint: clean
- test: ≥ 325 tests green (309 baseline + 9 overlap + 4 blend + 6 lifecycle + 4 renderer-blend + 3 transition = 335 minus operations OVERLAP-throw updates ≈ 332)
- build: within ~5% of Plan 5.5 baseline. Worker chunks still emit.

- [ ] **Step 2: No commit. Proceed to manual smoke.**

---

## Task 9: Manual smoke gate

**Files:** none

- [ ] **Step 1: Run dev server**

```bash
npm run dev
```

- [ ] **Step 2: Walk the smoke checklist (from the plan header)**

12 items in the smoke gate:

1. Pulse A on track from beat 0–8.
2. Pulse B on same track from beat 6–14 → drop succeeds (no toast error).
3. Select B → "Transition" section visible in Inspector with `linear` selected.
4. Hit play → crossfade visible on beats 6–8.
5. Switch to `easeIn` → fade-in starts slow, ramps up.
6. Switch to `easeOut` → fade-in starts fast, eases at end.
7. Move B so it starts at beat 7 → fade range shifts; Inspector still shows `easeOut`.
8. Move B to beat 20 (no overlap) → Inspector Transition section disappears.
9. Move B back to beat 6 → Transition section reappears with `easeOut` preserved.
10. Same flow with two image clips → image crossfade visible on canvas.
11. Delete the preceding clip → successor's Transition section disappears, no console errors.
12. Reload page → __blend curves persist (they live in clip.params which is persisted); Transition section re-appears on selection.

- [ ] **Step 3: If any item fails, fix + re-run from Task 8.**

> Plan 5.6 complete. CC #2 final review per the QA prompt in `docs/Tests/`.

---

## Risk + watchlist summary

| Risk | Where | Mitigation |
|---|---|---|
| Existing OVERLAP-throw assertions in tests break the suite | `tests/unit/timeline/operations.test.ts` | Task 3 explicitly updates them as part of the same commit that removes the throws |
| `Tracks.tsx` user-facing toast no longer fires for overlap | `components/Workspace/Timeline/Tracks.tsx` | Intentional — drops now succeed for overlapping clips. The try/catch stays in place for other op errors |
| Plugin throws while inside the alpha envelope leaves globalAlpha modified | `lib/renderer/loop.ts` | Task 5 uses try/finally to guarantee `ctx.restore()` |
| Plugins overwrite outer globalAlpha with `=` (not `*=`), silently breaking crossfade | `lib/fx/pulse.ts`, `lib/fx/sweep.ts`, `lib/fx/particles.ts` | Task 5 Step 5 explicitly patches all three to compose multiplicatively. Smoke gate item #4 (Pulse crossfade visible) is the visual canary |
| `__blend` curve has stale interpolation after a clip moves | `lib/timeline/blend-lifecycle.ts` | `regenerateBlendsForTrack` preserves the previously-set interpolation — Task 4 has a dedicated test |
| Persistence sees `__blend` as just another param key | `lib/store/index.ts` partialize | No action needed — `__blend` is plain serializable data (AutomationCurve = mode + points + interpolation), survives JSON roundtrip |
| Inspector's "Edit on timeline" link lights up because of `__blend` automation curve | `Inspector/index.tsx` | Task 6 filters out `__` keys from the link visibility check |
| 3-clip chain alpha math drifts | `lib/renderer/blend.ts` | `computeClipAlpha` multiplies incoming × (1 − outgoing) — explicit test in Task 5 |
| User expects to edit the points of `__blend` in the AutomationLane | UX | Out of scope (documented in plan header). Only interpolation mode is editable in v0.1 |

## Out-of-plan items deferred to Plan 6

- Snap-to-bar for overlap boundaries.
- User-editable `__blend` points in the AutomationLane.
- Multi-track blend (image-to-FX, FX-to-FX across tracks).
- Visual indicator in the timeline of an existing overlap (highlighted overlap region).

Plan 5.6 ends; Plan 6 (Export Pipeline) starts from a clean Plan-5.6 baseline.
