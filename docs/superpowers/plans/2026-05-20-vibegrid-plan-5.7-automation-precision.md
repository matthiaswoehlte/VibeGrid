# VibeGrid Plan 5.7 — Automation Precision Edit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project execution policy (overrides skill defaults):** direct-on-main, sequential, one commit per task. Final CC #2 review at the end.

---

## ⚠ Post-implementation update (after user smoke-test feedback)

Tasks 1–7 below shipped as planned. After the manual smoke-test the user
flagged the inline AutomationLane as too cramped to edit precisely
(50 px tall) and the double-click numeric popover as effectively invisible.
A follow-up refactor — committed as part of this plan — split the automation
UI into two surfaces:

- **Inline AutomationLane in Tracks → READ-ONLY preview.** Shows the curve
  path + non-interactive dots. No snap/interpolation pickers, no ✕ button,
  no click-to-add. Visibility now tied to `ui.selectedClipId` (any selected
  clip with an automated slider renders the lane below its track row) —
  decoupled from `ui.expandedAutomationClipId`.
- **New AutomationEditorModal** — full-screen overlay (~90vw × 85vh, mounted
  in `Workspace`). Triggered by the Inspector's renamed "Open editor"
  button. Stacks an `AutomationCurveEditor` per automated slider (180 px
  curve canvas, snap picker, interpolation picker, ⚡-off button, full
  drag/snap/modifier-key/double-click semantics). A bottom section shows
  non-automated params as compact Inspector controls so the user can flip
  ⚡-toggles + tweak colors/selects without closing the editor.
- **`AutomationPoint` gained an `interactive` prop** (default true). The
  read-only lane passes `interactive={false}` — the wrapper `<g>` drops
  every event handler AND the r=12 hit circle so it can never swallow
  events meant for the preview surface (only the r=4 visible dot remains).
- **Delete UX redesigned** for touch-first: **long-press 600 ms** on a
  point deletes it (or collapses to static when it's the last one). Any
  pointer movement > 4 px cancels the timer (drag wins). Right-click stays
  as a power-user shortcut.
- **`ui.expandedAutomationClipId` repurposed:** still the same field, same
  store-side cleanup behaviour (cleared on `setSelectedClipId(differentId)`
  and `removeClip(matching id)`), but it now drives **modal visibility**
  instead of inline-lane toggling. Semantically: "Editor open for clip X".
- Inspector "Edit on timeline" → renamed "Open editor". One-way: clicking
  always opens the modal. The modal owns its own close affordance
  (✕ button · backdrop click · Escape key).
- The double-click number-input popover now mounts inside the
  `AutomationCurveEditor` (large 180 px canvas → popover is actually
  visible). Same Enter / Escape / blur commit semantics.

**Files added by the refactor:**
- `components/Workspace/Timeline/AutomationCurveEditor.tsx`
- `components/Workspace/Timeline/AutomationEditorModal.tsx`

**Files modified by the refactor:**
- `components/Workspace/Timeline/AutomationPoint.tsx` — `interactive` prop +
  long-press timer
- `components/Workspace/Timeline/AutomationLane.tsx` — stripped to read-only
  preview render
- `components/Workspace/Timeline/AutomationCurveEditor.tsx` — help text:
  "Long-press or right-click to delete"
- `components/Workspace/Timeline/Tracks.tsx` — visibility from
  `selectedClipId`
- `components/Workspace/Inspector/index.tsx` — button rename
- `components/Workspace/index.tsx` — mounts `<AutomationEditorModal />`

**Tests rewritten / added:**
- `tests/unit/components/Timeline/AutomationLane.test.tsx` — read-only
  semantics + reserved-key filter
- `tests/unit/components/Timeline/EditOverlay.test.tsx` — renders via
  `AutomationCurveEditor` directly
- `tests/unit/components/Inspector-automate.test.tsx` — "Open editor"
  wiring (replaces the "Edit on timeline" / "Hide automation" toggle
  tests)
- `tests/unit/components/Timeline/AutomationPoint.test.tsx` — two
  long-press tests using `vi.useFakeTimers`

**Verification state after refactor:** 358 tests green · typecheck clean ·
lint clean · build +1 kB (modal-code).

**Breaking-state note for downstream plans:** `ui.expandedAutomationClipId`
semantics shifted from "inline-lane visible" to "modal open". If Plan 6 or
later code paths inspect this field, they're checking modal state, not
preview-lane visibility. The store-action cleanup (Plan 5.5 Task 13) still
applies and behaves correctly in the new meaning.

The task list below (Tasks 0–7) is preserved as the original implementation
plan and the verification gate it shipped at. The refactor described above
is a single additional commit (`4116bd1`) plus the long-press commit
(`c3d6d14`).

---

---

## Context for the external reviewer (post-handoff-doc state)

29 commits landed between Plan 5.6 completion and this plan being written. The architect-handoff document captures the project state at Plan 5.6 done; this section bridges to the current HEAD so the review has full picture.

**Watchlist items from the handoff doc:**

- ✅ **"Punkt-Drag Bug AutomationLane"** — RESOLVED. Four commits: `8c12969` (setPointerCapture + element-level listeners), `19aea7a` (r=12 invisible hit area + r=6 visible dot + drag-from-creation), `a230849` then `7e28d82` (cursor cleanup — default cursor everywhere in the lane). Plan 5.7's Task 4 rewrites the full AutomationPoint handler — the rewrite MUST preserve all four behaviours (setPointerCapture, dual-circle group, window+target listener parity for jsdom tests, no grab/grabbing cursor). The snippet in Task 4 Step 3 does so explicitly.
- ✅ **`inspectorOpen` local useState in Workspace** — unchanged.
- ✅ **`selectedClipId` out of partialize** — unchanged.

**Notable code changes the architect does NOT yet know about (relevant to Plan 5.7):**

1. **AutomationPoint shape has changed.** It's no longer a single `<circle>` — it's a `<g>` group wrapping a `r=12` transparent hit area (catches clicks) and a `r=6` visible dot (pointerEvents="none"). The `aria-label` lives on the `<g>`. Task 4 Step 3's snippet matches this.

2. **There is ALREADY a Snap picker in the timeline Toolbar** at `components/Workspace/Timeline/Toolbar.tsx`, writing `timeline.snap: 'beat' | 'half' | 'quarter' | 'off'` (labels: `1/1 / 1/2 / 1/4 / off`). It governs **clip placement** — completely separate from this plan's **automation point snap**. The two are intentionally different state because:
   - Clip snap lives in `timeline.snap` (persisted), automation snap will live in `ui.automationSnap` (transient).
   - Clip snap units stop at `1/4`; automation snap needs finer (`1/8`, `1/16`) for musical precision editing.
   - The user picks them independently — coarse-snapping a clip while fine-snapping its automation points is the expected workflow.
   - Same label format (`1/1`, `1/2`, …) keeps the UX consistent.

3. **Global `Delete` / `Backspace` keydown handler** in `components/Workspace/index.tsx` deletes the selected clip. It already short-circuits when `target.tagName === 'INPUT'` / `TEXTAREA` / `isContentEditable`. The Plan 5.7 EditOverlay uses `<input type="number">` so the guard covers it — typing `99` then Backspacing won't kill the clip.

4. **Ruler is now click + drag to seek.** New surface but no conflict with Plan 5.7. Modifier keys held while clicking the Ruler are currently ignored (seek runs regardless); Plan 5.7 modifiers apply only on AutomationPoint drags. If the architect wants the Ruler to also respect Ctrl/Shift in some way, that's out of scope here.

5. **Image rendering uses `drawImageContain`** (Plan 5.5 → user request). The lane / Inspector are unaffected.

6. **`ctx.globalAlpha *=` convention** is now mandatory inside FX plugins (Plan 5.6 + Particles per-clip pool fix). No relevance to Plan 5.7.

7. **AutomateButton ⚡ now passes `value` as 4th arg to `convertParamToAutomation`** — was a Plan-5.6 follow-up fix because fresh clips with `clip.params === undefined` had no key in params, and `patchClipParam` bailed. Plan 5.7 doesn't touch convertParamToAutomation — it adds `updateParamPoints` next to it.

8. **Recent commits affecting files Plan 5.7 will modify:**
   - `components/Workspace/Timeline/AutomationPoint.tsx` — heavily evolved. See current state before designing replacement.
   - `components/Workspace/Timeline/AutomationLane.tsx` — gained a defensive `__`-prefix filter and a wired `Transition` section is in `Inspector/`, not the Lane.
   - `lib/store/timeline-slice.ts` — gained `setBlendInterpolation`, `regenerateBlendsForTrack` wrap on add/move/resize/remove, and an `expandedAutomationClipId` cleanup on removeClip. Plan 5.7's `updateParamPoints` addition is purely additive to the actions object.

**Current full-suite test count at plan-write time:** 336 passing (Plan 5.6 baseline). Plan 5.7 targets ≥ 355.

**Conventions confirmed since handoff:**
- Pointer events use deltas + `setPointerCapture` (not absolute coords, not pointer-events: none guards).
- jsdom unit tests dispatch native `MouseEvent` with the `pointer*` type names — `fireEvent.pointer*()` strips `clientX`. Tests in this plan follow the established pattern.
- One commit per task; allowed scopes: `automation`, `store`, `timeline`, `inspector`, `tests`, `chore`.

---

**Goal:** Make the AutomationLane usable for precision editing — automation points snap to a chosen grid (1 / ½ / ¼ / ⅛ / 1⁄16 beat), modifier keys constrain drag axis or move trailing points together, and a double-click opens an inline overlay with exact numeric inputs for beat and value. All four features layer on top of the existing Plan-5.5 drag pipeline without changing the data model.

**Architecture:** Four small additive surfaces on top of Plan 5.5's AutomationLane / AutomationPoint.

1. **Snap helper + UI state.** Pure `snapBeat(beat, unit)` in `lib/automation/snap.ts`. New transient UI state `ui.automationSnap: AutomationSnap` (default `'off'`) — never persisted. A picker dropdown in the AutomationLane header (next to the interpolation select) writes the field.
2. **Modifier-aware drag.** `AutomationPoint`'s pointermove reads `ev.ctrlKey` / `ev.shiftKey` live each frame:
   - **Ctrl** = Y-only: beat stays at `startBeat`, only value moves.
   - **Shift** = drag the active point AND every point with `originalBeat >= activeOriginalBeat` by the same delta. A snapshot of all original `(beat, value)` pairs is captured at pointerdown so re-sort during drag doesn't shuffle the trailing set.
   - **Neither / both** = current behaviour (single-point free drag).
   - Snap (when not `'off'`) applies to the active point's BEAT only. With Shift, snapping the leader implicitly snaps the followers since they share the same beat-delta.
3. **Batch update store action.** Existing `updateParamPoint` updates one point; Shift-drag needs N atomic updates per pointermove so the store / renderer see ONE consistent state per frame. New `updateParamPoints(clipId, key, updates)` action where `updates: Array<{ index, beat?, value? }>` applies all merges + re-sort in a single `set()`.
4. **Edit overlay.** New `AutomationPointEditOverlay` component, mounted in `AutomationLane` next to the lane SVG. Double-click on a point opens it; two `<input type="number">` fields (beat, value) seeded with the point's current values. Enter (or blur) applies via `updateParamPoint`; Escape cancels. The overlay tracks which clip + key + index is being edited via local lane state (no store changes — the editor is transient, one-at-a-time).

**Tech Stack:** existing — Zustand store, React 18, automation primitives from Plan 5.5/5.6. No new dependencies.

**Spec reference:** Plan 5.5 introduced the AutomationLane + drag pipeline. Plan 5.6 added the reserved-param convention. This plan's `__`-keys filter is unchanged. The architect-handoff doc lists Plan 5.7 scope as "Snap-to-Grid (1/½/¼/⅛/1⁄16), Modifier-Keys (Ctrl=Y-only, Shift=nachfolgende mitziehen), Edit-Overlay (Doppelklick, Zahlenfeld, Zoom)" — implemented in full below.

**Verification gate (must pass before Plan 6 starts):**

```
npm test -- automation/snap            # ≥ 6 (each grid unit + off pass-through + clamp)
npm test -- store/timeline-batch       # ≥ 4 (batch updates apply, re-sort, no-op cases)
npm test -- components/Timeline/AutomationPoint-modifiers  # ≥ 5 (ctrl, shift, both, neither, snap)
npm test -- components/Timeline/AutomationLane             # existing + 2 snap-picker = ≥ 8
npm test -- components/Timeline/EditOverlay                # ≥ 4 (open, beat input, value input, esc)
npm test                                # full suite ≥ 355 (Plan 5.6 final = 336; ~21 new)
npm run typecheck
npm run lint
npm run build
```

**Smoke gate (manual, before declaring Plan 5.7 done):**

```
npm run dev
# - Add a Pulse clip, ⚡-automate intensity, add 4 points spread across the clip.
# - In the lane header, change Snap from "off" to "1/4". Drag a point — it snaps
#   to 0.25-beat increments. Switch to 1/16 → finer snaps.
# - Hold Ctrl while dragging — only value changes; beat stays fixed.
# - Hold Shift while dragging point 2 — points 3 and 4 follow with the same
#   delta. Point 1 stays put.
# - Hold Shift + Ctrl — trailing points move only in Y.
# - Double-click point 3 — overlay opens with beat + value inputs. Type 5.5
#   into beat, press Enter — point moves to beat 5.5. Open again → Escape
#   closes without changes.
# - All existing behaviour unchanged: pointer drag without modifiers, right-
#   click delete, click-to-add still work.
```

**Dependencies on prior plans:** Plan 5.5 (AutomationLane, AutomationPoint, updateParamPoint). Plan 5.6 (reserved-param prefix — overlay filters `__` keys, same as the lane).

**Out of scope (Plan 6 or v0.2):**

- Per-axis zoom in the lane (visual Y-axis stretch for precision in a tight value range).
- Multi-select for points (Shift-click to extend selection, then drag the group).
- Keyboard nudging of selected point (arrow keys).
- Snap-to-existing-point (magnetism).
- Undo/redo of the batch update.

---

## File map

### Pure helpers

| File | Purpose |
|---|---|
| `lib/automation/snap.ts` (create) | `AutomationSnap` union, `SNAP_BEAT_STEP: Record<AutomationSnap, number>`, `snapBeat(beat: number, unit: AutomationSnap): number` |

### Store

| File | Purpose |
|---|---|
| `lib/store/types.ts` (modify) | Add `automationSnap: AutomationSnap` to `UIState`; add `setAutomationSnap` to the top-level AppState actions; add `updateParamPoints` to `TimelineActions` |
| `lib/store/index.ts` (modify) | Inline UI literal gains `automationSnap: 'off'`; new top-level `setAutomationSnap` action; the partialize comment lists the new transient field |
| `lib/store/timeline-slice.ts` (modify) | Implement `updateParamPoints(clipId, key, updates)` — applies a batch of `{ index, beat?, value? }` patches via the existing `updatePoint` helper, ONE `set()` for the whole batch |
| Files that construct full `ui` literals (modify) | `components/TopBar/ClearProjectButton.tsx`, `tests/unit/components/Inspector.test.tsx`, `tests/unit/components/AutoPresetButton.test.tsx`, `tests/unit/components/Timeline/Clip.test.tsx` — extend each `ui: {...}` literal with `automationSnap: 'off'` (strict TS will flag any miss) |

### Components

| File | Purpose |
|---|---|
| `components/Workspace/Timeline/AutomationLane.tsx` (modify) | Add snap picker in the header next to the interpolation select; manage local `editingPoint: { key, index } \| null` state; render `AutomationPointEditOverlay` when set |
| `components/Workspace/Timeline/AutomationPoint.tsx` (modify) | Snapshot all points' originals at pointerdown; read modifier keys per pointermove; route to single-point or batch update; apply snap via `snapBeat`; emit `onEdit({ key, index })` callback when double-clicked |
| `components/Workspace/Timeline/AutomationPointEditOverlay.tsx` (create) | HTML popover absolutely positioned near the point; two number inputs (beat, value); Enter / blur apply via `updateParamPoint`; Esc closes via `onClose` callback |

### Tests (≥ 21 new)

| File | Tests |
|---|---|
| `tests/unit/automation/snap.test.ts` (create) | ≥ 6: `'off'` returns the input unchanged, `'1'` rounds to nearest beat, `'1/2'` rounds to 0.5, `'1/4'` rounds to 0.25, `'1/16'` rounds to 0.0625, negative inputs clamp to 0 |
| `tests/unit/store/timeline-batch.test.ts` (create) | ≥ 4: `updateParamPoints` applies multi-point patch, re-sorts when a beat change crosses a neighbor, partial patches (only beat OR only value) work, empty updates array is a no-op |
| `tests/unit/components/Timeline/AutomationPoint-modifiers.test.tsx` (create) | ≥ 5: no modifier → free drag (existing behaviour); ctrl → beat locked at startBeat; shift → trailing points follow same delta; ctrl+shift → trailing points move only in Y; snap='1/4' + free drag → beat lands on 0.25 grid |
| `tests/unit/components/Timeline/AutomationLane.test.tsx` (extend) | +2: snap picker shows current `ui.automationSnap`; changing it dispatches `setAutomationSnap` |
| `tests/unit/components/Timeline/EditOverlay.test.tsx` (create) | ≥ 4: double-click on a point opens the overlay; typing a beat + Enter dispatches `updateParamPoint`; typing a value + blur dispatches `updateParamPoint`; Esc closes without dispatch |

---

## Conventions

- **`automationSnap` is transient UI state.** Same partialize rule as `expandedAutomationClipId` / `selectedClipId` — only `zoom` survives reloads.
- **Snap applies to BEAT only, never to VALUE.** Values are continuous (slider min..max). The grid is musical, the value axis isn't.
- **Modifier keys are read LIVE per pointermove.** Holding Ctrl mid-drag locks X immediately; releasing it returns to free X. Same for Shift. This matches every DAW the user has touched.
- **Shift snapshot at pointerdown.** The set of "trailing" points is the indices of points with `originalBeat >= activeOriginalBeat` at the moment the user pressed down. If a follower would overtake another point during drag, sort happens via `updateParamPoints`; the snapshot itself is never re-evaluated.
- **The overlay is one-at-a-time.** Lane-local state, not store. Double-clicking a second point closes the first overlay and opens the new one.
- **`__`-prefix params still hidden.** Plan 5.6's filter stays in place — the overlay never opens for `__blend` or any other reserved key.
- **One commit per task.** Allowed scopes: `automation`, `store`, `timeline`, `inspector`, `tests`, `chore`.

---

## Task 0: Baseline verification

**Files:** none

- [ ] **Step 1: Confirm the Plan 5.6 baseline**

```bash
npm test -- --run
npm run typecheck
npm run lint
```

Expected: 336 tests green, typecheck + lint clean. If lower, STOP and surface the regression.

No commit.

---

## Task 1: Snap-to-grid pure helper

**Files:**
- Create: `lib/automation/snap.ts`
- Create: `tests/unit/automation/snap.test.ts`

> A pure function that rounds a beat value to the nearest grid unit. `'off'` is a pass-through.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/automation/snap.test.ts
import { describe, it, expect } from 'vitest';
import { snapBeat, type AutomationSnap } from '@/lib/automation/snap';

describe('snapBeat', () => {
  it('returns the input unchanged when snap is off', () => {
    expect(snapBeat(1.234, 'off')).toBe(1.234);
  });

  it("'1' rounds to the nearest whole beat", () => {
    expect(snapBeat(1.2, '1')).toBe(1);
    expect(snapBeat(1.6, '1')).toBe(2);
  });

  it("'1/2' rounds to 0.5 increments", () => {
    expect(snapBeat(1.2, '1/2')).toBe(1);
    expect(snapBeat(1.3, '1/2')).toBe(1.5);
  });

  it("'1/4' rounds to 0.25 increments", () => {
    expect(snapBeat(1.6, '1/4')).toBe(1.5);
    expect(snapBeat(1.7, '1/4')).toBe(1.75);
  });

  it("'1/16' rounds to 0.0625 increments", () => {
    expect(snapBeat(1.03, '1/16')).toBeCloseTo(1.0625, 5);
  });

  it('clamps negative inputs to 0', () => {
    expect(snapBeat(-0.5, '1/4')).toBe(0);
    expect(snapBeat(-0.001, 'off')).toBe(0);
  });

  it('exposes the AutomationSnap union via the type-import (compile check)', () => {
    const units: AutomationSnap[] = ['off', '1', '1/2', '1/4', '1/8', '1/16'];
    expect(units).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run, verify it fails (module not found)**

Run: `npm test -- automation/snap --run`

- [ ] **Step 3: Implement `lib/automation/snap.ts`**

```ts
export type AutomationSnap = 'off' | '1' | '1/2' | '1/4' | '1/8' | '1/16';

export const SNAP_BEAT_STEP: Record<Exclude<AutomationSnap, 'off'>, number> = {
  '1': 1,
  '1/2': 0.5,
  '1/4': 0.25,
  '1/8': 0.125,
  '1/16': 0.0625
};

/** Round a beat value to the nearest grid unit. `'off'` is a pass-through.
 *  Always clamps the result to ≥ 0. */
export function snapBeat(beat: number, unit: AutomationSnap): number {
  if (unit === 'off') return Math.max(0, beat);
  const step = SNAP_BEAT_STEP[unit];
  return Math.max(0, Math.round(beat / step) * step);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- automation/snap --run`
Expected: 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/automation/snap.ts tests/unit/automation/snap.test.ts
git commit -m "feat(automation): snapBeat helper + AutomationSnap union"
```

---

## Task 2: Store — `automationSnap` UI state + `updateParamPoints` batch action

**Files:**
- Modify: `lib/store/types.ts`
- Modify: `lib/store/index.ts`
- Modify: `lib/store/timeline-slice.ts`
- Modify: `components/TopBar/ClearProjectButton.tsx`
- Modify: `tests/unit/components/Inspector.test.tsx`
- Modify: `tests/unit/components/AutoPresetButton.test.tsx`
- Modify: `tests/unit/components/Timeline/Clip.test.tsx`
- Create: `tests/unit/store/timeline-batch.test.ts`

> Strict TS will flag every site that constructs a full `ui` literal — same pattern as Plan 5.5's `expandedAutomationClipId` rollout.

- [ ] **Step 1: Write the failing batch test**

```ts
// tests/unit/store/timeline-batch.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import type { AutomationCurve } from '@/lib/automation/types';

const CLIP_ID = 'clip-batch';

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
          lengthBeats: 16,
          label: 'Batch',
          params: {
            intensity: {
              mode: 'automation',
              interpolation: 'linear',
              points: [
                { beat: 0, value: 0 },
                { beat: 4, value: 0.5 },
                { beat: 8, value: 0.5 },
                { beat: 12, value: 1 }
              ]
            } satisfies AutomationCurve<number>
          }
        }
      ]
    }
  }));
});

describe('timelineActions.updateParamPoints', () => {
  it('applies a multi-point patch in one call', () => {
    useAppStore
      .getState()
      .timelineActions.updateParamPoints(CLIP_ID, 'intensity', [
        { index: 1, beat: 5 },
        { index: 2, beat: 9 },
        { index: 3, beat: 13 }
      ]);
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points.map((p) => p.beat)).toEqual([0, 5, 9, 13]);
  });

  it('re-sorts when a moved point crosses a neighbor', () => {
    useAppStore
      .getState()
      .timelineActions.updateParamPoints(CLIP_ID, 'intensity', [
        { index: 1, beat: 10 } // moves point 1 past points 2 and 3
      ]);
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points.map((p) => p.beat)).toEqual([0, 8, 10, 12]);
  });

  it('accepts partial patches (beat only OR value only)', () => {
    useAppStore
      .getState()
      .timelineActions.updateParamPoints(CLIP_ID, 'intensity', [
        { index: 1, value: 0.8 },
        { index: 2, beat: 10 }
      ]);
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points[1].value).toBe(0.8);
    expect(c.points.map((p) => p.beat)).toEqual([0, 4, 10, 12]);
  });

  it('empty updates array is a no-op (same reference)', () => {
    const before = useAppStore.getState().timeline.clips[0].params!.intensity;
    useAppStore.getState().timelineActions.updateParamPoints(CLIP_ID, 'intensity', []);
    const after = useAppStore.getState().timeline.clips[0].params!.intensity;
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 2: Run, verify fails**

Run: `npm test -- store/timeline-batch --run`
Expected: action does not exist yet.

- [ ] **Step 3: Extend `lib/store/types.ts`**

Add `AutomationSnap` import:

```ts
import type { AutomationPoint, Interpolation } from '@/lib/automation/types';
import type { AutomationSnap } from '@/lib/automation/snap';
```

Extend `UIState`:

```ts
export interface UIState {
  zoom: number;
  selectedClipId: string | null;
  expandedAutomationClipId: string | null;
  automationSnap: AutomationSnap;
}
```

Extend the top-level `AppState` action set (next to `setExpandedAutomationClipId`):

```ts
setAutomationSnap(snap: AutomationSnap): void;
```

Add to `TimelineActions`:

```ts
updateParamPoints(
  clipId: string,
  key: string,
  updates: Array<{ index: number; beat?: number; value?: number }>
): void;
```

- [ ] **Step 4: Extend `lib/store/index.ts`**

Update the inline UI literal + add the action. Locate the existing block:

```ts
ui: { zoom: 1, selectedClipId: null, expandedAutomationClipId: null },
setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
setSelectedClipId: (id) => ...,
setExpandedAutomationClipId: (clipId) => ...,
```

Becomes:

```ts
ui: { zoom: 1, selectedClipId: null, expandedAutomationClipId: null, automationSnap: 'off' },
setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
setSelectedClipId: (id) => ...,
setExpandedAutomationClipId: (clipId) =>
  set((s) => ({ ui: { ...s.ui, expandedAutomationClipId: clipId } })),
setAutomationSnap: (snap) =>
  set((s) => ({ ui: { ...s.ui, automationSnap: snap } })),
```

Update the partialize comment block — list `automationSnap` alongside the other transient fields. The line itself stays `ui: { zoom: state.ui.zoom }`.

- [ ] **Step 5: Implement `updateParamPoints` in `lib/store/timeline-slice.ts`**

Add `updatePoint` is already imported. Add the action inside the actions object:

```ts
updateParamPoints: (clipId, key, updates) => {
  if (updates.length === 0) return;
  set((state) => {
    const clips = state.timeline.clips.map((c) => {
      if (c.id !== clipId) return c;
      const params = c.params ?? {};
      if (!(key in params)) return c;
      const blend = params[key];
      if (!isAutomationCurve(blend)) return c;
      let curve = blend as AutomationCurve<unknown>;
      for (const u of updates) {
        const patch: Partial<AutomationPoint<unknown>> = {};
        if (u.beat !== undefined) patch.beat = u.beat;
        if (u.value !== undefined) patch.value = u.value;
        curve = updatePoint(curve, u.index, patch);
      }
      return { ...c, params: { ...params, [key]: curve } };
    });
    return { timeline: { ...state.timeline, clips } };
  });
},
```

> Note: `updatePoint` already re-sorts after a beat change. Repeatedly calling it across the batch produces a sort per update — fine for v0.1 (typical batch is < 16 points). v0.2 can fuse into one sort if profiling shows it matters.

- [ ] **Step 6: Update the four call sites that construct full `ui` literals**

Grep first:

```bash
grep -rn "selectedClipId: null" components/ tests/
```

For each match where the literal includes `expandedAutomationClipId: null` (the post-Plan-5.5 shape), extend to also include `automationSnap: 'off'`:

```ts
ui: { zoom: 1, selectedClipId: null, expandedAutomationClipId: null, automationSnap: 'off' }
```

Files:
- `components/TopBar/ClearProjectButton.tsx`
- `tests/unit/components/Inspector.test.tsx`
- `tests/unit/components/AutoPresetButton.test.tsx`
- `tests/unit/components/Timeline/Clip.test.tsx`

- [ ] **Step 7: Run tests, verify all pass**

Run: `npm test -- store/timeline-batch --run` (4 green) then `npm test -- --run` (no regressions).

- [ ] **Step 8: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add lib/store/types.ts lib/store/index.ts lib/store/timeline-slice.ts \
        components/TopBar/ClearProjectButton.tsx \
        tests/unit/components/Inspector.test.tsx \
        tests/unit/components/AutoPresetButton.test.tsx \
        tests/unit/components/Timeline/Clip.test.tsx \
        tests/unit/store/timeline-batch.test.ts
git commit -m "feat(store): automationSnap UI state + updateParamPoints batch action"
```

---

## Task 3: Snap picker in AutomationLane header

**Files:**
- Modify: `components/Workspace/Timeline/AutomationLane.tsx`
- Modify: `tests/unit/components/Timeline/AutomationLane.test.tsx`

> A `<select>` next to the interpolation picker. Writes `ui.automationSnap` via the new action. Snap-during-drag wiring is Task 4.

- [ ] **Step 1: Extend the existing AutomationLane test**

Append two new tests to `tests/unit/components/Timeline/AutomationLane.test.tsx`:

```ts
describe('AutomationLane — snap picker', () => {
  it('renders a snap select reflecting ui.automationSnap', () => {
    useAppStore.getState().setAutomationSnap('1/4');
    render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    const select = screen.getByRole('combobox', { name: /snap to grid/i }) as HTMLSelectElement;
    expect(select.value).toBe('1/4');
  });

  it('changing the snap select dispatches setAutomationSnap', () => {
    render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    fireEvent.change(screen.getByRole('combobox', { name: /snap to grid/i }), {
      target: { value: '1/8' }
    });
    expect(useAppStore.getState().ui.automationSnap).toBe('1/8');
  });
});
```

- [ ] **Step 2: Run, verify fails**

Run: `npm test -- components/Timeline/AutomationLane --run`

- [ ] **Step 3: Modify `AutomationLane.tsx`**

Add the import:

```ts
import type { AutomationSnap } from '@/lib/automation/snap';
```

Above the `INTERPOLATION_MODES` constant, declare:

```ts
const SNAP_UNITS: AutomationSnap[] = ['off', '1', '1/2', '1/4', '1/8', '1/16'];

// Display labels match the clip-snap Toolbar's labels (1/1 instead of 1) so
// the two snap pickers look consistent when shown side by side.
const SNAP_LABEL: Record<AutomationSnap, string> = {
  off: 'off',
  '1': '1/1',
  '1/2': '1/2',
  '1/4': '1/4',
  '1/8': '1/8',
  '1/16': '1/16'
};
```

Read the UI state inside the component (near the other `useAppStore((s) => ...)` calls):

```ts
const automationSnap = useAppStore((s) => s.ui.automationSnap);
const setAutomationSnap = useAppStore((s) => s.setAutomationSnap);
```

In the header (the `<div className="flex items-center gap-1">` row that contains the interpolation select + close button), add a new select BEFORE the interpolation select:

```tsx
<select
  aria-label={`Snap to grid for ${schema.label}`}
  className="text-[10px] bg-[var(--surface-3)] text-[var(--text)] rounded px-1 py-0.5"
  value={automationSnap}
  onChange={(e) => setAutomationSnap(e.target.value as AutomationSnap)}
  title="Snap automation points to grid"
>
  {SNAP_UNITS.map((u) => (
    <option key={u} value={u}>
      {SNAP_LABEL[u]}
    </option>
  ))}
</select>
```

> Per-row label is fine — the picker writes to ONE global field, but rendering it in every lane row keeps the control next to where the user is editing.

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- components/Timeline/AutomationLane --run`
Expected: 6 original + 2 new = 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add components/Workspace/Timeline/AutomationLane.tsx \
        tests/unit/components/Timeline/AutomationLane.test.tsx
git commit -m "feat(timeline): snap picker in AutomationLane header"
```

---

## Task 4: Modifier-aware drag in AutomationPoint

**Files:**
- Modify: `components/Workspace/Timeline/AutomationPoint.tsx`
- Create: `tests/unit/components/Timeline/AutomationPoint-modifiers.test.tsx`

> The drag handler grows three behaviours: snap (active when `ui.automationSnap !== 'off'`), Ctrl (Y-only), Shift (move trailing points). Modifier state is read LIVE on each pointermove via `ev.ctrlKey` / `ev.shiftKey` so users can hold/release mid-drag.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/Timeline/AutomationPoint-modifiers.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { AutomationPoint as PointDot } from '@/components/Workspace/Timeline/AutomationPoint';
import type { AutomationCurve } from '@/lib/automation/types';

const CLIP_ID = 'clip-mod';
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
          label: 'Mod',
          params: {
            intensity: {
              mode: 'automation',
              interpolation: 'linear',
              points: [
                { beat: 0, value: 0 },
                { beat: 2, value: 0.25 },
                { beat: 4, value: 0.5 },
                { beat: 6, value: 0.75 }
              ]
            } satisfies AutomationCurve<number>
          }
        }
      ]
    },
    ui: { ...s.ui, automationSnap: 'off' }
  }));
});

const renderInSvg = (pointIndex: number, beat: number, value: number) =>
  render(
    <svg width={160} height={50}>
      <PointDot
        clipId={CLIP_ID}
        paramKey={KEY}
        pointIndex={pointIndex}
        beat={beat}
        value={value}
        lengthBeats={8}
        laneWidthPx={160}
        laneHeightPx={50}
        valueMin={0}
        valueMax={1}
      />
    </svg>
  );

const drag = (
  el: Element,
  dx: number,
  dy: number,
  opts: { ctrl?: boolean; shift?: boolean } = {}
) => {
  el.dispatchEvent(
    new MouseEvent('pointerdown', { clientX: 0, clientY: 0, bubbles: true, ...opts })
  );
  window.dispatchEvent(
    new MouseEvent('pointermove', {
      clientX: dx,
      clientY: dy,
      bubbles: true,
      ctrlKey: opts.ctrl,
      shiftKey: opts.shift
    })
  );
  window.dispatchEvent(
    new MouseEvent('pointerup', { clientX: dx, clientY: dy, bubbles: true })
  );
};

describe('AutomationPoint — modifier keys', () => {
  it('no modifier — both axes move (existing behaviour)', () => {
    renderInSvg(1, 2, 0.25);
    drag(screen.getByLabelText(/automation point 2/i), 20, -10);
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    // 20 px right at 20 px/beat = +1 beat; -10 px at 50 height (range 1) = +0.2
    expect(c.points[1].beat).toBeCloseTo(3, 5);
    expect(c.points[1].value).toBeCloseTo(0.45, 5);
  });

  it('ctrl — beat locked, only value moves', () => {
    renderInSvg(1, 2, 0.25);
    drag(screen.getByLabelText(/automation point 2/i), 40, -10, { ctrl: true });
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points[1].beat).toBe(2);
    expect(c.points[1].value).toBeCloseTo(0.45, 5);
  });

  it('shift — trailing points follow by same delta', () => {
    renderInSvg(1, 2, 0.25);
    drag(screen.getByLabelText(/automation point 2/i), 20, 0, { shift: true });
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    // Points at indices 1, 2, 3 all shift +1 beat; point 0 stays.
    expect(c.points.map((p) => p.beat)).toEqual([0, 3, 5, 7]);
  });

  it('ctrl + shift — trailing points move only in Y', () => {
    renderInSvg(1, 2, 0.25);
    drag(screen.getByLabelText(/automation point 2/i), 40, -10, {
      ctrl: true,
      shift: true
    });
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points.map((p) => p.beat)).toEqual([0, 2, 4, 6]);
    expect(c.points[1].value).toBeCloseTo(0.45, 5);
    expect(c.points[2].value).toBeCloseTo(0.7, 5);
    expect(c.points[3].value).toBeCloseTo(0.95, 5);
  });

  it("snap '1/4' rounds the active beat", () => {
    useAppStore.getState().setAutomationSnap('1/4');
    renderInSvg(1, 2, 0.25);
    // 13 px ≈ 0.65 beat → with start at beat 2, target ≈ 2.65 → snap to 2.75
    drag(screen.getByLabelText(/automation point 2/i), 13, 0);
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points[1].beat).toBeCloseTo(2.75, 5);
  });
});
```

- [ ] **Step 2: Run, verify fails**

Run: `npm test -- AutomationPoint-modifiers --run`

- [ ] **Step 3: Modify `AutomationPoint.tsx`**

Replace the file contents:

```tsx
'use client';
import { useAppStore } from '@/lib/store';
import { snapBeat } from '@/lib/automation/snap';
import type { AutomationCurve } from '@/lib/automation/types';

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
  valueMax,
  onEdit
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
  /** Called on double-click — caller mounts the EditOverlay. */
  onEdit?: (info: { key: string; index: number }) => void;
}) {
  const updateParamPoint = useAppStore((s) => s.timelineActions.updateParamPoint);
  const updateParamPoints = useAppStore((s) => s.timelineActions.updateParamPoints);
  const removeParamPoint = useAppStore((s) => s.timelineActions.removeParamPoint);
  const convertToStatic = useAppStore((s) => s.timelineActions.convertParamToStatic);
  const totalPoints = useAppStore((s) => {
    const clip = s.timeline.clips.find((c) => c.id === clipId);
    const val = clip?.params?.[paramKey];
    if (val && typeof val === 'object' && 'points' in val) {
      return (val as { points: unknown[] }).points.length;
    }
    return 0;
  });

  const range = valueMax - valueMin || 1;
  const cx = (beat / lengthBeats) * laneWidthPx;
  const cy = laneHeightPx - ((value - valueMin) / range) * laneHeightPx;

  const onPointerDown = (e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation();
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      /* jsdom may not implement setPointerCapture */
    }

    // Snapshot the WHOLE point list at down-time so the Shift modifier has a
    // stable "trailing set" even if sort re-orders mid-drag.
    const state = useAppStore.getState();
    const clip = state.timeline.clips.find((c) => c.id === clipId);
    const curve = clip?.params?.[paramKey] as AutomationCurve<number> | undefined;
    const originals = curve
      ? curve.points.map((p) => ({ beat: p.beat, value: p.value }))
      : [];
    const trailingIndices: number[] = [];
    for (let i = 0; i < originals.length; i++) {
      if (i === pointIndex) continue;
      if (originals[i].beat >= originals[pointIndex]?.beat) trailingIndices.push(i);
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const pxPerBeat = laneWidthPx / lengthBeats;

    const move = (ev: PointerEvent) => {
      const dxBeatsRaw = (ev.clientX - startX) / pxPerBeat;
      const dyValueRaw = -((ev.clientY - startY) / laneHeightPx) * range;

      const lockX = ev.ctrlKey;
      const moveTrailing = ev.shiftKey;

      // Resolve the active point's next position (snapped on beat if enabled).
      const snap = useAppStore.getState().ui.automationSnap;
      const activeNextBeat = lockX
        ? originals[pointIndex].beat
        : snapBeat(
            Math.max(
              0,
              Math.min(lengthBeats, originals[pointIndex].beat + dxBeatsRaw)
            ),
            snap
          );
      const activeNextValue = Math.max(
        valueMin,
        Math.min(valueMax, originals[pointIndex].value + dyValueRaw)
      );

      // The "effective" deltas applied to trailing points come from the
      // active point's actually-applied movement (post-snap, post-lock). This
      // keeps the group cohesive — if snap rounds the leader, followers
      // round with it.
      const effDBeat = lockX ? 0 : activeNextBeat - originals[pointIndex].beat;
      const effDValue = activeNextValue - originals[pointIndex].value;

      if (!moveTrailing) {
        updateParamPoint(clipId, paramKey, pointIndex, {
          beat: activeNextBeat,
          value: activeNextValue
        });
        return;
      }

      const updates: Array<{ index: number; beat?: number; value?: number }> = [];
      updates.push({ index: pointIndex, beat: activeNextBeat, value: activeNextValue });
      for (const i of trailingIndices) {
        const ob = originals[i].beat;
        const ov = originals[i].value;
        const nextBeat = lockX ? ob : Math.max(0, Math.min(lengthBeats, ob + effDBeat));
        const nextValue = Math.max(valueMin, Math.min(valueMax, ov + effDValue));
        updates.push({ index: i, beat: nextBeat, value: nextValue });
      }
      updateParamPoints(clipId, paramKey, updates);
    };
    const up = (ev: PointerEvent) => {
      try {
        target.releasePointerCapture(ev.pointerId);
      } catch {
        /* may already be released */
      }
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (totalPoints <= 1) convertToStatic(clipId, paramKey);
    else removeParamPoint(clipId, paramKey, pointIndex);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.({ key: paramKey, index: pointIndex });
  };

  return (
    <g
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      role="button"
      aria-label={`Automation point ${pointIndex + 1}`}
    >
      <circle cx={cx} cy={cy} r={12} fill="rgba(0,0,0,0)" pointerEvents="all" />
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fill="var(--a2)"
        stroke="var(--bg)"
        strokeWidth={1.5}
        pointerEvents="none"
      />
    </g>
  );
}
```

- [ ] **Step 4: Verify the four pre-existing bug-fix behaviours are preserved**

The architect's v2 review flagged that this Task wholesale-rewrites
`AutomationPoint.tsx`, and four bug-fix commits (`8c12969` ... `7e28d82`)
sit in the history that MUST NOT be silently reverted. Grep the new file:

```bash
grep -c "setPointerCapture" components/Workspace/Timeline/AutomationPoint.tsx
# Expected: at least 1 (line 51-ish in the new file).
grep -c "r={12}" components/Workspace/Timeline/AutomationPoint.tsx
grep -c "r={6}" components/Workspace/Timeline/AutomationPoint.tsx
# Expected: 1 each (dual-circle hit area pattern).
grep -ic "cursor: 'grab'" components/Workspace/Timeline/AutomationPoint.tsx
# Expected: 0 (no grab cursor — Plan 5.6 user fix).
```

If any check fails, STOP — the rewrite dropped a fix. Re-apply against
the snippet in Step 3 before continuing.

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test -- AutomationPoint-modifiers AutomationPoint --run`
Expected: existing 5 (post-Plan-5.6) + 5 modifier tests all green.

- [ ] **Step 6: Run full suite — no regressions**

Run: `npm test -- --run`

- [ ] **Step 7: Typecheck + lint**

- [ ] **Step 8: Commit**

```bash
git add components/Workspace/Timeline/AutomationPoint.tsx \
        tests/unit/components/Timeline/AutomationPoint-modifiers.test.tsx
git commit -m "feat(timeline): modifier-aware drag (ctrl, shift, snap) for automation points"
```

---

## Task 5: Edit overlay (double-click → numeric inputs)

**Files:**
- Create: `components/Workspace/Timeline/AutomationPointEditOverlay.tsx`
- Modify: `components/Workspace/Timeline/AutomationLane.tsx`
- Create: `tests/unit/components/Timeline/EditOverlay.test.tsx`

> The overlay is HTML (not SVG) so it can carry inputs. The lane owns `editingPoint: { key, index } | null` as local React state — never the store. AutomationPoint's `onEdit` callback writes it; the overlay's `onClose` clears it.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/Timeline/EditOverlay.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { _resetBuiltInPluginsForTests, registerBuiltInPlugins } from '@/lib/fx';
import { AutomationLane } from '@/components/Workspace/Timeline/AutomationLane';
import type { AutomationCurve } from '@/lib/automation/types';

const CLIP_ID = 'clip-edit';
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
          label: 'Edit',
          params: {
            intensity: {
              mode: 'automation',
              interpolation: 'linear',
              points: [
                { beat: 0, value: 0 },
                { beat: 4, value: 0.5 }
              ]
            } satisfies AutomationCurve<number>
          }
        }
      ]
    },
    ui: { ...s.ui, expandedAutomationClipId: CLIP_ID }
  }));
});

const openOverlayFor = (index: number) => {
  render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
  fireEvent.doubleClick(screen.getByLabelText(`Automation point ${index + 1}`));
};

describe('EditOverlay', () => {
  it('double-click opens the overlay with current beat + value', () => {
    openOverlayFor(1);
    const beatInput = screen.getByLabelText(/beat/i) as HTMLInputElement;
    const valueInput = screen.getByLabelText(/value/i) as HTMLInputElement;
    expect(beatInput.value).toBe('4');
    expect(valueInput.value).toBe('0.5');
  });

  it('Enter on the beat input commits the new beat', () => {
    openOverlayFor(1);
    const beatInput = screen.getByLabelText(/beat/i);
    fireEvent.change(beatInput, { target: { value: '5.5' } });
    fireEvent.keyDown(beatInput, { key: 'Enter' });
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points[1].beat).toBe(5.5);
  });

  it('blur on the value input commits the new value', () => {
    openOverlayFor(1);
    const valueInput = screen.getByLabelText(/value/i);
    fireEvent.change(valueInput, { target: { value: '0.9' } });
    fireEvent.blur(valueInput);
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points[1].value).toBe(0.9);
  });

  it('Escape closes the overlay without committing pending input', () => {
    openOverlayFor(1);
    const beatInput = screen.getByLabelText(/beat/i);
    fireEvent.change(beatInput, { target: { value: '99' } });
    fireEvent.keyDown(beatInput, { key: 'Escape' });
    expect(screen.queryByLabelText(/beat/i)).toBeNull();
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points[1].beat).toBe(4);
  });
});
```

- [ ] **Step 2: Run, verify fails**

Run: `npm test -- EditOverlay --run`

- [ ] **Step 3: Implement `components/Workspace/Timeline/AutomationPointEditOverlay.tsx`**

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { isAutomationCurve } from '@/lib/automation/resolve';
import type { AutomationCurve } from '@/lib/automation/types';

export function AutomationPointEditOverlay({
  clipId,
  paramKey,
  pointIndex,
  valueMin,
  valueMax,
  lengthBeats,
  onClose
}: {
  clipId: string;
  paramKey: string;
  pointIndex: number;
  valueMin: number;
  valueMax: number;
  lengthBeats: number;
  onClose: () => void;
}) {
  const updateParamPoint = useAppStore((s) => s.timelineActions.updateParamPoint);
  const beat = useAppStore((s) => {
    const c = s.timeline.clips.find((cc) => cc.id === clipId);
    const v = c?.params?.[paramKey];
    return isAutomationCurve(v)
      ? (v as AutomationCurve<number>).points[pointIndex]?.beat ?? 0
      : 0;
  });
  const value = useAppStore((s) => {
    const c = s.timeline.clips.find((cc) => cc.id === clipId);
    const v = c?.params?.[paramKey];
    return isAutomationCurve(v)
      ? (v as AutomationCurve<number>).points[pointIndex]?.value ?? 0
      : 0;
  });

  const [beatDraft, setBeatDraft] = useState(String(beat));
  const [valueDraft, setValueDraft] = useState(String(value));
  const beatRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    beatRef.current?.focus();
    beatRef.current?.select();
  }, []);

  const commit = () => {
    const nb = Number(beatDraft);
    const nv = Number(valueDraft);
    const patch: { beat?: number; value?: number } = {};
    if (Number.isFinite(nb)) patch.beat = Math.max(0, Math.min(lengthBeats, nb));
    if (Number.isFinite(nv)) patch.value = Math.max(valueMin, Math.min(valueMax, nv));
    if (patch.beat !== undefined || patch.value !== undefined) {
      updateParamPoint(clipId, paramKey, pointIndex, patch);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit();
      onClose();
    } else if (e.key === 'Escape') {
      // Drop pending drafts.
      onClose();
    }
  };

  return (
    <div
      className="absolute z-50 flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 shadow-lg"
      role="dialog"
      aria-label="Edit automation point"
      style={{ top: 4, left: 88 }}
    >
      <label className="text-[10px] text-[var(--text-dim)]">
        Beat
        <input
          ref={beatRef}
          aria-label="Beat"
          type="number"
          step="0.0625"
          className="ml-1 w-16 bg-[var(--surface-3)] text-[var(--text)] rounded px-1 py-0.5 text-xs"
          value={beatDraft}
          onChange={(e) => setBeatDraft(e.target.value)}
          onBlur={() => {
            commit();
            onClose();
          }}
          onKeyDown={onKey}
        />
      </label>
      <label className="text-[10px] text-[var(--text-dim)]">
        Value
        <input
          aria-label="Value"
          type="number"
          step="0.01"
          className="ml-1 w-16 bg-[var(--surface-3)] text-[var(--text)] rounded px-1 py-0.5 text-xs"
          value={valueDraft}
          onChange={(e) => setValueDraft(e.target.value)}
          onBlur={() => {
            commit();
            onClose();
          }}
          onKeyDown={onKey}
        />
      </label>
    </div>
  );
}
```

> Two implementation notes baked in: (1) Input refs auto-focus + select-all on mount so the user can type immediately. (2) `onBlur` commits AND closes — this is what makes the "click another point" path work for free (the new double-click closes the previous overlay via `onClose`).

- [ ] **Step 4: Wire it in `AutomationLane.tsx`**

Add import:

```ts
import { useState } from 'react';
import { AutomationPointEditOverlay } from './AutomationPointEditOverlay';
```

Inside the component, add local state for the editing point:

```ts
const [editing, setEditing] = useState<{ key: string; index: number } | null>(null);
```

Pass an `onEdit` callback to every `PointDot`:

```tsx
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
  onEdit={setEditing}
/>
```

Below the `<svg>` block (but still inside the per-param `<div className="relative" ...>` lane container), conditionally render the overlay:

```tsx
{editing?.key === key && (
  <AutomationPointEditOverlay
    clipId={clipId}
    paramKey={key}
    pointIndex={editing.index}
    valueMin={schema.min}
    valueMax={schema.max}
    lengthBeats={clip.lengthBeats}
    onClose={() => setEditing(null)}
  />
)}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test -- EditOverlay --run`
Expected: 4 tests green.

- [ ] **Step 6: Run full suite + lint + typecheck**

Run: `npm test -- --run && npm run typecheck && npm run lint`

- [ ] **Step 7: Commit**

```bash
git add components/Workspace/Timeline/AutomationPointEditOverlay.tsx \
        components/Workspace/Timeline/AutomationLane.tsx \
        tests/unit/components/Timeline/EditOverlay.test.tsx
git commit -m "feat(timeline): double-click overlay for precise point editing"
```

---

## Task 6: Verification gate

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
- test: ≥ 355 tests green (Plan 5.6 final = 336; new in 5.7: 7 snap + 4 batch + 5 modifier + 2 lane snap-picker + 4 overlay = 22)
- build: studio page bundle within ~5% of Plan 5.6 baseline (~128 kB First Load)

- [ ] **Step 2: No commit. Proceed to smoke.**

---

## Task 7: Manual smoke gate

**Files:** none

- [ ] **Step 1: Run dev server**

```bash
npm run dev
```

- [ ] **Step 2: Walk the smoke checklist (from the plan header)**

Eight items:

1. Place a Pulse clip; ⚡-automate intensity; add 4 points spread across the clip.
2. Set Snap = `1/4` → drag a point → beat lands on 0.25 increments. Switch to `1/16` → finer snap.
3. Hold Ctrl while dragging → only Y moves; beat stays fixed.
4. Hold Shift while dragging point 2 → points 3 and 4 follow with the same delta. Point 1 stays.
5. Hold Shift + Ctrl → trailing points move only in Y.
6. Double-click point 3 → overlay opens with beat + value inputs preselected.
7. Type `5.5` in Beat, press Enter → point moves to beat 5.5. Open again → press Escape → closes without changes.
8. All Plan-5.5/5.6 behaviour unchanged: no-modifier drag, right-click delete, click-empty-area to add, Transition section still works on overlap.

- [ ] **Step 3: If anything fails — file the issue, fix, re-run gate.**

> Plan 5.7 complete. CC #2 final review per `docs/Tests/` QA prompt template.

---

## Risk + watchlist summary

| Risk | Where | Mitigation |
|---|---|---|
| Strict TS breaks the four existing `ui: { ... }` literals after adding `automationSnap` | listed in File map | Task 2 Step 6 grep + extend all four sites in one commit |
| `updateParamPoint` already re-sorts; the batch loop calls it once per update → O(N²) sorts per pointermove | `lib/store/timeline-slice.ts` | Acceptable for v0.1 (≤ 16 points). Document; revisit if profiling shows it matters |
| Modifier-key state captured at pointerdown would feel sticky | `AutomationPoint.tsx` | Read `ev.ctrlKey` / `ev.shiftKey` PER pointermove — held / released mid-drag is reflected immediately |
| Shift trailing-set drifts when points cross during drag | `AutomationPoint.tsx` | The trailing set is snapshotted ONCE at pointerdown. Drift is desired — followers move by the leader's effective delta, never re-evaluated |
| Edit overlay catches key events when typing values inside it; global Delete/Backspace shortcut in Workspace would remove the selected clip | `components/Workspace/index.tsx` Delete listener | Existing guard already short-circuits when `target.tagName === 'INPUT'` — overlay inputs are `<input>` so the existing guard covers them |
| Two overlays open if user double-clicks fast across points | `AutomationLane.tsx` | Local `editing` state is single-slot — second double-click overwrites the first; old overlay unmounts (its onBlur commits draft before close) |
| `automationSnap` accidentally persists across reloads | `lib/store/index.ts` partialize | The partialize block already writes only `ui: { zoom: state.ui.zoom }` — new field is naturally excluded. Step 4 just updates the comment |

## Out-of-plan items deferred

- Visual Y-axis zoom in the lane (precision via stretched value-range).
- Multi-select + group-drag (Shift-click extends selection, then drag the group).
- Keyboard nudging of focused / selected point.
- Snap-to-existing-point ("magnet" mode).
- Undo / redo of single + batch updates.

Plan 5.7 ends; Plan 6 (Export Pipeline) starts from a clean 5.7 baseline.
