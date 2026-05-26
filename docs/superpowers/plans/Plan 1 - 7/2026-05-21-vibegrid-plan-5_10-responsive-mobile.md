# VibeGrid Plan 5.10 — Responsive Mobile Layout

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project execution policy (overrides skill defaults):** direct-on-main, sequential, one commit per task. NO superpowers-subagent-ceremony — CC #1 implements straight.

---

## Context for the external reviewer

The post-Plan-5.9d baseline is the current `main` HEAD (commits up to and including the `fix(docs): consolidate KNOWN_LIMITATIONS` cleanup `147469b`). All gates green: typecheck, lint, **653 tests**, build clean.

Notable state from earlier plans that affects this plan:

1. **Desktop layout is locked.** All component layouts (TopBar, Stage, Timeline, Inspector, MediaLibrary) are sized for a `≥ 768 px` viewport with mouse + keyboard. Plan 5.10's hardest constraint is: **Desktop pixels do not move.** Every TSX change is a Tailwind class addition (`md:` Desktop-locked or unprefixed Mobile-first), never a re-flow of the Desktop tree.
2. **`@dnd-kit/core` is wired with `PointerSensor`** (`components/Workspace/Timeline/Tracks.tsx:5`). The library auto-handles `touch-action: none` on the draggable element it owns; no manual touch-action override is needed for drag-itself. Only the *scroll container* needs touch-action discipline (see Architecture Insight 3).
3. **Inspector → AutomationEditorModal is already fullscreen** (Plan 5.7-R) and works on Mobile out of the box. The AutomationLane inline-preview in Tracks.tsx is read-only and tiny — hidden on Mobile.
4. **Pointer Events everywhere** — no `onMouseDown`/`Move`/`Up` in the codebase (CLAUDE.md non-negotiable §3). Touch already works for everything except: (a) drag-and-drop from external palettes (needs `TouchSensor` activation delay), (b) pinch-to-zoom (no implementation yet).
5. **Selected clip + automation editor state** lives in `useAppStore.ui` (`selectedClipId`, `automationEditorClipId`). Mobile state (which mobile tab is active, drawer open/close) does NOT belong here — it's purely a layout concern. A separate slim slice keeps the persistent store clean.
6. **No Next.js Image component, no `next/font` mobile overrides** — Plan 5.10 is pure CSS + TSX; no Next.js config or layout-root touches beyond mounting the new Mobile components.

---

**Goal:** VibeGrid is fully usable on a modern smartphone (e.g. iPhone 15 / Pixel 8 in portrait). No horizontal page-scroll, no sub-44-px touch targets, no hidden interactive content, no functional regressions on Desktop.

**Architecture:** Seven surfaces, all additive — Desktop tree untouched.

1. **Breakpoint helper** (`lib/utils/breakpoints.ts`). `MOBILE_BREAKPOINT = 768`. `useIsMobile()` hook backed by `window.matchMedia('(max-width: 768px)')` with `addEventListener('change', …)` (universally stable since 2018; ResizeObserver-on-body anti-pattern from the prompt is dropped per architect-feedback Anm 5). SSR-safe: returns `false` on the server, syncs on hydration.

2. **Mobile-only Zustand slice** (`lib/store/mobile-ui-slice.ts`). Holds `mobileTab: 'timeline' | 'media' | 'fx'` plus its setter. Lives in `useAppStore` next to `ui` but in its own namespace so `partialize` skips it (Mobile UI state is transient — refreshing should not restore the last-opened tab). Bug 1 Fix from architect: state has a defined home; no prop-drilling or ad-hoc context needed.

3. **CSS-first layout switching** (Tailwind `md:` prefix). Initial paint is Mobile-first by default; Desktop variants use `md:` overrides. The `useIsMobile()` hook is reserved for *logic branching* (drawer open/close decisions, `useDndMonitor` integration) — never for CSS class toggling that would cause an SSR hydration flash. Bug 4 Fix from architect.

4. **Mobile components under `components/Mobile/`**:
   - `TabBar.tsx` — sticky bottom navigation (Timeline / Media / FX) showing only when `useIsMobile()` is true and disambiguated with `hidden md:hidden` for SSR safety.
   - `MediaDrawer.tsx` / `FXDrawer.tsx` — slide-up panels (60 vh) gated by `mobileTab`. FXDrawer's "Tap FX → add to track" opens an `FXTrackPickerDialog` when more than one FX track exists (Bug 2 Option C: no new `selectedTrackId` store state needed).
   - `FXTrackPickerDialog.tsx` — small modal listing all `'fx'`-kind tracks; the user picks the destination. With exactly one FX track, the dialog is skipped entirely and the clip is added directly.
   - `InspectorSheet.tsx` — bottom sheet (slide-up to 50 vh). `isOpen = selectedClipId !== null && isMobile && !isDragging` — `isDragging` from `useDndMonitor` so a touch-drag that starts on a clip doesn't pop the sheet (Anm 7 Fix).

5. **Touch-aware timeline** (`components/Workspace/Timeline/`). Track height grows from 32 px (Desktop) to 56 px (Mobile) for ≥ 44 px clip-tap targets. `touch-action: pan-x` is applied **only to the inner horizontal scroll viewport** (the clip-area div, NOT the outer Timeline container) so vertical track scrolling stays unaffected (Bug 3 Fix). Pinch-to-zoom is wired via `@use-gesture/react` (new dependency, 0-dep, tree-shakable) into a new `useTimelinePinchZoom` hook — out-of-scope to roll a custom multi-pointer tracker (Anm 8 Fix).

6. **AutomationLane mobile placement** — Inline preview is hidden via `hidden md:block`. A new `MobileAutomationButton` ("⚡ Open editor") appears in a small footer row below the clips area of every Track that has an automation curve, only on Mobile. Anm 9 Fix.

7. **Z-index discipline** (Anm 6 Fix). Tailwind utility classes only, no inline `style.zIndex`. Layering convention shipped in `lib/utils/z-index.ts` as named constants and referenced from every layered component:

   | Layer | Tailwind class | Constant |
   |---|---|---|
   | Canvas Stage | `z-10` | `Z_STAGE` |
   | Timeline | `z-20` | `Z_TIMELINE` |
   | Mobile TabBar | `z-30` | `Z_TABBAR` |
   | Drawer backdrop | `z-40` | `Z_DRAWER_BACKDROP` |
   | Drawer / Sheet panel | `z-50` | `Z_DRAWER_PANEL` |
   | Existing modals (`AutomationEditorModal`) | `z-60` | `Z_MODAL` |

**Tech Stack:** One new dependency — `@use-gesture/react` (5 kB gzipped, 0 deps). Everything else is Tailwind classes + React state + the existing `@dnd-kit/core` `TouchSensor`. No CSS file additions. No Next.js config changes.

---

## Architecture insights

### 1. Why Mobile UI state lives in a Zustand slice, not React Context

The prompt left `mobileTab` undefined as a state-location. A React Context with provider mounted at the studio-layout level works, but it requires every consumer (TabBar, MediaDrawer, FXDrawer, Timeline pinch-zoom touchpoint detection) to be inside the provider tree. A flat Zustand slice avoids the provider plumbing and matches how every other UI-state concern (`zoom`, `selectedClipId`, `flowMode`) is stored. Crucially: `partialize` in `lib/store/index.ts` already skips transient UI state — adding `mobileUI: undefined` to the partialize blocklist takes one line.

### 2. Why `useIsMobile` uses `matchMedia` and NOT `ResizeObserver`

`matchMedia('(max-width: 768px)').addEventListener('change', …)` ships universally since 2018, fires exactly at the breakpoint crossing, costs zero DOM observation overhead, and reports the correct dimension reference (`viewport`, not `document.body` — which `ResizeObserver` would have measured, and which differs from viewport when the iOS virtual keyboard is open). The prompt's ResizeObserver fallback is dropped (Anm 5).

```ts
// lib/utils/breakpoints.ts
export const MOBILE_BREAKPOINT = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false); // SSR-safe default
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}
```

### 3. Why `touch-action: pan-x` belongs on the INNER viewport, not the outer container

The Timeline component is two nested scroll planes:

```
<Timeline>                 // outer — vertical scroll (track list)
  <Ruler />                // sticky-top
  <Tracks>                 // → inner — horizontal scroll (clip area)
    <Track>                // each row
      <ClipArea />         // touch-action: pan-x lives HERE
    </Track>
  </Tracks>
</Timeline>
```

`touch-action: pan-x` on the OUTER container would lock vertical scrolling — a project with 6-8 audio + FX tracks couldn't be scrolled by finger. `touch-action: pan-x` on the INNER ClipArea lets the browser:
- Honour horizontal swipes inside ClipArea as horizontal scroll
- Pass vertical swipes that originated on ClipArea up to the outer scroll
- Defer to `@dnd-kit/core`'s internal `touch-action: none` on the draggable Clip element when a clip-drag is triggered (after 150 ms hold)

Bug 3 Fix.

### 4. Why FX-drop is a picker dialog, not an "active track" concept

Bug 2 from architect: there's no existing `selectedTrackId` in the store, and adding one would be a separate store-shape concern that could regress later plans. Option C (a dialog listing FX-tracks) sidesteps the store-change entirely:

- 1 FX track exists (the default): tap FX → clip added directly to that track. No dialog.
- ≥ 2 FX tracks exist (user added more lanes): tap FX → small `FXTrackPickerDialog` lists them by `track.name` → user taps a row → clip added there.

The dialog is a one-pass derivation from `useAppStore.timeline.tracks.filter(t => t.kind === 'fx' && !t.muted)`. No persistent state, no new store-shape, no future-plan tension.

### 5. Tap-vs-Drag resolution for InspectorSheet

The `TouchSensor` activation constraint (`delay: 150ms, tolerance: 8px`) handles the *drag start* gate. But the *inspector open* gate is separate: a user lifting a finger after a touch-down should open the Inspector only if no drag actually ran. Otherwise every drag pops the Inspector on touch-up.

The wiring (Anm 7 Fix):

```tsx
// lib/hooks/useInspectorSheet.ts
import { useDndMonitor } from '@dnd-kit/core';

export function useInspectorSheet(): { isOpen: boolean; close: () => void } {
  const isMobile = useIsMobile();
  const selectedClipId = useAppStore((s) => s.ui.selectedClipId);
  const setSelectedClipId = useAppStore((s) => s.setSelectedClipId);
  const [isDragging, setIsDragging] = useState(false);
  useDndMonitor({
    onDragStart: () => setIsDragging(true),
    onDragEnd: () => setIsDragging(false),
    onDragCancel: () => setIsDragging(false)
  });
  return {
    isOpen: selectedClipId !== null && isMobile && !isDragging,
    close: () => setSelectedClipId(null)
  };
}
```

`useDndMonitor` must be called *inside* a `DndContext`. The studio's layout already wraps with `DndContext` (Tracks.tsx); the InspectorSheet mounts *inside* that wrapper.

### 6. Pinch-zoom via `@use-gesture/react`

The prompt described pinch-zoom as a 3-line bullet but the reality is ~80 lines (two-pointer tracking, distance delta, scroll-pivot adjustment, gesture-vs-scroll conflict resolution). Rolling our own multi-pointer handler is out-of-scope for v0.1 and a known source of mobile-browser quirks (Safari's scale gesture is its own can of worms).

`@use-gesture/react` is 5 kB gzipped, has no transitive deps, is tree-shakable, and ships `usePinch()` that handles two-finger detection + scale-delta + pinch-center as a single hook call. The new dependency lands in `package.json` once and is consumed by `useTimelinePinchZoom`. Anm 8 Fix.

```ts
// lib/hooks/useTimelinePinchZoom.ts (sketch)
import { usePinch } from '@use-gesture/react';

export function useTimelinePinchZoom(targetRef: React.RefObject<HTMLElement>) {
  const setZoom = useAppStore((s) => s.setZoom);
  usePinch(
    ({ offset: [scale], origin }) => {
      const next = Math.max(0.25, Math.min(4, scale));
      setZoom(next);
      // Origin = pinch center; the Timeline's scrollLeft is
      // re-anchored so the pixel under the user's fingers stays
      // under their fingers across the zoom. Math identical to
      // mouse-wheel-zoom in the existing Toolbar.
    },
    { target: targetRef, scaleBounds: { min: 0.25, max: 4 }, preventDefault: true }
  );
}
```

Pinch target: the inner ClipArea div (same element that has `touch-action: pan-x`). `preventDefault: true` is necessary because pinch generates Safari's own `gesturestart` events; preventing them lets our handler win.

### 7. Why AutomationLane gets a button row, not an overlay

The prompt left "Open editor button placement" as a footnote ("AutomationLane ausgeblendet + Open editor Button anzeigen"). The architect flagged: where exactly? Three options:
- (a) In the Track-Header (where Mute/Label live) — clutter on a 56-px-tall row
- (b) Overlay on top of the clips — covers clip content, bad for taps
- (c) New tiny row beneath the clips — extra vertical space, but discoverable

Going with (c) (Anm 9 Fix). One 24-px row below each track's clip-area, visible only when `isMobile && trackHasAutomationClip`. Sums to ~80 px per automated track on Mobile (56 track + 24 button) vs ~32 px on Desktop — acceptable.

### 8. CSS-first layout switching avoids the hydration flash

`useIsMobile()` returns `false` during SSR. If the TabBar visibility were controlled by `isMobile && ...`, the first paint would show no TabBar; the post-hydration paint adds it; the user sees the TabBar pop in. On a real iPhone with a 100 ms hydration delay this is jarring.

Tailwind's `hidden md:hidden flex` (TabBar visible on Mobile, hidden on Desktop) is rendered by the server with the correct visibility for the user-agent's viewport via CSS media-query. No JS evaluation needed. Layout is correct from the first paint.

`useIsMobile()` is reserved for *behaviour* branching where CSS alone isn't sufficient: opening the InspectorSheet on clip-tap (needs JS to know it's Mobile), gating the pinch-zoom registration (only attach on Mobile), wiring the FX-track picker dialog. Anm 4 Fix.

---

## File map

| File | Action | Purpose |
|---|---|---|
| `package.json` / `package-lock.json` | modify | Add `@use-gesture/react` dependency. |
| `lib/utils/breakpoints.ts` | **CREATE** | `MOBILE_BREAKPOINT = 768` + `useIsMobile()` via `matchMedia`. |
| `lib/utils/z-index.ts` | **CREATE** | Named z-index constants (`Z_STAGE`, `Z_TIMELINE`, `Z_TABBAR`, `Z_DRAWER_BACKDROP`, `Z_DRAWER_PANEL`, `Z_MODAL`). |
| `lib/store/mobile-ui-slice.ts` | **CREATE** | Zustand slice with `mobileTab` + `setMobileTab`. |
| `lib/store/index.ts` | modify | Compose the slice into `useAppStore`; add `mobileUI: undefined` to `partialize`'s blocklist (transient state, never persisted). |
| `lib/store/types.ts` | modify | Extend `AppState` to include `mobileUI` slice + `mobileUIActions`. |
| `components/Mobile/TabBar.tsx` | **CREATE** | Sticky-bottom 3-tab nav for Mobile; `hidden md:hidden` for SSR safety. |
| `components/Mobile/MediaDrawer.tsx` | **CREATE** | Slide-up 60 vh panel; reuses existing `MediaLibrary` content. |
| `components/Mobile/FXDrawer.tsx` | **CREATE** | Slide-up 60 vh panel; 2-column FX grid; tap → adds clip via picker. |
| `components/Mobile/FXTrackPickerDialog.tsx` | **CREATE** | One-pass dialog listing all `'fx'`-kind tracks; auto-skipped when only one exists. |
| `components/Mobile/InspectorSheet.tsx` | **CREATE** | Bottom sheet (50 vh) wrapping the existing `Inspector` component. |
| `components/Mobile/MobileAutomationButton.tsx` | **CREATE** | "⚡ Open editor" button row that appears under tracks with automation, Mobile-only. |
| `lib/hooks/useInspectorSheet.ts` | **CREATE** | `isOpen = selectedClipId && isMobile && !isDragging` (via `useDndMonitor`). |
| `lib/hooks/useTimelinePinchZoom.ts` | **CREATE** | `usePinch` from `@use-gesture/react`; updates `timeline.zoom`. |
| `components/TopBar/index.tsx` | modify | Mobile variant — compact icons, 44 px touch targets. |
| `components/Workspace/Stage/index.tsx` | modify | `h-[40vh] md:h-full` Mobile-first. |
| `components/Workspace/Timeline/index.tsx` | modify | `touch-action: pan-x` on inner ClipArea div only; mount `useTimelinePinchZoom`. |
| `components/Workspace/Timeline/Track.tsx` | modify | `h-14 md:h-8` track-row; truncated label; bolt the `MobileAutomationButton` row beneath clip-area when track has automation. |
| `components/Workspace/Timeline/AutomationLane.tsx` | modify | `hidden md:block` — keep the preview on Desktop only. |
| `components/Workspace/MediaLibrary/index.tsx` | modify | Conditionally wrap content in `MediaDrawer` on Mobile (or render inline on Desktop). |
| `components/Workspace/FXLibrary/index.tsx` | modify | Same pattern as MediaLibrary. |
| `app/(studio)/layout.tsx` | modify | Mount `TabBar` + Mobile drawers + `InspectorSheet`; ensure `DndContext` wraps everything so `useDndMonitor` can fire. |
| `app/(studio)/page.tsx` (or wherever `DndContext` lives) | modify | Configure `useSensors` with `TouchSensor({ delay: 150, tolerance: 8 })` alongside the existing `PointerSensor`. |
| `tests/unit/utils/breakpoints.test.ts` | **CREATE** | ≥ 3 cases (`useIsMobile` at 1024, at 375, SSR-safe). |
| `tests/unit/components/Mobile/TabBar.test.tsx` | **CREATE** | ≥ 4 cases (renders on Mobile; **renders nothing on Desktop** — Anm 10 mandatory; tab switch updates `mobileTab`; ARIA active state). |
| `tests/unit/components/Mobile/InspectorSheet.test.tsx` | **CREATE** | ≥ 3 cases (opens on `selectedClipId + isMobile`; closes on null; `!isDragging` gate). |
| `tests/unit/components/Mobile/FXTrackPickerDialog.test.tsx` | **CREATE** | ≥ 2 cases (skipped when 1 FX track; renders all FX tracks when ≥ 2). |
| `tests/unit/hooks/useTimelinePinchZoom.test.ts` | **CREATE** | ≥ 3 cases (pinch-in reduces zoom; pinch-out increases zoom; zoom clamps to [0.25, 4]). |
| `tests/unit/store/mobile-ui-slice.test.ts` | **CREATE** | ≥ 2 cases (`setMobileTab` updates state; default is `'timeline'`). |
| `docs/KNOWN_LIMITATIONS.md` | modify | Append "Mobile (Plan 5.10)" section with: (a) virtual-keyboard layout-shift not yet handled, (b) Landscape orientation untested, (c) Capacitor build deferred to v0.2. |

---

## Tasks

### Task 0 — Baseline check

**No file changes.** Verifies the starting point.

- [ ] **Step 1 — Confirm baseline**

```powershell
git status                        # working tree clean (or only untracked .png/docs)
git log --oneline -1              # confirm starting HEAD
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Expected: typecheck/lint/build clean; record test count (baseline: **653**). Target after 5.10: ≥ baseline + **17** (i.e. ≥ 670).

---

### Task 1 — `useIsMobile` + `MOBILE_BREAKPOINT` + z-index constants

**Files:**
- Create: `lib/utils/breakpoints.ts`
- Create: `lib/utils/z-index.ts`
- Create (tests): `tests/unit/utils/breakpoints.test.ts`

- [ ] **Step 1 — Write failing tests**

```ts
// tests/unit/utils/breakpoints.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIsMobile, MOBILE_BREAKPOINT } from '@/lib/utils/breakpoints';

describe('useIsMobile', () => {
  let matchMediaMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    matchMediaMock = vi.fn().mockImplementation((q: string) => ({
      matches: q.includes(`max-width: ${MOBILE_BREAKPOINT}px`) ? false : false,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));
    Object.defineProperty(window, 'matchMedia', { writable: true, value: matchMediaMock });
  });

  it('returns false on a desktop viewport (1024 px)', () => {
    matchMediaMock.mockImplementation(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()
    }));
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('returns true on a mobile viewport (375 px)', () => {
    matchMediaMock.mockImplementation(() => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn()
    }));
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('returns false on SSR (no window) without throwing', () => {
    // useIsMobile must NOT touch window during the initial render so
    // Next.js server-rendering succeeds. The effect re-syncs after mount.
    const original = global.window;
    // @ts-expect-error — emulate server env
    delete global.window;
    expect(() => renderHook(() => useIsMobile())).not.toThrow();
    global.window = original;
  });
});
```

Run: FAIL — `useIsMobile` doesn't exist.

- [ ] **Step 2 — Implement `breakpoints.ts`**

```ts
// lib/utils/breakpoints.ts
'use client';
import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT = 768;

/**
 * Returns `true` when the viewport is at or below the mobile
 * breakpoint. Backed by `matchMedia('(max-width: 768px)')` with
 * native event subscription — universally supported since 2018.
 *
 * SSR-safe: returns `false` during server rendering (the effect
 * re-syncs on the first client mount). Components that need
 * SSR-correct visibility from the first paint should use Tailwind's
 * `md:` prefix in their class lists instead of branching on this hook.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}
```

- [ ] **Step 3 — Implement `z-index.ts`**

```ts
// lib/utils/z-index.ts
//
// Single source of truth for layered-element z-index. Tailwind
// utility classes (e.g. `z-30`) reference these constants in
// comments at the call site; do NOT use inline `style.zIndex`.
//
// Layer ordering (back → front):
//   10  Canvas Stage
//   20  Timeline
//   30  Mobile TabBar
//   40  Drawer backdrop (semi-transparent overlay behind sheet panels)
//   50  Drawer / InspectorSheet panel
//   60  Modals (e.g. AutomationEditorModal — pre-existing)
//
// When adding a new layered component, pick the closest constant
// or add a new one here with a one-line comment.

export const Z_STAGE = 10;
export const Z_TIMELINE = 20;
export const Z_TABBAR = 30;
export const Z_DRAWER_BACKDROP = 40;
export const Z_DRAWER_PANEL = 50;
export const Z_MODAL = 60;
```

- [ ] **Step 4 — Verify + commit**

```powershell
npm test -- --run tests/unit/utils/breakpoints.test.ts
npm run typecheck
git add lib/utils/breakpoints.ts lib/utils/z-index.ts tests/unit/utils/breakpoints.test.ts
git commit -m "feat(mobile): useIsMobile + MOBILE_BREAKPOINT + z-index constants"
```

---

### Task 2 — `useMobileUIStore` Zustand slice

**Files:**
- Create: `lib/store/mobile-ui-slice.ts`
- Modify: `lib/store/index.ts` — compose the slice + `partialize` skip.
- Modify: `lib/store/types.ts` — extend `AppState`.
- Create (tests): `tests/unit/store/mobile-ui-slice.test.ts`

- [ ] **Step 1 — Write failing tests**

```ts
// tests/unit/store/mobile-ui-slice.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';

beforeEach(() => {
  useAppStore.setState((s) => ({ mobileUI: { mobileTab: 'timeline' } }));
});

describe('mobile-ui slice (Plan 5.10)', () => {
  it('defaults mobileTab to "timeline"', () => {
    expect(useAppStore.getState().mobileUI.mobileTab).toBe('timeline');
  });
  it('setMobileTab updates the active tab', () => {
    useAppStore.getState().mobileUIActions.setMobileTab('fx');
    expect(useAppStore.getState().mobileUI.mobileTab).toBe('fx');
  });
});
```

- [ ] **Step 2 — Implement the slice + wire it in**

```ts
// lib/store/mobile-ui-slice.ts
import type { StateCreator } from 'zustand';
import type { AppState } from './types';

export type MobileTab = 'timeline' | 'media' | 'fx';

export interface MobileUIState {
  mobileTab: MobileTab;
}

export interface MobileUIActions {
  setMobileTab(tab: MobileTab): void;
}

export const initialMobileUIState: MobileUIState = {
  mobileTab: 'timeline'
};

export const createMobileUISlice: StateCreator<
  AppState, [], [],
  Pick<AppState, 'mobileUI' | 'mobileUIActions'>
> = (set) => ({
  mobileUI: initialMobileUIState,
  mobileUIActions: {
    setMobileTab: (mobileTab) => set((s) => ({ mobileUI: { ...s.mobileUI, mobileTab } }))
  }
});
```

Wire in `lib/store/index.ts`:
```ts
import { createMobileUISlice } from './mobile-ui-slice';
// ...inside create(persist(...)):
  ...createMobileUISlice(set, get, store)
// ...
// In partialize, exclude mobileUI from persistence:
partialize: (state) => ({
  ui: { zoom: state.ui.zoom },
  // mobileUI intentionally omitted — transient layout state,
  // refresh starts from default.
  timeline: { ...state.timeline, playhead: { ...state.timeline.playhead, playing: false } },
  audio: state.audio,
  media: state.media
})
```

Extend `lib/store/types.ts`:
```ts
import type { MobileUIState, MobileUIActions } from './mobile-ui-slice';

export interface AppState {
  // ...existing fields...
  mobileUI: MobileUIState;
  mobileUIActions: MobileUIActions;
}
```

- [ ] **Step 3 — Verify + commit**

```powershell
npm test -- --run tests/unit/store/mobile-ui-slice.test.ts
npm run typecheck
git add lib/store/mobile-ui-slice.ts lib/store/index.ts lib/store/types.ts tests/unit/store/mobile-ui-slice.test.ts
git commit -m "feat(mobile): useMobileUIStore — mobileTab slice, excluded from persistence"
```

---

### Task 3 — TabBar component

**Files:**
- Create: `components/Mobile/TabBar.tsx`
- Create (tests): `tests/unit/components/Mobile/TabBar.test.tsx`
- Modify: `app/(studio)/layout.tsx` — mount the TabBar.

- [ ] **Step 1 — Write failing tests (4 cases, includes Anm 10 invariant)**

```tsx
// tests/unit/components/Mobile/TabBar.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar } from '@/components/Mobile/TabBar';
import { useAppStore } from '@/lib/store';
import * as breakpoints from '@/lib/utils/breakpoints';

beforeEach(() => {
  useAppStore.setState((s) => ({ mobileUI: { mobileTab: 'timeline' } }));
});

describe('TabBar (Plan 5.10)', () => {
  it('renders three tab buttons on mobile', () => {
    vi.spyOn(breakpoints, 'useIsMobile').mockReturnValue(true);
    render(<TabBar />);
    expect(screen.getByRole('button', { name: /timeline/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /media/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^fx$/i })).toBeInTheDocument();
  });

  // Anm 10 — Desktop invariant. MUST be present.
  it('renders nothing on desktop', () => {
    vi.spyOn(breakpoints, 'useIsMobile').mockReturnValue(false);
    const { container } = render(<TabBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('tapping a tab updates store.mobileUI.mobileTab', () => {
    vi.spyOn(breakpoints, 'useIsMobile').mockReturnValue(true);
    render(<TabBar />);
    fireEvent.click(screen.getByRole('button', { name: /^fx$/i }));
    expect(useAppStore.getState().mobileUI.mobileTab).toBe('fx');
  });

  it('active tab has aria-pressed="true"', () => {
    vi.spyOn(breakpoints, 'useIsMobile').mockReturnValue(true);
    render(<TabBar />);
    const timelineBtn = screen.getByRole('button', { name: /timeline/i });
    expect(timelineBtn).toHaveAttribute('aria-pressed', 'true');
  });
});
```

- [ ] **Step 2 — Implement TabBar**

```tsx
// components/Mobile/TabBar.tsx
'use client';
import { useIsMobile } from '@/lib/utils/breakpoints';
import { useAppStore } from '@/lib/store';
import type { MobileTab } from '@/lib/store/mobile-ui-slice';

const TABS: Array<{ id: MobileTab; label: string; icon: string }> = [
  { id: 'timeline', label: 'Timeline', icon: '≡' },
  { id: 'media',    label: 'Media',    icon: '⊞' },
  { id: 'fx',       label: 'FX',       icon: '✦' }
];

export function TabBar() {
  const isMobile = useIsMobile();
  const active = useAppStore((s) => s.mobileUI.mobileTab);
  const setTab = useAppStore((s) => s.mobileUIActions.setMobileTab);
  if (!isMobile) return null;
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 h-12 flex bg-[var(--surface-1)] border-t border-[var(--border)] md:hidden"
      aria-label="Mobile navigation"
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={active === t.id}
          aria-label={t.label}
          onClick={() => setTab(t.id)}
          className={
            'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] uppercase tracking-wider ' +
            (active === t.id
              ? 'text-[var(--a1)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text)]')
          }
        >
          <span className="text-base leading-none">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
```

Mount in `app/(studio)/layout.tsx` (after the main content tree, before `</body>` semantically). One line; details in CC1's implementation.

- [ ] **Step 3 — Verify + commit**

```powershell
npm test -- --run tests/unit/components/Mobile/TabBar.test.tsx
npm run typecheck
git add components/Mobile/TabBar.tsx tests/unit/components/Mobile/TabBar.test.tsx app/\(studio\)/layout.tsx
git commit -m "feat(mobile): TabBar — sticky-bottom Mobile navigation"
```

---

### Task 4 — TopBar mobile variant

**Files:**
- Modify: `components/TopBar/index.tsx`
- Modify: child components in `components/TopBar/` as needed for 44 px icons / hidden labels.

- [ ] **Step 1 — Audit current TopBar layout**

Read `components/TopBar/index.tsx` and child components. Identify which elements need `md:` overrides and which can stay unconditional.

- [ ] **Step 2 — Apply Mobile-first Tailwind classes**

Pattern:
- Buttons: `h-11 w-11 md:h-7 md:w-auto md:px-3` — 44 px on Mobile, current sizing on Desktop.
- Labels: `hidden md:inline` next to icons.
- BPM badge: Mobile shows the number, Desktop shows "120 BPM" — same component, conditional label via `md:inline`.

No new components — just class additions on the existing tree.

- [ ] **Step 3 — Smoke verify**

```powershell
npm run dev
# Chrome DevTools → iPhone 15 Pro: every TopBar button is at least 44×44 px,
# no text overflow, Play button stays prominent.
# Desktop 1440px: TopBar visually identical to pre-5.10 (Anm: take a screenshot
# before this task for pixel-level diffing if needed).
```

- [ ] **Step 4 — Commit**

```powershell
git add components/TopBar/
git commit -m "feat(mobile): TopBar mobile variant — 44px touch targets + icon-only buttons"
```

---

### Task 5 — Stage 40 vh on mobile

**Files:**
- Modify: `components/Workspace/Stage/index.tsx`

- [ ] **Step 1 — Apply class**

The Stage component currently has a `flex-grow`-style container. Wrap with `h-[40vh] md:h-full md:flex-grow` on the outer div so Mobile gets a fixed 40 vh canvas slot while Desktop keeps the flex behaviour.

- [ ] **Step 2 — Verify Canvas DPR / ResizeObserver still works**

The existing `attachDprObserver` in `lib/renderer/dpr.ts` observes `canvas.width / height`. The class change is purely external sizing — DPR + draw logic untouched. Smoke-test by playing a project and verifying the canvas stays sharp at 40 vh.

- [ ] **Step 3 — Commit**

```powershell
git add components/Workspace/Stage/
git commit -m "feat(mobile): Stage 40vh on mobile, flex-grow on desktop"
```

---

### Task 6 — Timeline mobile (touch-action on inner viewport, 56 px tracks, AutomationLane hidden)

**Files:**
- Modify: `components/Workspace/Timeline/index.tsx` — outer container `overflow-y: auto`, inner ClipArea `touch-action: pan-x`.
- Modify: `components/Workspace/Timeline/Track.tsx` — `h-14 md:h-8` track-row, truncated label.
- Modify: `components/Workspace/Timeline/AutomationLane.tsx` — `hidden md:block`.
- Create: `components/Mobile/MobileAutomationButton.tsx` — "⚡ Open editor" trigger.

- [ ] **Step 1 — Apply class changes to Timeline + Track**

```tsx
// Timeline outer (vertical scroll, no touch-action override):
<div className="flex-1 overflow-y-auto overflow-x-hidden md:overflow-auto relative">

// Inner ClipArea (horizontal scroll, touch-action: pan-x):
<div className="flex-1 overflow-x-auto" style={{ touchAction: 'pan-x' }}>
```

```tsx
// Track row — taller on Mobile for ≥ 44 px tap target on the clip body.
<div className="h-14 md:h-8 flex items-center ...">
  <TrackHeader className="w-20 md:w-20 truncate" /> {/* label truncated */}
  <ClipArea ... />
</div>
```

- [ ] **Step 2 — Hide AutomationLane on Mobile + add `MobileAutomationButton`**

```tsx
// AutomationLane.tsx — top-level wrapper:
<div className="hidden md:block">
  {/* existing lane content */}
</div>
```

```tsx
// components/Mobile/MobileAutomationButton.tsx
'use client';
import { useAppStore } from '@/lib/store';

export function MobileAutomationButton({ clipId }: { clipId: string }) {
  const openEditor = useAppStore((s) => s.setAutomationEditorClipId);
  return (
    <button
      type="button"
      onClick={() => openEditor(clipId)}
      className="w-full h-6 text-[10px] uppercase tracking-wider text-[var(--a2)] hover:text-[var(--a1)] bg-[var(--surface-2)] border-t border-[var(--border)] md:hidden"
    >
      ⚡ Open editor
    </button>
  );
}
```

In `Track.tsx`, render the button below the clip-area row when the track has any clip carrying an automation curve:

```tsx
{isMobile && trackHasAutomation && <MobileAutomationButton clipId={firstAutomationClipId} />}
```

`trackHasAutomation` is a `useMemo` over `timeline.clips.filter(c => c.trackId === track.id).some(c => Object.values(c.params ?? {}).some(isAutomationCurve))`.

- [ ] **Step 3 — Verify + commit**

```powershell
npm run typecheck
npm test -- --run
git add components/Workspace/Timeline/ components/Mobile/MobileAutomationButton.tsx
git commit -m "feat(mobile): Timeline — 56px tracks + inner-viewport pan-x + AutomationLane hidden + Open editor button"
```

---

### Task 7 — MediaDrawer + FXDrawer + FXTrackPickerDialog

**Files:**
- Create: `components/Mobile/MediaDrawer.tsx`
- Create: `components/Mobile/FXDrawer.tsx`
- Create: `components/Mobile/FXTrackPickerDialog.tsx`
- Create (tests): `tests/unit/components/Mobile/FXTrackPickerDialog.test.tsx`
- Modify: `components/Workspace/MediaLibrary/index.tsx` — conditional wrapper.
- Modify: `components/Workspace/FXLibrary/index.tsx` — same.

- [ ] **Step 1 — Drawer skeleton (shared visual)**

Both drawers share a slide-up animation, a backdrop, and a drag-handle. Either factor out a `MobileDrawer` shell or copy-paste — at two call sites the copy is cheap. Use `MobileDrawer` as the helper:

```tsx
// components/Mobile/MobileDrawer.tsx (helper, not in File-Map but added here)
'use client';
import { Z_DRAWER_BACKDROP, Z_DRAWER_PANEL } from '@/lib/utils/z-index';

export function MobileDrawer({
  isOpen, onClose, children
}: { isOpen: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!isOpen) return null;
  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/50 md:hidden"
        style={{ zIndex: Z_DRAWER_BACKDROP }}
      />
      <div
        className="fixed inset-x-0 bottom-12 h-[60vh] bg-[var(--surface-1)] border-t border-[var(--border)] rounded-t-lg overflow-y-auto md:hidden"
        style={{ zIndex: Z_DRAWER_PANEL }}
      >
        <div className="h-1 w-12 mx-auto my-2 bg-[var(--border)] rounded-full" />
        {children}
      </div>
    </>
  );
}
```

(`bottom-12` so the drawer sits above the TabBar, which is `h-12` at `bottom-0`.)

- [ ] **Step 2 — Implement `MediaDrawer` + `FXDrawer`**

```tsx
// components/Mobile/MediaDrawer.tsx
'use client';
import { MobileDrawer } from './MobileDrawer';
import { MediaLibrary } from '@/components/Workspace/MediaLibrary';
import { useAppStore } from '@/lib/store';

export function MediaDrawer() {
  const tab = useAppStore((s) => s.mobileUI.mobileTab);
  const setTab = useAppStore((s) => s.mobileUIActions.setMobileTab);
  return (
    <MobileDrawer isOpen={tab === 'media'} onClose={() => setTab('timeline')}>
      <MediaLibrary />
    </MobileDrawer>
  );
}
```

```tsx
// components/Mobile/FXDrawer.tsx
'use client';
import { useState } from 'react';
import { MobileDrawer } from './MobileDrawer';
import { FXLibrary } from '@/components/Workspace/FXLibrary';
import { FXTrackPickerDialog } from './FXTrackPickerDialog';
import { useAppStore } from '@/lib/store';
import type { PluginFxKind } from '@/lib/timeline/plugin-mapping';

export function FXDrawer() {
  const tab = useAppStore((s) => s.mobileUI.mobileTab);
  const setTab = useAppStore((s) => s.mobileUIActions.setMobileTab);
  const [pickingFor, setPickingFor] = useState<PluginFxKind | null>(null);
  return (
    <>
      <MobileDrawer isOpen={tab === 'fx'} onClose={() => setTab('timeline')}>
        {/* FXLibrary on Mobile renders cards in a 2-col grid (CSS-only).
            Each card's `onTap` fires the picker with the plugin's kind. */}
        <FXLibrary onPickFx={(kind) => setPickingFor(kind)} />
      </MobileDrawer>
      {pickingFor && (
        <FXTrackPickerDialog
          pluginKind={pickingFor}
          onClose={() => setPickingFor(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3 — `FXTrackPickerDialog`**

```tsx
// components/Mobile/FXTrackPickerDialog.tsx
'use client';
import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { PLUGIN_KIND_TO_TRACK_KIND, type PluginFxKind } from '@/lib/timeline/plugin-mapping';
import { Z_MODAL } from '@/lib/utils/z-index';

export function FXTrackPickerDialog({
  pluginKind, onClose
}: { pluginKind: PluginFxKind; onClose: () => void }) {
  const fxTracks = useAppStore((s) => s.timeline.tracks.filter((t) => t.kind === 'fx' && !t.muted));
  const addClip = useAppStore((s) => s.timelineActions.addClip);
  const playhead = useAppStore((s) => s.timeline.playhead.beats);
  const clipKind = PLUGIN_KIND_TO_TRACK_KIND[pluginKind];

  // Auto-skip when only one FX track exists — drop the clip directly.
  useEffect(() => {
    if (fxTracks.length === 1) {
      addClip({
        id: crypto.randomUUID(),
        trackId: fxTracks[0].id,
        kind: clipKind,
        fxId: clipKind,
        startBeat: playhead,
        lengthBeats: 4,
        label: pluginKind
      });
      onClose();
    }
  }, [fxTracks, addClip, clipKind, playhead, pluginKind, onClose]);

  if (fxTracks.length <= 1) return null; // auto-skip path

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/60 md:hidden"
      style={{ zIndex: Z_MODAL }}
      onClick={onClose}
    >
      <div
        className="bg-[var(--surface-2)] rounded-lg p-4 w-72 max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-bold text-[var(--text)] mb-3">Add to which FX track?</h2>
        <ul className="space-y-2">
          {fxTracks.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 rounded bg-[var(--surface-3)] hover:bg-[var(--surface-1)] text-sm text-[var(--text)]"
                onClick={() => {
                  addClip({
                    id: crypto.randomUUID(),
                    trackId: t.id,
                    kind: clipKind,
                    fxId: clipKind,
                    startBeat: playhead,
                    lengthBeats: 4,
                    label: pluginKind
                  });
                  onClose();
                }}
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 4 — Tests for the picker**

```tsx
// tests/unit/components/Mobile/FXTrackPickerDialog.test.tsx
// ≥ 2 cases:
// - 1 FX track exists → dialog auto-skips, addClip called once with that track
// - 2+ FX tracks → dialog renders both rows, click on row N calls addClip with track N
```

- [ ] **Step 5 — Modify MediaLibrary / FXLibrary host components**

Both already exist on Desktop. The drawers reuse their content unchanged. The drawer wrapping decision lives in `app/(studio)/layout.tsx` (Task 9).

- [ ] **Step 6 — Commit**

```powershell
npm run typecheck
npm test -- --run
git add components/Mobile/MediaDrawer.tsx components/Mobile/FXDrawer.tsx components/Mobile/FXTrackPickerDialog.tsx components/Mobile/MobileDrawer.tsx components/Workspace/MediaLibrary/ components/Workspace/FXLibrary/ tests/unit/components/Mobile/FXTrackPickerDialog.test.tsx
git commit -m "feat(mobile): MediaDrawer + FXDrawer + FXTrackPickerDialog (auto-skip when 1 fx track)"
```

---

### Task 8 — InspectorSheet + tap-vs-drag resolution

**Files:**
- Create: `components/Mobile/InspectorSheet.tsx`
- Create: `lib/hooks/useInspectorSheet.ts`
- Create (tests): `tests/unit/components/Mobile/InspectorSheet.test.tsx`
- Modify: `app/(studio)/layout.tsx` — mount the sheet.

- [ ] **Step 1 — Write failing tests (3 cases)**

```tsx
// tests/unit/components/Mobile/InspectorSheet.test.tsx
// ≥ 3 cases:
// - opens when selectedClipId is set AND isMobile=true AND not dragging
// - closes (returns null) when setSelectedClipId(null) fires
// - does NOT open when isDragging=true even with selectedClipId set
// (mock useDndMonitor's isDragging via vi.spyOn on the hook export)
```

- [ ] **Step 2 — Implement the hook + sheet**

`lib/hooks/useInspectorSheet.ts` as sketched in Architecture Insight 5. The hook depends on being inside a `DndContext` — the test wraps with `<DndContext>` for the dragging gate to evaluate.

```tsx
// components/Mobile/InspectorSheet.tsx
'use client';
import { Inspector } from '@/components/Workspace/Inspector';
import { useInspectorSheet } from '@/lib/hooks/useInspectorSheet';
import { Z_DRAWER_BACKDROP, Z_DRAWER_PANEL } from '@/lib/utils/z-index';

export function InspectorSheet() {
  const { isOpen, close } = useInspectorSheet();
  if (!isOpen) return null;
  return (
    <>
      <div
        onClick={close}
        className="fixed inset-0 bg-black/50 md:hidden"
        style={{ zIndex: Z_DRAWER_BACKDROP }}
      />
      <div
        className="fixed inset-x-0 bottom-12 h-[50vh] bg-[var(--surface-1)] border-t border-[var(--border)] rounded-t-lg overflow-y-auto md:hidden"
        style={{ zIndex: Z_DRAWER_PANEL }}
      >
        <div className="h-1 w-12 mx-auto my-2 bg-[var(--border)] rounded-full" />
        <Inspector />
      </div>
    </>
  );
}
```

- [ ] **Step 3 — Verify + commit**

```powershell
npm run typecheck
npm test -- --run
git add components/Mobile/InspectorSheet.tsx lib/hooks/useInspectorSheet.ts tests/unit/components/Mobile/InspectorSheet.test.tsx app/\(studio\)/layout.tsx
git commit -m "feat(mobile): InspectorSheet — bottom sheet with tap-vs-drag resolution"
```

---

### Task 9 — TouchSensor + Pinch zoom + studio-layout mounting

**Files:**
- Modify: `package.json` — add `@use-gesture/react`.
- Create: `lib/hooks/useTimelinePinchZoom.ts`
- Create (tests): `tests/unit/hooks/useTimelinePinchZoom.test.ts`
- Modify: `app/(studio)/page.tsx` (or wherever `DndContext` lives) — configure `TouchSensor` alongside `PointerSensor`.
- Modify: `app/(studio)/layout.tsx` — mount `<TabBar />`, `<MediaDrawer />`, `<FXDrawer />`, `<InspectorSheet />`, all inside the existing `DndContext`.

- [ ] **Step 1 — Install dep**

```powershell
npm install @use-gesture/react
```

Commit lock-file together with the dependency change.

- [ ] **Step 2 — Implement `useTimelinePinchZoom` + tests**

```ts
// lib/hooks/useTimelinePinchZoom.ts
'use client';
import { usePinch } from '@use-gesture/react';
import { useAppStore } from '@/lib/store';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

export function useTimelinePinchZoom(targetRef: React.RefObject<HTMLElement>): void {
  const setZoom = useAppStore((s) => s.setZoom);
  usePinch(
    ({ offset: [scale] }) => {
      const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale));
      setZoom(clamped);
    },
    {
      target: targetRef,
      scaleBounds: { min: ZOOM_MIN, max: ZOOM_MAX },
      preventDefault: true
    }
  );
}
```

```ts
// tests/unit/hooks/useTimelinePinchZoom.test.ts
// ≥ 3 cases — mock @use-gesture's usePinch by passing a fake `onChange`
// handler in via vi.spyOn or vi.mock:
// - pinch-in (scale 0.5) reduces store.ui.zoom
// - pinch-out (scale 2.0) increases store.ui.zoom
// - scale 10 (out of bounds) clamps to ZOOM_MAX
```

- [ ] **Step 3 — Wire `TouchSensor`**

```tsx
// app/(studio)/page.tsx or DndContext mounting site:
import { PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';

const sensors = useSensors(
  useSensor(PointerSensor),
  useSensor(TouchSensor, {
    activationConstraint: {
      delay: 150,    // ms — gates drag-start; below this is treated as tap
      tolerance: 8   // px — small wobble allowed before drag activates
    }
  })
);
// Pass `sensors` to the existing <DndContext sensors={sensors}>.
```

- [ ] **Step 4 — Mount mobile chrome in layout**

```tsx
// app/(studio)/layout.tsx — pseudo-code, exact tree depends on existing layout:
<DndContext sensors={sensors}>
  <main>
    {/* existing desktop tree — unchanged */}
  </main>
  <TabBar />
  <MediaDrawer />
  <FXDrawer />
  <InspectorSheet />
</DndContext>
```

Order matters: `useDndMonitor` inside `useInspectorSheet` must be a descendant of `DndContext`, which it now is.

- [ ] **Step 5 — Verify + commit**

```powershell
npm run typecheck
npm run lint
npm test -- --run
npm run build
git add package.json package-lock.json lib/hooks/useTimelinePinchZoom.ts tests/unit/hooks/useTimelinePinchZoom.test.ts app/\(studio\)/
git commit -m "feat(mobile): TouchSensor (150ms delay) + pinch zoom + mobile chrome mounted"
```

---

### Task 10 — KNOWN_LIMITATIONS update

**Files:**
- Modify: `docs/KNOWN_LIMITATIONS.md`

- [ ] **Step 1 — Append the Mobile section**

```markdown
## Plan 5.10 — Responsive Mobile Layout

- **Virtual keyboard layout-shift not handled.** On iOS Safari the
  software keyboard opens upward and pushes the viewport — fixed-
  bottom elements (TabBar) end up under the keyboard. v0.2 with
  Capacitor will use the native keyboard API; in v0.1 the workaround
  is to dismiss the keyboard before interacting with bottom chrome.
- **Landscape orientation untested.** Smoke gate covers portrait
  iPhone 15 Pro (393 × 852). Landscape may produce a too-short
  Canvas (40 vh of 393 px = 157 px). v0.2 adds an orientation-lock
  hint or a landscape-specific layout.
- **Capacitor iOS/Android build is v0.2.** Plan 5.10 ships a
  responsive web layout only. The native shell, app-store packaging,
  push-notification permissions, and offline storage strategy are
  out of scope.
- **Tab-swipe-to-switch gestures are v0.2.** TabBar taps are the
  only switching path in v0.1.
- **`useDndMonitor` inside `useInspectorSheet` requires the hook to
  mount inside `<DndContext>`.** Documented here so a future
  refactor that moves the InspectorSheet outside the DnD provider
  doesn't silently break the tap-vs-drag resolution.
```

- [ ] **Step 2 — Commit**

```powershell
git add docs/KNOWN_LIMITATIONS.md
git commit -m "docs: KNOWN_LIMITATIONS — Plan 5.10 mobile layout notes"
```

---

## Verification Gate

Baseline: post-5.9d HEAD (653 tests).
Target: ≥ Baseline + **17** new cases (3 breakpoints + 4 TabBar + 3 InspectorSheet + 2 FXTrackPickerDialog + 3 useTimelinePinchZoom + 2 mobile-ui-slice). Bundle ≤ Baseline + 8 % (slack for `@use-gesture/react` ≈ 5 kB gzipped + Mobile component code).

```powershell
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

All four must be clean.

---

## Smoke Gate

After all tasks land:

```powershell
npm run dev
```

**Chrome DevTools → iPhone 15 Pro (393 × 852 px) viewport simulation:**

1. **TopBar:** Play button ≥ 44 px square. Export icon visible. BPM tap-to-edit. No horizontal overflow at 393 px.
2. **Canvas Stage:** 40 vh, sharp (DPR observer still active). Touching the canvas doesn't accidentally scroll the page.
3. **TabBar:** Three tabs visible at the bottom. Active tab in `--a1` color, inactive in `--text-muted`. Tab tap switches the content area.
4. **Timeline-Tab:** Inner clip area scrolls horizontally with one finger. Outer container scrolls vertically when more than ~3 tracks. Pinch-to-zoom on the inner area changes `timeline.zoom`. Clip drag activates after a ~150 ms hold (immediate tap does NOT drag).
5. **Clip tap:** opens the InspectorSheet (slide-up, 50 vh).
6. **Clip drag (long-press then move):** does NOT open the InspectorSheet (tap-vs-drag resolution working).
7. **Inspector sliders** (Volume on audio clip, FX-param sliders): respond to finger drag; the thumb stays at ≥ 44 px high.
8. **Media-Tab:** drawer slides up to 60 vh, MediaLibrary content readable.
9. **FX-Tab:** drawer slides up. With one FX track: tap an FX card → clip added immediately, no dialog. Add a second FX track via the desktop TabBar in another session, then on Mobile: tap an FX card → `FXTrackPickerDialog` opens listing both tracks.
10. **AutomationLane:** invisible on Mobile. On a track with an automation clip, the "⚡ Open editor" row beneath the clip-area is visible; tap opens the existing `AutomationEditorModal` fullscreen.

**Chrome DevTools → Desktop (1440 × 900 px):**

11. **Desktop layout is byte-identical to pre-5.10.** TabBar invisible. InspectorSheet invisible. Drawers don't exist. Mobile breakpoints fire `false` so all `md:` overrides take effect. Compare against a screenshot taken before Task 1 if available; otherwise visually verify every TopBar / Timeline / Inspector element renders in its pre-5.10 position.

Any failure on either viewport → STOP, investigate before merge.

---

## Risk Table

| Risk | Mitigation |
|---|---|
| `useIsMobile()` returning `false` during SSR causes hydration mismatch | CSS-first via Tailwind `md:` prefix for all visibility decisions (Anm 4). Hook is reserved for behaviour branching only. |
| `touch-action: pan-x` on the wrong scroll container breaks vertical track scrolling | Applied to inner ClipArea div only (Bug 3 + Architecture Insight 3). Outer Timeline keeps `overflow-y-auto`. dnd-kit handles `touch-action: none` on draggables internally. |
| `useDndMonitor` outside `DndContext` throws / returns stub values | InspectorSheet is mounted inside the existing `<DndContext>` wrapper in `app/(studio)/layout.tsx` (Task 9 explicit wiring). Documented in KNOWN_LIMITATIONS so a future refactor doesn't silently move it out. |
| `@use-gesture/react` browser-quirk on Safari (`gesturestart` events fight the handler) | `preventDefault: true` in the `usePinch` config — verified pattern from the library's own docs. Fallback if it manifests: feature-flag the pinch zoom and document the gap. |
| `mobileUI` slice accidentally persists to localStorage and breaks the "fresh start on refresh" UX | Explicit omission from `partialize` in `lib/store/index.ts`. Test in mobile-ui-slice.test.ts asserts the default `mobileTab === 'timeline'` after store rehydrate. |
| Desktop layout pixel-level regression hard to verify without a screenshot diff | Take screenshots of TopBar / Timeline / Inspector before Task 1. Compare visually after Task 9. If a pixel-level diff is wanted, add Playwright visual-regression snapshots in a follow-up task. |
| `FXTrackPickerDialog` auto-skip path fires before the user has interacted (1 FX track + user immediately taps an FX card) — addClip happens but the user expected a confirmation | Acceptable v0.1 UX: with one FX track, the destination is unambiguous. The "are you sure" friction is unnecessary. Toast feedback on add can be added in v0.2 if user-testing shows confusion. |
| Pinch-zoom origin not centred on touch midpoint → scroll-position jumps | `usePinch` reports the pinch origin via `origin` array. The hook in this plan does NOT yet re-anchor scroll position; behaviour is "zoom around current scrollLeft anchor". Documented in KNOWN_LIMITATIONS once verified during the smoke gate. If the jump is jarring, follow-up task adds scroll-anchor math. |

---

## Out of Scope

- **Capacitor iOS / Android packaging** (v0.2 — separate plan).
- **Tab-swipe-to-switch** (v0.2).
- **Mobile onboarding flows** (v0.2 — first-launch tour).
- **Portrait/landscape lock** (v0.2 — App Store requirement).
- **Virtual keyboard handling** (v0.2 — needs Capacitor for the native keyboard API; the v0.1 workaround is "dismiss keyboard first").
- **Pinch-zoom scroll-anchor math** (deferred — see Risk Table).
- **Visual-regression snapshots** for the Desktop-untouched invariant (Playwright snapshot test; deferred — manual smoke gate covers v0.1).

---

## Commit log (target)

```
feat(mobile): useIsMobile + MOBILE_BREAKPOINT + z-index constants
feat(mobile): useMobileUIStore — mobileTab slice, excluded from persistence
feat(mobile): TabBar — sticky-bottom Mobile navigation
feat(mobile): TopBar mobile variant — 44px touch targets + icon-only buttons
feat(mobile): Stage 40vh on mobile, flex-grow on desktop
feat(mobile): Timeline — 56px tracks + inner-viewport pan-x + AutomationLane hidden + Open editor button
feat(mobile): MediaDrawer + FXDrawer + FXTrackPickerDialog (auto-skip when 1 fx track)
feat(mobile): InspectorSheet — bottom sheet with tap-vs-drag resolution
feat(mobile): TouchSensor (150ms delay) + pinch zoom + mobile chrome mounted
docs: KNOWN_LIMITATIONS — Plan 5.10 mobile layout notes
```

10 commits. Baseline + 10 + buffer.

---

## Execution Notes (CC #1 hand-off)

- Tasks 1 + 2 establish the foundation (hook + state slice + z-index constants). Every later task imports from them; don't deviate from these names.
- Task 6 is the most subtle — getting `touch-action: pan-x` on the RIGHT element matters. Smoke-test the vertical scrolling on a real device (or a chrome-devtools touch emulation that supports both axes) before committing.
- Task 9 ties everything together — the mounting order in `layout.tsx` is load-bearing for `useDndMonitor`. Verify the InspectorSheet `isDragging` gate by actually dragging a clip in the smoke gate.
- Don't over-engineer the FXTrackPickerDialog. Its only job is "list tracks, tap one, addClip". No animations, no swipe-to-dismiss, no keyboard shortcuts.
- If any task fails verification (typecheck / lint / tests / build), STOP. Don't pile on fixes. Investigate root cause via `superpowers:systematic-debugging`.
- Smoke Gate Step 6 (clip drag does NOT open InspectorSheet) is the architect's flagged failure mode (Anm 7). Verify by hand.
