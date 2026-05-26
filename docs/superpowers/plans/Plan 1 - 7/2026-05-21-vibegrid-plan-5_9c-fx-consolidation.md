# VibeGrid Plan 5.9c — FX-Track Consolidation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project execution policy (overrides skill defaults):** direct-on-main, sequential, one commit per task. NO superpowers-subagent-ceremony — CC #1 implements straight.

---

## Context for the external reviewer

The post-Plan-5.9b baseline is the current `main` HEAD (commits up to and including the `fix(fx/contour): re-extract edge paths per video time-bucket` hotfix — `819b873` at time of writing). All gates green: typecheck, lint, 586 tests, build.

Notable state from 5.9a/b that affects this plan:

1. **`TrackKind`** today is a 10-entry union: `'image' | 'contour' | 'sweep' | 'pulse' | 'particles' | 'zoom-pulse' | 'text' | 'dissolve' | 'sunray' | 'audio' | 'video'`. Each FX has its own dedicated track-kind. `initialTimelineState` mounts ONE track per FX kind plus one image and one video track — 10 lanes total.
2. **`Clip.kind: TrackKind`** is used to distinguish clip types — for FX clips the value matches the track-kind (lowercase). Renderer's `RENDER_ORDER` is PascalCase (`'Contour' | 'ZoomPulse' | …`) because it dispatches plugins by their `plugin.kind`, which is PascalCase per `lib/renderer/types.ts:16`.
3. **Renderer loop** (`lib/renderer/loop.ts:225-307`) iterates `RENDER_ORDER` (PascalCase), maps each kind to its track-kind via `KIND_TO_TRACK_KIND` (lowercase keys), filters timeline tracks by that kind, asks `activeClipOnTrack(trackId, clips, beat)` per track. **One active clip per track per beat**, enforced by `addClip`'s `hasOverlap` check.
4. **`Tracks.tsx`** (drop routing) imports `PluginFxKind` from `@/lib/renderer/types` and uses `PLUGIN_TO_TRACK_KIND: Record<PluginFxKind, TrackKind>` (defined inline at `components/Workspace/Timeline/Tracks.tsx:31`) to pick the target track when a user drags an FX plugin badge onto the timeline. Today: one track per plugin kind → trivial 1:1 lookup.
5. **Store version = 5**, persisted to `localStorage` key `vibegrid-store`. Migration `v4 → v5` (`lib/store/index.ts:61-75`) sorts by deprecated `Track.order` then appends any missing default tracks. **This append-default-tracks logic is the silent landmine** for the v5 → v6 migration: if it runs on a v5 snapshot AFTER `initialTimelineState` shrinks to 4 lanes, it appends a fake "second image track" / "second video track" because `existingKinds.has('image')` is true but the IDs don't match. Plan 5.9c MUST gate this append-logic so it only fires for `version < 5`.
6. **`__blend` lifecycle** (`lib/timeline/blend-lifecycle.ts:12-40`) regenerates `params.__blend` per clip on a track based on `findIncomingOverlap`. Today there is no cross-kind check — `findIncomingOverlap` only returns same-track overlaps. With Multi-FX-Tracks this becomes a problem: a single FX track may carry two clips of different `clip.kind` (e.g. `contour` and `sweep`) that overlap in beats. The blend lifecycle must filter those out — cross-kind overlaps don't crossfade meaningfully — and ALSO delete any stale `__blend` left over from a move that broke a previous same-kind overlap.
7. **Plan 5.9b hotfixes** (commits `c722ca3` ZoomPulse-over-video and `819b873` Contour-bucket-cache) introduced `rc.imageBitmapKey` and per-tick video-frame snapshots. They are orthogonal to 5.9c — they don't touch the loop's outer iteration shape, they only affect the bitmap source per clip. 5.9c is free to refactor the outer iteration; the inner-loop body that consumes `rc.imageBitmap` / `rc.imageBitmapKey` stays byte-identical.

---

**Goal:** Collapse the eight per-FX-plugin tracks (Contour, Sweep, Pulse, Particles, Zoom-Pulse, Text, Dissolve, Sunray) into ONE generic `'fx'` track-kind that accepts any FX clip and permits overlap between clips of different `clip.kind`. Users can add multiple FX tracks (visual grouping / mute scopes) but a brand-new project starts with four lanes: Image / Video / Audio (stub) / one FX. Existing v5 projects migrate cleanly without losing clips.

**Architecture:** Five surfaces.

1. **Type collapse** (`lib/timeline/types.ts`). `TrackKind` shrinks to `'image' | 'video' | 'audio' | 'fx'`. `Clip.kind` keeps the full lowercase FX-kind vocabulary (`'contour' | 'sweep' | …`) so the renderer can still dispatch the right plugin per clip — that vocabulary moves to a new `TrackFxKind` type. The old `FxKind = Exclude<TrackKind, MediaTrackKind>` definition disappears; consumers (currently only `loop.ts:9`) re-import from `plugin-mapping.ts`.

2. **Plugin mapping module** (`lib/timeline/plugin-mapping.ts`, NEW). Single source of truth for everything that maps between PascalCase plugin-kinds (`'Contour'`, `'ZoomPulse'`, …) and lowercase clip/track kinds (`'contour'`, `'zoom-pulse'`, …). Hosts: `TRACK_FX_KINDS` (the 8-entry lowercase tuple), `RENDER_ORDER_TRACK_KIND` (the lowercase render order), `fxSortIndex(clipKind)`, `PLUGIN_KIND_TO_TRACK_KIND` (PascalCase → lowercase, ex-`KIND_TO_TRACK_KIND` from `loop.ts`), `TRACK_KIND_TO_PLUGIN_KIND` (inverse, used by the renderer to resolve plugins from clip-kind), `FX_DISPLAY_NAME` (UI labels), `FX_CLIP_COLORS` (clip-band colors). Renderer + Tracks.tsx + Clip.tsx + Inspector + track-validation all import from here — no more cross-layer imports of renderer types into timeline UI.

3. **Drop validation + addClip overlap gate** (`lib/timeline/track-validation.ts`, `lib/timeline/operations.ts`). `canDropOnTrack(clipKind, trackKind)` collapses to four cases: media-kinds match 1:1, FX-tracks accept any FX_KIND, anything else is `false`. `addClip` gets a new early gate before `hasOverlap`: on `'fx'`-kind tracks the overlap check is skipped entirely. The `hasOverlap` function signature stays unchanged — only its CALLERS in `addClip` change. `moveClip`/`resizeClip` keep their `excludeClipId` semantics — they too gain the FX-track skip-overlap gate.

4. **`__blend` cross-kind cleanup** (`lib/timeline/blend-lifecycle.ts`). `regenerateBlendsForTrack` adds a `incoming.kind !== c.kind` branch: cross-kind overlaps neither create nor preserve `__blend`. Stale entries on cross-kind get deleted. Same-kind overlap path unchanged.

5. **Renderer outer-loop refactor** (`lib/renderer/loop.ts`). The outer `for (const kind of RENDER_ORDER)` loop is replaced by a single iteration over `getActiveFxClips(tracks, clips, beats)` which returns `Array<{ clip; track }>` already sorted by `RENDER_ORDER_TRACK_KIND`. The inner-loop body — `lastFiredBeatGuard`, `computeClipAlpha`, the bitmap-skip gate, `resolveClipParams`, `try/catch` around `plugin.render` — stays **byte-identical**. Plugin lookup per clip uses `clip.fxId` first, else `listPluginsByKind(TRACK_KIND_TO_PLUGIN_KIND[clip.kind])[0]`. The image+video track loop above (lines ~185-218 in current `loop.ts`) is unchanged.

**Tech Stack:** No new dependencies. All work is TypeScript refactor + one store migration + one new test file per concern. UI changes are minimal label/color extensions.

---

## Architecture insights

### 1. Why one generic `'fx'` track-kind beats per-plugin tracks

Today every FX plugin has its own track-lane with `overlap forbidden` semantics. That makes the user model "one clip of THIS kind at a time on THIS lane", which works for early sketches but breaks fast: users can't layer two Sweeps on top of each other, can't quickly toggle whole groups of FX, and `initialTimelineState` grows unbounded as plugins get added.

Collapsing to one `'fx'` kind lets the user:
- drop multiple FX kinds on the same track (overlap permitted between e.g. `contour` and `sweep`),
- duplicate a track to A/B different FX sets with one click via track mute,
- start projects with a clean 4-lane skeleton instead of 10.

The trade-off is `addClip`'s overlap behaviour becomes track-kind-aware. That gate is one if-statement — cheap.

### 2. Why move FX mappings out of `lib/renderer/`

`components/Workspace/Timeline/Tracks.tsx:31` currently has its own `PLUGIN_TO_TRACK_KIND` because it can't import `KIND_TO_TRACK_KIND` from `lib/renderer/loop.ts` without dragging renderer concerns into a UI component. The constants are duplicated. New plugins like Sunray require updating both.

`lib/timeline/plugin-mapping.ts` is the natural home: it depends only on plain types. Both the renderer (server of plugin dispatch) and the UI (consumer of drop targeting + display names + colors) can import from here without inverting the dependency direction.

### 3. Why `RENDER_ORDER` stays in `loop.ts` (mostly)

The existing `RENDER_ORDER` constant in `loop.ts:44-53` is PascalCase and used today as the outer iteration key. After 5.9c the outer iteration moves to `getActiveFxClips`'s output (sorted by `RENDER_ORDER_TRACK_KIND`, lowercase). `RENDER_ORDER` itself is no longer needed for iteration — `KIND_TO_TRACK_KIND` (the PascalCase→lowercase map) likewise goes away because `getActiveFxClips` works directly in lowercase.

Both `RENDER_ORDER` and `KIND_TO_TRACK_KIND` in `loop.ts` can be deleted as part of Task 7. The replacement is a single import: `TRACK_KIND_TO_PLUGIN_KIND` from `plugin-mapping.ts` (for resolving the plugin instance per clip via `listPluginsByKind(TRACK_KIND_TO_PLUGIN_KIND[clip.kind])`).

### 4. Why the v5→v6 migration is two changes, not one

The visible change is renaming track-kinds: every track with `kind ∈ {contour, sweep, pulse, particles, zoom-pulse, text, dissolve, sunray}` becomes `kind: 'fx'`. Existing user-renamed `Track.name` values are preserved.

The invisible-but-critical change is gating the EXISTING `v4 → v5` append-default-tracks logic with `version < 5`. Today that logic runs for ALL `version < 5` snapshots — fine because `initialTimelineState` had all 10 lanes. After 5.9c, `initialTimelineState` has 4 lanes; the v4→v5 append must use a frozen `INITIAL_TRACKS_V5` snapshot to add the FX-per-kind tracks that v4 users expect, then v5→v6 rewrites those track-kinds to `'fx'`. Without the gate, a fresh v5 snapshot (e.g. user who installed last week) would get garbage "second image track" entries appended.

### 5. Why `__blend` cross-kind cleanup is its own task

`findIncomingOverlap` (`lib/timeline/overlap.ts`) returns the previous clip on the SAME track that overlaps the given clip's start range. Today same-track ⇒ same-kind because each track only holds one FX kind. After 5.9c that's no longer true.

`regenerateBlendsForTrack` is called from `addClip` / `moveClip` / `resizeClip` / `removeClip` and walks every clip on the affected track. With Multi-FX-Tracks, the walker sees clips of mixed `clip.kind`. Crossfading `contour` ↔ `sweep` makes no visual sense — `params.__blend` controls per-plugin parameter interpolation, and those plugins have disjoint parameter sets. The fix: when `incoming.kind !== c.kind`, treat it like "no incoming" — delete any existing `__blend`, return.

This must be a separate task because regenerateBlendsForTrack is touched by many existing tests and an unrelated change in the same commit would muddy the blame log.

### 6. Why the renderer refactor stays minimal

The prompt is explicit: the inner-loop body in `loop.ts` is byte-identical before and after. We're moving the OUTER iteration (kind → track → clip) into a helper, but the per-clip work (alpha, last-fired guard, plugin dispatch, try/catch, alpha restore) is the same code. This keeps the refactor reviewable as a structural change without behavioural risk. The new `tests/unit/renderer/fx-multi-clip.test.ts` verifies that two overlapping FX clips on one track both render in the right order; no existing renderer test changes.

### 7. Offline render — no eingriff nötig

`lib/export/offline-render.ts` invokes the same `tick()` machinery as the live preview via `makeOfflineRenderer` (`lib/renderer/offline-tick.ts`). Whatever the live renderer does, the offline render does too. Plan 5.9c's renderer changes propagate automatically. Documented as a no-op in KNOWN_LIMITATIONS in Task 11.

---

## File map

| File | Action | Purpose |
|---|---|---|
| `lib/timeline/plugin-mapping.ts` | **CREATE** | Single source of truth: `TRACK_FX_KINDS`, `RENDER_ORDER_TRACK_KIND`, `fxSortIndex`, `PLUGIN_KIND_TO_TRACK_KIND`, `TRACK_KIND_TO_PLUGIN_KIND`, `FX_DISPLAY_NAME`, `FX_CLIP_COLORS`. |
| `lib/timeline/types.ts` | modify | Shrink `TrackKind` to 4 entries; add `TrackFxKind`; delete `FxKind` (callers move to `plugin-mapping.ts`). |
| `lib/store/index.ts` | modify | Bump `version` 5 → 6; gate v4-append-logic with `version < 5`; add v5→v6 FX-kind rewrite. Frozen `INITIAL_TRACKS_V5` const. |
| `lib/store/timeline-slice.ts` | modify | `initialTimelineState` shrinks to 4 default tracks; `addTrack` rejects `'audio'` via toast (instead of throw); `defaultLabelFor('fx')` returns `'FX'` with `FX 2/3/…` counter. |
| `lib/timeline/track-validation.ts` | modify | `canDropOnTrack` collapses to 4 track-kind cases; uses `TRACK_FX_KINDS` from `plugin-mapping.ts`. |
| `lib/timeline/operations.ts` | modify | `addClip` (and `moveClip`/`resizeClip`) skip `hasOverlap` when target track-kind is `'fx'`. |
| `lib/timeline/blend-lifecycle.ts` | modify | `regenerateBlendsForTrack` treats cross-kind overlap as no-overlap (delete stale `__blend`). |
| `lib/timeline/selectors.ts` | modify | Add `getActiveFxClips(tracks, clips, beat)` selector returning `Array<{ clip; track }>` sorted by `RENDER_ORDER_TRACK_KIND`. |
| `lib/renderer/loop.ts` | modify | Outer loop replaced by single iteration over `getActiveFxClips`; inner body byte-identical. Delete local `RENDER_ORDER` + `KIND_TO_TRACK_KIND` constants; import `TRACK_KIND_TO_PLUGIN_KIND` from `plugin-mapping.ts`. |
| `components/Workspace/Timeline/Tracks.tsx` | modify | Drop-routing uses `canDropOnTrack` + `PLUGIN_KIND_TO_TRACK_KIND` from `plugin-mapping.ts`; remove the inline `PLUGIN_TO_TRACK_KIND` const. |
| `components/Workspace/Timeline/Clip.tsx` | modify | Extend `KIND_COLOR` with `FX_CLIP_COLORS` lookup for FX clip-kinds. |
| `components/Workspace/Timeline/AddTrackButton.tsx` | modify | `PICKER_OPTIONS` shrinks from 10 to 3 user-pickable kinds (Image / Video / FX); Audio still gated by the toast. |
| `components/Workspace/Inspector/index.tsx` | modify | Header reads `FX_DISPLAY_NAME[clip.kind]` for FX clips. |
| `tests/unit/timeline/track-validation.test.ts` | modify | Extend to ≥ 6 cases covering new lowercase FX_KINDS + `'fx'` track. |
| `tests/unit/timeline/overlap.test.ts` | **CREATE** | ≥ 4 cases for the new `addClip` FX-overlap-allowed behaviour. |
| `tests/unit/store/blend-lifecycle.test.ts` | modify | Add ≥ 1 case for cross-kind `__blend` cleanup. |
| `tests/unit/renderer/fx-multi-clip.test.ts` | **CREATE** | ≥ 5 cases for `getActiveFxClips` (gathering, sorting, mute filter, beat-window filter, multiple-clips-same-kind). |
| `tests/unit/store/migration-v5-v6.test.ts` | **CREATE** | ≥ 4 cases for v5→v6 (rename, no-op, no-append, full v4→v5→v6). Needs `tests/fixtures/timeline-v5.json` fixture. |
| `tests/fixtures/timeline-v5.json` | **CREATE** | Real v5 snapshot exported from a running project session. |
| `tests/unit/components/Timeline/AddTrackButton.test.tsx` | **CREATE** | ≥ 3 cases: 3 options visible, no Audio option, FX-click calls `addTrack('fx')`. |
| `docs/KNOWN_LIMITATIONS.md` | modify (or CREATE) | Append "Offline render: no separate code path; 5.9c renderer changes propagate automatically." |

---

## Tasks

### Task 0 — Baseline check

**No file changes.** Verifies the starting point.

- [ ] **Step 1 — Confirm baseline**

```powershell
git status                        # working tree clean
git log --oneline -1              # confirm starting commit
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Expected: typecheck/lint/build clean; record the test count (expected baseline: 586). Target after 5.9c: ≥ baseline + 22.

- [ ] **Step 2 — Prepare the v5 fixture path**

The v5 snapshot fixture lands in Task 3 (synthesised deterministically from `INITIAL_TRACKS_V5` + a handful of representative clips — no interactive dev-session needed). Just verify the target directory exists:

```powershell
mkdir -Force tests\fixtures
```

**No commit yet** — the fixture content lands together with Task 3.

---

### Task 1 — `plugin-mapping.ts` (single source of truth)

**Files:**
- Create: `lib/timeline/plugin-mapping.ts`
- Test: `tests/unit/timeline/plugin-mapping.test.ts` (CREATE)

- [ ] **Step 1 — Write the failing test**

```ts
// tests/unit/timeline/plugin-mapping.test.ts
import { describe, it, expect } from 'vitest';
import {
  TRACK_FX_KINDS,
  RENDER_ORDER_TRACK_KIND,
  fxSortIndex,
  PLUGIN_KIND_TO_TRACK_KIND,
  TRACK_KIND_TO_PLUGIN_KIND,
  FX_DISPLAY_NAME
} from '@/lib/timeline/plugin-mapping';

describe('plugin-mapping — FX kind constants & helpers', () => {
  it('TRACK_FX_KINDS contains exactly the 8 lowercase FX kinds', () => {
    expect([...TRACK_FX_KINDS].sort()).toEqual(
      ['contour', 'dissolve', 'particles', 'pulse', 'sunray', 'sweep', 'text', 'zoom-pulse']
    );
  });

  it('RENDER_ORDER_TRACK_KIND covers every FX kind exactly once', () => {
    const set = new Set(RENDER_ORDER_TRACK_KIND);
    expect(set.size).toBe(RENDER_ORDER_TRACK_KIND.length);
    for (const k of TRACK_FX_KINDS) expect(set.has(k)).toBe(true);
  });

  it('fxSortIndex returns the array position for known kinds', () => {
    expect(fxSortIndex('dissolve')).toBe(RENDER_ORDER_TRACK_KIND.indexOf('dissolve'));
    expect(fxSortIndex('text')).toBe(RENDER_ORDER_TRACK_KIND.indexOf('text'));
  });

  it('fxSortIndex returns length for unknown kinds (sorts last)', () => {
    expect(fxSortIndex('unknown-fx')).toBe(RENDER_ORDER_TRACK_KIND.length);
  });

  it('PLUGIN_KIND_TO_TRACK_KIND and TRACK_KIND_TO_PLUGIN_KIND are mutual inverses', () => {
    for (const plugin of Object.keys(PLUGIN_KIND_TO_TRACK_KIND)) {
      const track = PLUGIN_KIND_TO_TRACK_KIND[plugin as keyof typeof PLUGIN_KIND_TO_TRACK_KIND];
      expect(TRACK_KIND_TO_PLUGIN_KIND[track]).toBe(plugin);
    }
  });

  it('FX_DISPLAY_NAME has a label for every FX kind', () => {
    for (const k of TRACK_FX_KINDS) {
      expect(FX_DISPLAY_NAME[k]).toBeTypeOf('string');
      expect(FX_DISPLAY_NAME[k].length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2 — Run the test to confirm it fails**

```powershell
npm test -- --run tests/unit/timeline/plugin-mapping.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/timeline/plugin-mapping'".

- [ ] **Step 3 — Implement `plugin-mapping.ts`**

```ts
// lib/timeline/plugin-mapping.ts
//
// Single source of truth for everything that maps between PascalCase
// plugin-kinds (the FxPlugin.kind values registered with the renderer)
// and lowercase clip/track kinds (the value stored in clip.kind and
// formerly in track.kind). Anything that needs this mapping imports
// from here — renderer, drop-validation, Inspector display, Clip-band
// color, AddTrackButton picker labels.

/** The 8 lowercase FX-clip kinds. Stored on `clip.kind` for FX clips.
 *  In a v6+ store, no TRACK has `kind` from this list — tracks are
 *  `'fx'` and CLIPS carry the specific kind. */
export const TRACK_FX_KINDS = [
  'contour',
  'sweep',
  'pulse',
  'particles',
  'zoom-pulse',
  'text',
  'dissolve',
  'sunray'
] as const;

export type TrackFxKind = (typeof TRACK_FX_KINDS)[number];

/** Render order for FX clips (back-to-front, painter's algorithm).
 *  Dissolve manipulates the image directly, Contour/ZoomPulse are
 *  image-modifying overlays, Sweep/Particle/Pulse are flashes,
 *  Sunray is directional light, Text always on top. */
export const RENDER_ORDER_TRACK_KIND = [
  'dissolve',
  'contour',
  'zoom-pulse',
  'sweep',
  'particles',
  'pulse',
  'sunray',
  'text'
] as const satisfies readonly TrackFxKind[];

/** Lookup index — unknown kinds sort to the end. */
export function fxSortIndex(clipKind: string): number {
  const i = (RENDER_ORDER_TRACK_KIND as readonly string[]).indexOf(clipKind);
  return i === -1 ? RENDER_ORDER_TRACK_KIND.length : i;
}

/** PluginFxKind values — keep in sync with `FxPlugin.kind` literals
 *  registered via lib/fx/. PascalCase by convention. */
export type PluginFxKind =
  | 'Contour' | 'Sweep' | 'Pulse' | 'Particle'
  | 'ZoomPulse' | 'Text' | 'Dissolve' | 'Sunray';

/** PascalCase → lowercase. The Particles plugin is the only name
 *  asymmetry — singular plugin name, plural clip-kind. */
export const PLUGIN_KIND_TO_TRACK_KIND: Record<PluginFxKind, TrackFxKind> = {
  Contour: 'contour',
  Sweep: 'sweep',
  Pulse: 'pulse',
  Particle: 'particles',
  ZoomPulse: 'zoom-pulse',
  Text: 'text',
  Dissolve: 'dissolve',
  Sunray: 'sunray'
};

/** Inverse of PLUGIN_KIND_TO_TRACK_KIND — used by the renderer to
 *  resolve a plugin instance from a clip's lowercase kind. */
export const TRACK_KIND_TO_PLUGIN_KIND: Record<TrackFxKind, PluginFxKind> = {
  contour: 'Contour',
  sweep: 'Sweep',
  pulse: 'Pulse',
  particles: 'Particle',
  'zoom-pulse': 'ZoomPulse',
  text: 'Text',
  dissolve: 'Dissolve',
  sunray: 'Sunray'
};

/** Human-readable label shown in the Inspector header and clip-band. */
export const FX_DISPLAY_NAME: Record<TrackFxKind, string> = {
  contour: 'Contour',
  sweep: 'Color Sweep',
  pulse: 'Pulse',
  particles: 'Particles',
  'zoom-pulse': 'Zoom Pulse',
  text: 'Text',
  dissolve: 'Dissolve',
  sunray: 'Sunray'
};

/** Clip-band background color in the Timeline UI. Keep contrast vs
 *  the surface-3 hover background. */
export const FX_CLIP_COLORS: Record<TrackFxKind, string> = {
  contour: 'var(--a1)',
  sweep: '#e05a7a',
  pulse: '#7a6a3a',
  'zoom-pulse': '#3a6a7a',
  particles: 'var(--a3)',
  text: '#6a3a7a',
  dissolve: '#3a5a3a',
  sunray: '#7a6a1a'
};
```

- [ ] **Step 4 — Run the test to confirm it passes**

```powershell
npm test -- --run tests/unit/timeline/plugin-mapping.test.ts
```

Expected: PASS, all 6 cases green.

- [ ] **Step 5 — Run full suite + typecheck to confirm no regression**

```powershell
npm run typecheck
npm test -- --run
```

- [ ] **Step 6 — Commit**

```powershell
git add lib/timeline/plugin-mapping.ts tests/unit/timeline/plugin-mapping.test.ts
git commit -m "feat(timeline): plugin-mapping.ts — single source of truth for FX kind mappings"
```

---

### Task 2 — `TrackKind` simplification + `TrackFxKind` type re-export

**Files:**
- Modify: `lib/timeline/types.ts`
- Modify: `lib/renderer/loop.ts` (line 9 import migration)

This task is **type-level only**. No runtime behaviour changes. The store-persisted shapes still carry the old `TrackKind` values until Task 3 runs the migration; v6 snapshots will have `track.kind === 'fx'`. TypeScript is happy because `TrackKind` is now the union `'image' | 'video' | 'audio' | 'fx'` which covers v6 shapes; v5 in-memory state with `track.kind === 'contour'` would type-error if we tried to assign it post-migration but that path doesn't exist (migration writes `'fx'`).

- [ ] **Step 1 — Edit `lib/timeline/types.ts`**

```ts
// lib/timeline/types.ts — REPLACE the top of the file:
//
// (delete the existing TrackKind union, MediaTrackKind, FxKind. Re-export
//  TrackFxKind from plugin-mapping so existing consumers can keep their
//  imports stable.)

export type TrackKind = 'image' | 'video' | 'audio' | 'fx';

/** Media-bearing kinds (carry their own media reference). */
export type MediaTrackKind = 'image' | 'audio' | 'video';

// FxKind is GONE. Old callers (loop.ts) import TrackFxKind from
// plugin-mapping.ts. Re-exported here for code that already imports
// from this module.
export type { TrackFxKind } from './plugin-mapping';
```

The rest of `types.ts` (Track, Clip, PlayheadState, etc.) is unchanged. `Clip.kind` keeps its type as `TrackKind` but VALUES at runtime for FX clips remain the lowercase TrackFxKind strings. Type-wise this is OK — the strings `'contour'`, `'sweep'`, etc. are NOT in `TrackKind`'s union anymore. We accept this with one of:

  (a) Widen `Clip.kind` to `TrackKind | TrackFxKind` — the truthful type.
  (b) Keep `Clip.kind: TrackKind` and let consumers narrow via `clip.kind === 'fx'` won't actually appear on FX clips.

Choose **(a)** — the truthful type. Without it, the renderer's switch on `clip.kind` becomes a series of `as TrackFxKind` casts.

```ts
// lib/timeline/types.ts — Clip interface:
export interface Clip {
  id: string;
  trackId: string;
  kind: TrackKind | TrackFxKind;
  startBeat: number;
  lengthBeats: number;
  mediaId?: string;
  fxId?: string;
  params?: Record<string, unknown>;
  trigger?: TriggerMode;
  label: string;
}
```

- [ ] **Step 2 — Migrate `lib/renderer/loop.ts:9` import**

```ts
// lib/renderer/loop.ts — top of file:
// BEFORE:
import type { FxKind as TrackFxKind, TimelineState } from '@/lib/timeline/types';
// AFTER:
import type { TrackFxKind } from '@/lib/timeline/plugin-mapping';
import type { TimelineState } from '@/lib/timeline/types';
```

Also delete the local `RENDER_ORDER` and `KIND_TO_TRACK_KIND` constants in `loop.ts` (lines ~44-70 in current file). They're no longer used — Task 7 wires the renderer to `RENDER_ORDER_TRACK_KIND` and `TRACK_KIND_TO_PLUGIN_KIND` from `plugin-mapping.ts`. Leaving them in place until Task 7 is fine; deleting now is cleaner. Pick one and be consistent.

  Recommendation: **delete now**, replace the outer-loop iteration with a stub `// TODO Task 7` that throws if reached. Subsequent tasks will fail-noisy if they accidentally depend on the old constants. Concretely, replace the entire `for (const kind of RENDER_ORDER) { … }` block (lines ~225-307) with:

```ts
    // TODO Plan 5.9c Task 7 — replace with getActiveFxClips iteration.
    // Temporary no-op so typecheck passes while Task 2 lands.
```

This means FX rendering is broken between Task 2 and Task 7. That's acceptable because: (1) the live preview still renders image+video — only FX overlays go dark, (2) tests for the renderer's FX path get fixed in Task 7. The user smoke-tests at the END of the plan, not between tasks.

  Alternative: keep `RENDER_ORDER`/`KIND_TO_TRACK_KIND` until Task 7. Less rigorous; risks the imports drifting.

- [ ] **Step 3 — Run typecheck to verify no callers break**

```powershell
npm run typecheck
```

Expected: clean. If any file imports `FxKind` from `@/lib/timeline/types`, the typecheck will list them — migrate each one to `import type { TrackFxKind } from '@/lib/timeline/plugin-mapping'`.

- [ ] **Step 4 — Run tests**

```powershell
npm test -- --run
```

Expected: existing tests still pass for non-renderer code; renderer FX tests may now fail because of the stub'd loop body. That's expected — Task 7 fixes them.

Record the test count and list which renderer tests went red. They should be ONLY:
- `tests/unit/renderer/fx-multi-clip.test.ts` (doesn't exist yet)
- any existing test that asserts FX plugin `render` was called

If image/video/audio tests fail, something else is wrong — STOP and investigate before committing.

- [ ] **Step 5 — Commit**

```powershell
git add lib/timeline/types.ts lib/renderer/loop.ts
git commit -m "feat(timeline): TrackKind = 'image'|'video'|'audio'|'fx', migrate FxKind import"
```

---

### Task 3 — Store migration v5 → v6 + v4-append-gate

**Files:**
- Modify: `lib/store/index.ts`
- Create: `tests/unit/store/migration-v5-v6.test.ts`
- Create: `tests/fixtures/timeline-v5.json` (from Task 0 Step 2)
- Modify: `lib/store/timeline-slice.ts` (extract `INITIAL_TRACKS_V5` frozen const)

- [ ] **Step 1 — Freeze the v4-era initial tracks**

```ts
// lib/store/timeline-slice.ts — ADD at module top, near initialTimelineState:

/** Frozen copy of the v4-era 10-track default. Used by the v4 → v5
 *  migration to append tracks missing from old snapshots. After 5.9c
 *  `initialTimelineState.tracks` shrinks to 4; without a frozen
 *  reference the migration would lose the FX-per-kind tracks v4 users
 *  expect to be appended. */
export const INITIAL_TRACKS_V5 = Object.freeze([
  { id: 'track-image', kind: 'image', name: 'Image', muted: false, order: 0 },
  { id: 'track-contour', kind: 'contour', name: 'Contour', muted: false, order: 1 },
  { id: 'track-zoom-pulse', kind: 'zoom-pulse', name: 'Zoom Pulse', muted: false, order: 2 },
  { id: 'track-sweep', kind: 'sweep', name: 'Sweep', muted: false, order: 3 },
  { id: 'track-particles', kind: 'particles', name: 'Particles', muted: false, order: 4 },
  { id: 'track-pulse', kind: 'pulse', name: 'Pulse', muted: false, order: 5 },
  { id: 'track-dissolve', kind: 'dissolve', name: 'Dissolve', muted: false, order: 6 },
  { id: 'track-sunray', kind: 'sunray', name: 'Sunray', muted: false, order: 7 },
  { id: 'track-text', kind: 'text', name: 'Text', muted: false, order: 8 },
  { id: 'track-video', kind: 'video', name: 'Video', muted: false, order: 9 }
] as const);
```

Keep `initialTimelineState` unchanged for now — Task 4 shrinks it to 4 lanes.

- [ ] **Step 2 — Write the migration tests**

```ts
// tests/unit/store/migration-v5-v6.test.ts
import { describe, it, expect } from 'vitest';
import { migrate } from '@/lib/store/index'; // see Step 3 — export `migrate` standalone for testability
import v5Fixture from '../../fixtures/timeline-v5.json';

const FX_KINDS_V5 = new Set(['contour', 'sweep', 'pulse', 'particles', 'zoom-pulse', 'text', 'dissolve', 'sunray']);

describe('store migration v5 → v6', () => {
  it('rewrites every FX-kind track to kind:"fx"; preserves track.name and clips', () => {
    const fixture = JSON.parse(JSON.stringify(v5Fixture));
    const result = migrate(fixture.state, 5);
    const tracks = (result as any).timeline.tracks;
    for (const t of tracks) {
      expect(['image', 'video', 'audio', 'fx']).toContain(t.kind);
    }
    // Every previously-FX track stays in array order, name preserved.
    const fxTracks = tracks.filter((t: any) => t.kind === 'fx');
    expect(fxTracks.length).toBeGreaterThan(0);
    // Clips unchanged.
    expect((result as any).timeline.clips).toEqual(fixture.state.timeline.clips);
  });

  it('does NOT append any default tracks when migrating v5 → v6 (append-gate works)', () => {
    const fixture = JSON.parse(JSON.stringify(v5Fixture));
    const trackCountBefore = fixture.state.timeline.tracks.length;
    const result = migrate(fixture.state, 5);
    const trackCountAfter = (result as any).timeline.tracks.length;
    expect(trackCountAfter).toBe(trackCountBefore);
  });

  it('full v4 → v5 → v6: appends INITIAL_TRACKS_V5 missing entries, then rewrites FX-kinds', () => {
    // Synthetic v4 with only the image track + one user-renamed Contour.
    const v4 = {
      timeline: {
        tracks: [
          { id: 'track-image', kind: 'image', name: 'Image', muted: false, order: 0 },
          { id: 'track-contour', kind: 'contour', name: 'My Contour', muted: false, order: 1 }
        ],
        clips: [],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      }
    };
    const result = migrate(JSON.parse(JSON.stringify(v4)), 4);
    const tracks = (result as any).timeline.tracks;
    // Append-logic added the 8 missing INITIAL_TRACKS_V5 entries (after sorting).
    expect(tracks.length).toBe(10);
    // The renamed Contour kept its name AND now has kind:'fx'.
    const contour = tracks.find((t: any) => t.name === 'My Contour');
    expect(contour).toBeDefined();
    expect(contour!.kind).toBe('fx');
  });

  it('is a no-op on a snapshot that already has only image/video/audio/fx tracks', () => {
    const v6Shape = {
      timeline: {
        tracks: [
          { id: 'track-image', kind: 'image', name: 'Image', muted: false },
          { id: 'track-fx-1', kind: 'fx', name: 'FX', muted: false }
        ],
        clips: [],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      }
    };
    const result = migrate(JSON.parse(JSON.stringify(v6Shape)), 5);
    expect((result as any).timeline.tracks).toHaveLength(2);
  });
});
```

Run: `npm test -- --run tests/unit/store/migration-v5-v6.test.ts`
Expected: FAIL — `migrate` not exported standalone, FX-kind rewrite not implemented.

- [ ] **Step 3 — Refactor `lib/store/index.ts`: extract `migrate`, add v5→v6**

```ts
// lib/store/index.ts — replace the inline migrate option:

import { initialTimelineState, INITIAL_TRACKS_V5 } from './timeline-slice';
import { TRACK_FX_KINDS } from '@/lib/timeline/plugin-mapping';
import type { Track } from '@/lib/timeline/types';

const FX_KIND_SET = new Set<string>(TRACK_FX_KINDS);

export function migrate(persistedState: unknown, version: number): unknown {
  const s = persistedState as { timeline?: { tracks?: Track[] } } | null;
  if (!s?.timeline) return s;

  // v4 → v5: legacy order-sort + append missing default tracks.
  // GATED so it only fires for genuine v4 snapshots — a fresh v5
  // snapshot must NOT trigger the append (else `initialTimelineState`'s
  // shrunken 4-lane shape after 5.9c would add ghost lanes).
  if (version < 5) {
    const existing: Track[] = Array.isArray(s.timeline.tracks) ? s.timeline.tracks : [];
    existing.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const existingKinds = new Set(existing.map((t) => t.kind));
    const missing = (INITIAL_TRACKS_V5 as readonly Track[]).filter(
      (t) => !existingKinds.has(t.kind)
    );
    s.timeline.tracks = [...existing, ...missing];
  }

  // v5 → v6: rewrite every FX-kind track to kind:'fx'. Track.name and
  // Track.id preserved (user-renamed lanes survive). Clips are
  // untouched — `clip.kind` already holds the lowercase FX-kind that
  // the renderer consumes for plugin dispatch.
  if (version < 6) {
    s.timeline.tracks = (s.timeline.tracks ?? []).map((t) =>
      FX_KIND_SET.has(t.kind) ? { ...t, kind: 'fx' as Track['kind'] } : t
    );
  }

  return s;
}

// In the persist({ ... migrate: ... }) config:
migrate: (persistedState, version) => migrate(persistedState, version),
version: 6,
```

- [ ] **Step 4 — Run the migration tests**

```powershell
npm test -- --run tests/unit/store/migration-v5-v6.test.ts
```

Expected: PASS, 4 cases green.

- [ ] **Step 5 — Run full suite**

```powershell
npm test -- --run
```

Expected: all existing tests still pass. If `tests/unit/store/migration-v5.test.ts` exists (Plan 5.9a) and now fails because it expects the OLD inline-migrate behaviour, update its imports to use the new exported `migrate` function. Same logic test, just refactored import.

- [ ] **Step 6 — Document the fixture contract**

Create `tests/fixtures/README.md` if absent:

```markdown
# Test fixtures

These JSON files are **frozen snapshots** of persisted state shapes.
Any change to the store schema (adding/removing fields, changing
`version`, renaming kinds) MUST update both the fixture AND the
matching migration tests in the same commit. Don't regenerate a
fixture just because a migration broke — the fixture is the
authoritative record of what real v_N data looked like.

- `timeline-v5.json` — v5 store shape (per Plan 5.9c Task 3). Used
  by `tests/unit/store/migration-v5-v6.test.ts`.
```

- [ ] **Step 7 — Commit**

```powershell
git add lib/store/index.ts lib/store/timeline-slice.ts tests/unit/store/migration-v5-v6.test.ts tests/fixtures/timeline-v5.json tests/fixtures/README.md
git commit -m "feat(store): migration v5→v6 (FX tracks → kind:fx) + gate v4→v5 append"
```

---

### Task 4 — `initialTimelineState` (4 default lanes) + `addTrack` overhaul

**Files:**
- Modify: `lib/store/timeline-slice.ts`
- Modify (tests): `tests/unit/store/timeline-slice.test.ts`

- [ ] **Step 1 — Write the failing tests**

Extend `tests/unit/store/timeline-slice.test.ts`:

```ts
// tests/unit/store/timeline-slice.test.ts — ADD these cases:

it('initialTimelineState has exactly 4 lanes: image, video, audio, fx', () => {
  expect(initialTimelineState.tracks.map((t) => t.kind))
    .toEqual(['image', 'video', 'audio', 'fx']);
});

it('addTrack("fx") with no existing FX tracks → name "FX"', () => {
  // Use a fresh store. The exact API depends on how timeline-slice is tested
  // elsewhere — match the existing pattern in this file.
  const store = makeFreshStore();
  store.getState().timelineActions.addTrack('fx');
  const fxTracks = store.getState().timeline.tracks.filter((t) => t.kind === 'fx');
  // 1 default + 1 new = 2 FX tracks total.
  expect(fxTracks).toHaveLength(2);
  expect(fxTracks[1].name).toBe('FX 2');
});

it('addTrack("fx") with one existing FX → name "FX 2"', () => { /* as above */ });
it('addTrack("fx") repeated → "FX 2", "FX 3", "FX 4"', () => { /* as above */ });

it('addTrack("audio") shows a toast and does not add a track', () => {
  const store = makeFreshStore();
  const before = store.getState().timeline.tracks.length;
  // Replace the previous `throw` expectation with toast assertion.
  // The toast library is `sonner`; this test stubs `toast.error` via vi.spyOn.
  // ...
  store.getState().timelineActions.addTrack('audio');
  expect(store.getState().timeline.tracks.length).toBe(before);
  expect(toastError).toHaveBeenCalledWith(
    expect.stringContaining('Multi-Audio')
  );
});
```

Note: there's also a question of whether `'audio'` should be in `initialTimelineState`. Decision per the prompt's W2 snippet: YES, include `'audio'` as a STUB default track (UI shows the lane, addTrack rejects adding a second one until 5.9d). The test above reflects that.

Run: `npm test -- --run tests/unit/store/timeline-slice.test.ts`
Expected: FAIL.

- [ ] **Step 2 — Shrink `initialTimelineState` to 4 lanes**

```ts
// lib/store/timeline-slice.ts — REPLACE initialTimelineState.tracks:

export const initialTimelineState: TimelineState = {
  tracks: [
    { id: 'track-image', kind: 'image', name: 'Image', muted: false },
    { id: 'track-video', kind: 'video', name: 'Video', muted: false },
    { id: 'track-audio', kind: 'audio', name: 'Audio', muted: false },
    { id: 'track-fx-1', kind: 'fx',    name: 'FX',    muted: false }
  ],
  clips: [],
  playhead: { beats: 0, playing: false },
  zoom: 1,
  snap: 'beat'
};
```

Note: `Track.order` is gone — it's deprecated per `lib/timeline/types.ts:37-41`. Array position drives render order. Don't add it back.

- [ ] **Step 3 — Rewrite `addTrack` action**

```ts
// lib/store/timeline-slice.ts — REPLACE the existing addTrack:

addTrack: (kind, label) => {
  if (kind === 'audio') {
    // Soft-reject instead of throw — better UX. Multi-Audio comes in 5.9d.
    toast.error('Multi-Audio-Tracks: kommt mit Plan 5.9d');
    return;
  }
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const existing = get().timeline.tracks.filter((t) => t.kind === kind);
  // First of its kind → base name ("FX", "Image", "Video"). N-th → "FX 2", "FX 3", …
  const baseName = defaultLabelFor(kind);
  const finalLabel = label ?? (existing.length === 0 ? baseName : `${baseName} ${existing.length + 1}`);
  set((s) => ({
    timeline: {
      ...s.timeline,
      tracks: [...s.timeline.tracks, { id, kind, name: finalLabel, muted: false }]
    }
  }));
}
```

Also update `defaultLabelFor` (or wherever it lives in this file) to handle `'fx'`:

```ts
function defaultLabelFor(kind: TrackKind): string {
  switch (kind) {
    case 'image': return 'Image';
    case 'video': return 'Video';
    case 'audio': return 'Audio';
    case 'fx':    return 'FX';
  }
}
```

- [ ] **Step 4 — Run tests**

```powershell
npm test -- --run tests/unit/store/timeline-slice.test.ts
npm test -- --run    # full suite — migration tests should still pass
```

Expected: PASS. The full suite should show 4+ new passes; any older test asserting "9 default tracks exist" or similar must be updated. Most likely candidates: `tests/unit/store/timeline-slice.test.ts` itself.

- [ ] **Step 5 — Commit**

```powershell
git add lib/store/timeline-slice.ts tests/unit/store/timeline-slice.test.ts
git commit -m "feat(store): initialTimelineState 4 lanes + addTrack FX-counter + audio-stub toast"
```

---

### Task 5 — `canDropOnTrack` + `addClip` FX-overlap gate

**Files:**
- Modify: `lib/timeline/track-validation.ts`
- Modify: `lib/timeline/operations.ts`
- Modify (tests): `tests/unit/timeline/track-validation.test.ts`
- Create (tests): `tests/unit/timeline/overlap.test.ts`

- [ ] **Step 1 — Extend validation tests**

```ts
// tests/unit/timeline/track-validation.test.ts — ADD:

import { canDropOnTrack } from '@/lib/timeline/track-validation';

describe('canDropOnTrack — Plan 5.9c FX consolidation', () => {
  it('contour clip → fx track: true', () => {
    expect(canDropOnTrack('contour', 'fx')).toBe(true);
  });
  it('zoom-pulse clip (hyphenated lowercase) → fx track: true', () => {
    expect(canDropOnTrack('zoom-pulse', 'fx')).toBe(true);
  });
  it('image clip → fx track: false', () => {
    expect(canDropOnTrack('image', 'fx')).toBe(false);
  });
  it('contour clip → image track: false', () => {
    expect(canDropOnTrack('contour', 'image')).toBe(false);
  });
  it('video clip → video track: true', () => {
    expect(canDropOnTrack('video', 'video')).toBe(true);
  });
  it('audio clip → audio track: true', () => {
    expect(canDropOnTrack('audio', 'audio')).toBe(true);
  });
});
```

Run: `npm test -- --run tests/unit/timeline/track-validation.test.ts`
Expected: FAIL for the new cases (the existing function still operates on the old per-FX TrackKind values).

- [ ] **Step 2 — Rewrite `canDropOnTrack`**

```ts
// lib/timeline/track-validation.ts — REPLACE:

import type { TrackKind } from '@/lib/timeline/types';
import { TRACK_FX_KINDS } from '@/lib/timeline/plugin-mapping';

const FX_KIND_SET = new Set<string>(TRACK_FX_KINDS);

export function canDropOnTrack(clipKind: string, trackKind: TrackKind): boolean {
  switch (trackKind) {
    case 'image': return clipKind === 'image';
    case 'video': return clipKind === 'video';
    case 'audio': return clipKind === 'audio';
    case 'fx':    return FX_KIND_SET.has(clipKind);
    default:      return false;
  }
}
```

- [ ] **Step 3 — Add the overlap test file**

```ts
// tests/unit/timeline/overlap.test.ts — NEW:

import { describe, it, expect } from 'vitest';
import { addClip, moveClip } from '@/lib/timeline/operations';
import type { TimelineState } from '@/lib/timeline/types';

function emptyFxState(): TimelineState {
  return {
    tracks: [{ id: 'fx-1', kind: 'fx', name: 'FX', muted: false }],
    clips: [],
    playhead: { beats: 0, playing: false },
    zoom: 1,
    snap: 'beat'
  };
}

function imageState(): TimelineState {
  return {
    tracks: [{ id: 'image-1', kind: 'image', name: 'Image', muted: false }],
    clips: [],
    playhead: { beats: 0, playing: false },
    zoom: 1,
    snap: 'beat'
  };
}

describe('addClip — Plan 5.9c overlap behaviour', () => {
  it('fx track: two overlapping FX clips → both kept', () => {
    let state = emptyFxState();
    state = addClip(state, { id: 'c1', trackId: 'fx-1', kind: 'contour', startBeat: 0, lengthBeats: 8, label: 'c' });
    state = addClip(state, { id: 'c2', trackId: 'fx-1', kind: 'sweep',   startBeat: 4, lengthBeats: 8, label: 's' });
    expect(state.clips).toHaveLength(2);
  });

  it('image track: overlap rejected (existing behaviour preserved)', () => {
    let state = imageState();
    state = addClip(state, { id: 'i1', trackId: 'image-1', kind: 'image', startBeat: 0, lengthBeats: 8, label: 'a' });
    const before = state.clips.length;
    state = addClip(state, { id: 'i2', trackId: 'image-1', kind: 'image', startBeat: 4, lengthBeats: 8, label: 'b' });
    expect(state.clips.length).toBe(before); // unchanged
  });

  it('moveClip on fx track: self-overlap excluded (excludeClipId works)', () => {
    let state = emptyFxState();
    state = addClip(state, { id: 'c1', trackId: 'fx-1', kind: 'contour', startBeat: 0, lengthBeats: 8, label: 'c' });
    // Move to a position that would overlap itself if excludeClipId wasn't honored:
    state = moveClip(state, 'c1', 4);
    expect(state.clips.find((c) => c.id === 'c1')!.startBeat).toBe(4);
  });

  it('addClip rejected when target track does not exist', () => {
    let state = emptyFxState();
    const before = state.clips.length;
    state = addClip(state, { id: 'x', trackId: 'NO-SUCH-TRACK', kind: 'contour', startBeat: 0, lengthBeats: 8, label: 'x' });
    expect(state.clips.length).toBe(before);
  });
});
```

Run: `npm test -- --run tests/unit/timeline/overlap.test.ts`
Expected: FAIL — `addClip` still rejects all overlaps.

- [ ] **Step 4 — Add the FX-track skip-overlap gate in `operations.ts`**

```ts
// lib/timeline/operations.ts — `addClip`:

export function addClip(state: TimelineState, clip: Clip): TimelineState {
  const track = state.tracks.find((t) => t.id === clip.trackId);
  if (!track) return state;

  // Plan 5.9c — FX tracks permit clip overlap. Other track-kinds keep
  // the legacy "one clip per beat" invariant via hasOverlap.
  if (track.kind !== 'fx') {
    if (hasOverlap(state, clip.trackId, clip.startBeat, clip.lengthBeats)) {
      // Existing toast/log call site — keep it.
      return state;
    }
  }

  return { ...state, clips: [...state.clips, clip] };
}
```

Apply the same gate to `moveClip` and `resizeClip`. Their `excludeClipId` semantics are unchanged for non-FX tracks; for FX tracks the overlap check is skipped entirely so excludeClipId becomes a no-op there (still safe — just dead code).

- [ ] **Step 5 — Run tests**

```powershell
npm test -- --run tests/unit/timeline/overlap.test.ts
npm test -- --run tests/unit/timeline/track-validation.test.ts
npm test -- --run    # full suite
```

Expected: all PASS.

- [ ] **Step 6 — Commit**

```powershell
git add lib/timeline/track-validation.ts lib/timeline/operations.ts tests/unit/timeline/track-validation.test.ts tests/unit/timeline/overlap.test.ts
git commit -m "feat(timeline): canDropOnTrack + addClip overlap gate for fx-kind tracks"
```

---

### Task 6 — `__blend` cross-kind cleanup

**Files:**
- Modify: `lib/timeline/blend-lifecycle.ts`
- Modify (tests): `tests/unit/store/blend-lifecycle.test.ts`

- [ ] **Step 1 — Add the failing cross-kind test**

```ts
// tests/unit/store/blend-lifecycle.test.ts — ADD case:

it('cross-kind overlap on the same fx track: existing __blend is removed', () => {
  // Setup: two clips of different kinds on one fx track, overlapping.
  // The earlier clip carries a stale `__blend` from a previous same-kind
  // overlap that has since been moved away.
  const initial: TimelineState = {
    tracks: [{ id: 'fx-1', kind: 'fx', name: 'FX', muted: false }],
    clips: [
      {
        id: 'c1',
        trackId: 'fx-1',
        kind: 'contour',
        startBeat: 0,
        lengthBeats: 8,
        label: 'contour',
        params: { __blend: { type: 'curve', interpolation: 'linear', points: [[0, 0], [4, 1]] } }
      },
      {
        id: 'c2',
        trackId: 'fx-1',
        kind: 'sweep',
        startBeat: 4,
        lengthBeats: 8,
        label: 'sweep'
      }
    ],
    playhead: { beats: 0, playing: false },
    zoom: 1,
    snap: 'beat'
  };
  const result = regenerateBlendsForTrack(initial, 'fx-1');
  const c1 = result.clips.find((c) => c.id === 'c1')!;
  expect(c1.params).toBeDefined();
  expect(c1.params!.__blend).toBeUndefined();
});
```

Run: `npm test -- --run tests/unit/store/blend-lifecycle.test.ts`
Expected: FAIL — current code regenerates `__blend` regardless of kind.

- [ ] **Step 2 — Patch `regenerateBlendsForTrack`**

```ts
// lib/timeline/blend-lifecycle.ts — modify the loop body:

const nextClips = state.clips.map((c) => {
  if (c.trackId !== trackId) return c;
  const incoming = findIncomingOverlap(state, c.id);
  const existingParams = c.params ?? {};
  const existingBlend = existingParams[BLEND_KEY];
  const previousInterp: Interpolation =
    isAutomationCurve(existingBlend)
      ? (existingBlend as AutomationCurve<number>).interpolation
      : 'linear';

  // Plan 5.9c — cross-kind overlaps don't crossfade meaningfully.
  // Treat them like "no incoming": delete any stale __blend, return.
  if (!incoming || incoming.kind !== c.kind) {
    if (!(BLEND_KEY in existingParams)) return c;
    const nextParams: Record<string, unknown> = { ...existingParams };
    delete nextParams[BLEND_KEY];
    return { ...c, params: nextParams };
  }

  const range = overlapRange(incoming, c);
  if (!range) return c;
  const nextBlend = makeDefaultBlend(range[0], range[1], previousInterp);
  return { ...c, params: { ...existingParams, [BLEND_KEY]: nextBlend } };
});
```

- [ ] **Step 3 — Run tests**

```powershell
npm test -- --run tests/unit/store/blend-lifecycle.test.ts
npm test -- --run    # full suite
```

Expected: PASS. Existing same-kind blend tests must remain green — the new branch only intercepts the cross-kind case.

- [ ] **Step 4 — Commit**

```powershell
git add lib/timeline/blend-lifecycle.ts tests/unit/store/blend-lifecycle.test.ts
git commit -m "fix(timeline): regenerateBlendsForTrack drops __blend on cross-kind overlap"
```

---

### Task 7 — Renderer outer-loop refactor (`getActiveFxClips`)

**Files:**
- Modify: `lib/timeline/selectors.ts`
- Modify: `lib/renderer/loop.ts`
- Create: `tests/unit/renderer/fx-multi-clip.test.ts`

- [ ] **Step 1 — Write the selector test**

```ts
// tests/unit/renderer/fx-multi-clip.test.ts — NEW:

import { describe, it, expect } from 'vitest';
import { getActiveFxClips } from '@/lib/timeline/selectors';
import type { Clip, Track } from '@/lib/timeline/types';

const clip = (over: Partial<Clip>): Clip => ({
  id: 'x', trackId: 'fx-1', kind: 'contour', startBeat: 0, lengthBeats: 8, label: 'x', ...over
});

const fx = (over: Partial<Track>): Track => ({
  id: 'fx-1', kind: 'fx', name: 'FX', muted: false, ...over
});

describe('getActiveFxClips — Plan 5.9c selector', () => {
  it('returns all active FX clips across multiple FX tracks', () => {
    const tracks = [fx({ id: 'fx-1' }), fx({ id: 'fx-2', name: 'FX 2' })];
    const clips = [
      clip({ id: 'a', trackId: 'fx-1', kind: 'contour' }),
      clip({ id: 'b', trackId: 'fx-2', kind: 'sweep' })
    ];
    const out = getActiveFxClips(tracks, clips, 4);
    expect(out.map((x) => x.clip.id).sort()).toEqual(['a', 'b']);
  });

  it('sorts by RENDER_ORDER_TRACK_KIND (dissolve before text)', () => {
    const tracks = [fx({ id: 'fx-1' })];
    const clips = [
      clip({ id: 'late',  trackId: 'fx-1', kind: 'text' }),
      clip({ id: 'early', trackId: 'fx-1', kind: 'dissolve' })
    ];
    const out = getActiveFxClips(tracks, clips, 4);
    expect(out.map((x) => x.clip.id)).toEqual(['early', 'late']);
  });

  it('skips muted FX tracks', () => {
    const tracks = [fx({ id: 'fx-1', muted: true })];
    const clips = [clip({ id: 'a', trackId: 'fx-1', kind: 'contour' })];
    expect(getActiveFxClips(tracks, clips, 4)).toHaveLength(0);
  });

  it('respects the beat window (clip outside range excluded)', () => {
    const tracks = [fx({ id: 'fx-1' })];
    const clips = [clip({ id: 'a', trackId: 'fx-1', startBeat: 0, lengthBeats: 4 })];
    expect(getActiveFxClips(tracks, clips, 5)).toHaveLength(0);
  });

  it('two clips of the same kind on the same fx track: both returned', () => {
    const tracks = [fx({ id: 'fx-1' })];
    const clips = [
      clip({ id: 'a', trackId: 'fx-1', kind: 'particles', startBeat: 0, lengthBeats: 8 }),
      clip({ id: 'b', trackId: 'fx-1', kind: 'particles', startBeat: 4, lengthBeats: 8 })
    ];
    const out = getActiveFxClips(tracks, clips, 5);
    expect(out).toHaveLength(2);
  });
});
```

Run: FAIL — `getActiveFxClips` doesn't exist.

- [ ] **Step 2 — Add the selector**

```ts
// lib/timeline/selectors.ts — APPEND:

import { fxSortIndex } from './plugin-mapping';
import type { Clip, Track } from './types';

/** Plan 5.9c — gather every active FX clip across all FX tracks, in
 *  render order. The renderer's outer iteration used to walk
 *  RENDER_ORDER × tracks; after FX-track consolidation a single fx
 *  track can carry multiple clip kinds, so we flatten and sort by
 *  clip.kind via plugin-mapping's RENDER_ORDER_TRACK_KIND. */
export function getActiveFxClips(
  tracks: Track[],
  clips: Clip[],
  beat: number
): Array<{ clip: Clip; track: Track }> {
  const out: Array<{ clip: Clip; track: Track }> = [];
  for (const track of tracks) {
    if (track.kind !== 'fx' || track.muted) continue;
    for (const c of clips) {
      if (c.trackId !== track.id) continue;
      if (beat < c.startBeat) continue;
      if (beat >= c.startBeat + c.lengthBeats) continue;
      out.push({ clip: c, track });
    }
  }
  out.sort((a, b) => fxSortIndex(String(a.clip.kind)) - fxSortIndex(String(b.clip.kind)));
  return out;
}
```

Run: `npm test -- --run tests/unit/renderer/fx-multi-clip.test.ts`
Expected: PASS.

- [ ] **Step 3 — Wire the renderer**

```ts
// lib/renderer/loop.ts — REPLACE the Task-2 stub at line ~225 with:

import { getActiveFxClips } from '@/lib/timeline/selectors';
import { TRACK_KIND_TO_PLUGIN_KIND, type TrackFxKind } from '@/lib/timeline/plugin-mapping';
// A3 verified: lib/renderer/registry.ts exports `listPluginsByKind(kind: FxKind)`
// where FxKind is the renderer's own PascalCase union — structurally identical
// to plugin-mapping's PluginFxKind, so the call site below type-checks.

// (later in tick(), after the image+video draw block:)

const imageBitmap = firstImageBitmap;
const activeFxClips = getActiveFxClips(timeline.tracks, timeline.clips, beats);

for (const { clip } of activeFxClips) {
  // Plugin resolution: explicit fxId wins, else look up the default
  // plugin instance registered for this clip.kind's PascalCase.
  const pluginKind = TRACK_KIND_TO_PLUGIN_KIND[clip.kind as TrackFxKind];
  const plugin: FxPlugin<unknown> | undefined =
    (clip.fxId ? getPlugin(clip.fxId) : undefined) ?? listPluginsByKind(pluginKind)[0];
  if (!plugin) continue;

  // Contour reads rc.imageBitmap for Canny edges; ZoomPulse re-draws
  // the bitmap with a scale transform. Both require a bitmap. Pulse,
  // Sweep, Particle paint pure overlays and work on a black canvas.
  if ((plugin.kind === 'Contour' || plugin.kind === 'ZoomPulse') && !imageBitmap) continue;

  const guard = lastFiredBeatGuard(nearestBeatIndex, lastFiredByClip.get(clip.id) ?? null);
  const shouldFire = phase.isOnBeat && guard.shouldFire;
  if (phase.isOnBeat) lastFiredByClip.set(clip.id, guard.nextLastFired);

  const clipStartSec =
    (clip.startBeat * 60) / grid.bpm + grid.offsetMs / 1000;
  const clipDurationSec = (clip.lengthBeats * 60) / grid.bpm;

  const rc: RenderContext = {
    ctx: ctx!,
    width: w,
    height: h,
    time,
    beatPhase: phase.phase,
    beatIndex: phase.beatIndex,
    isOnBeat: shouldFire,
    trigger: clip.trigger ?? plugin.defaultTrigger,
    clipId: clip.id,
    clipStartSec,
    clipDurationSec,
    flowMode,
    imageBitmap,
    imageBitmapKey: firstImageBitmapKey
  };

  const rawParams = {
    ...(plugin.getDefaultParams() as Record<string, unknown>),
    ...(clip.params ?? {})
  };
  const clipAlpha = computeClipAlpha(timeline, clip, beats);
  const usesAlpha = clipAlpha < 1;
  if (usesAlpha) {
    ctx!.save();
    ctx!.globalAlpha *= clipAlpha;
  }
  const paramBeat = flowMode ? beats - clip.startBeat : beats;
  try {
    plugin.render(
      rc,
      resolveClipParams(rawParams, paramBeat, clip.lengthBeats, flowMode)
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[renderer] plugin "${plugin.id}" render() threw:`, err);
  } finally {
    if (usesAlpha) ctx!.restore();
  }
}
```

Delete the local `RENDER_ORDER` and `KIND_TO_TRACK_KIND` constants in `loop.ts` if Task 2 left them in place.

- [ ] **Step 4 — Run tests**

```powershell
npm test -- --run
```

Expected: all PASS. Any renderer tests that went red in Task 2 should now go green. If a specific test fails because it expected the OLD iteration order (PascalCase RENDER_ORDER), update its expected sequence to match `RENDER_ORDER_TRACK_KIND` — the order is byte-identical (Dissolve, Contour, ZoomPulse, Sweep, Particles, Pulse, Sunray, Text), so the only change is the kind-spelling.

- [ ] **Step 5 — Commit**

```powershell
git add lib/timeline/selectors.ts lib/renderer/loop.ts tests/unit/renderer/fx-multi-clip.test.ts
git commit -m "feat(renderer): getActiveFxClips + minimal loop refactor for multi-clip fx tracks"
```

---

### Task 8 — `Tracks.tsx` plugin-drop via `canDropOnTrack`

**Files:**
- Modify: `components/Workspace/Timeline/Tracks.tsx`

- [ ] **Step 1 — Replace the inline PLUGIN_TO_TRACK_KIND**

```tsx
// components/Workspace/Timeline/Tracks.tsx — REMOVE the local
// PLUGIN_TO_TRACK_KIND const at line ~31. REPLACE with:

import {
  canDropOnTrack
} from '@/lib/timeline/track-validation';
import {
  PLUGIN_KIND_TO_TRACK_KIND,
  type PluginFxKind
} from '@/lib/timeline/plugin-mapping';
```

- [ ] **Step 2 — Rewrite the drop-routing logic**

```tsx
// In the drop handler (currently around line 115):
//
// BEFORE:
//   const pluginTrackKind = PLUGIN_TO_TRACK_KIND[plugin.kind as PluginFxKind];
//   const targetTrack = tracks.find((t) => t.kind === pluginTrackKind);
//
// AFTER:
const clipKind = PLUGIN_KIND_TO_TRACK_KIND[plugin.kind as PluginFxKind];
// Prefer the FX track the user explicitly dropped on (via data-track-id);
// fall back to first non-muted track that accepts this clip-kind.
const targetTrack =
  tracks.find((t) => t.id === explicitTargetId && canDropOnTrack(clipKind, t.kind) && !t.muted) ??
  tracks.find((t) => canDropOnTrack(clipKind, t.kind) && !t.muted);
```

If `Tracks.tsx` resolves `explicitTargetId` from the drop event's target element (`data-track-id`), use it. Otherwise fall back to the first match. The existing precision via `data-track-id` (mentioned in Risk-Tabelle) means a user dropping directly on FX-Track 2 lands on FX-Track 2, not FX-Track 1.

- [ ] **Step 3 — Smoke verify**

```powershell
npm run typecheck
npm run lint
npm test -- --run
```

Expected: clean. No new test for `Tracks.tsx` in this task — the integration is exercised by `getActiveFxClips` tests (Task 7) and `canDropOnTrack` tests (Task 5). If a UI-integration test exists for the drop handler, run it.

- [ ] **Step 4 — Commit**

```powershell
git add components/Workspace/Timeline/Tracks.tsx
git commit -m "feat(ui): Tracks.tsx plugin-drop routes via canDropOnTrack + plugin-mapping"
```

---

### Task 9 — UI: `FX_CLIP_COLORS` in Clip-band + `FX_DISPLAY_NAME` in Inspector

**Files:**
- Modify: `components/Workspace/Timeline/Clip.tsx`
- Modify: `components/Workspace/Inspector/index.tsx`

- [ ] **Step 1 — Clip-band color extension**

```tsx
// components/Workspace/Timeline/Clip.tsx — locate the existing
// KIND_COLOR map and EXTEND, do not replace:

import { FX_CLIP_COLORS, type TrackFxKind } from '@/lib/timeline/plugin-mapping';

// In the color resolution:
const color =
  FX_CLIP_COLORS[clip.kind as TrackFxKind] ??
  KIND_COLOR[clip.kind] ??
  'var(--surface-3)';
```

- [ ] **Step 2 — Inspector header label**

```tsx
// components/Workspace/Inspector/index.tsx — wherever the header
// renders the clip-kind label:

import { FX_DISPLAY_NAME, type TrackFxKind } from '@/lib/timeline/plugin-mapping';

// Replace the current label lookup with:
const headerLabel =
  FX_DISPLAY_NAME[clip.kind as TrackFxKind] ?? // FX clip: "Contour", "Color Sweep", …
  clip.kind;                                    // image / video / audio clips fall through
```

Note: `clip.kind === 'audio'` won't reach the Inspector in 5.9c (no FX-audio interaction yet) but the fallback keeps it safe.

- [ ] **Step 3 — Run tests**

```powershell
npm run typecheck
npm test -- --run
```

Expected: clean. Component tests for the Inspector (if any) may need a tiny snapshot update — `'contour'` → `'Contour'` in the header. Update them, don't bypass.

- [ ] **Step 4 — Commit**

```powershell
git add components/Workspace/Timeline/Clip.tsx components/Workspace/Inspector/index.tsx
git commit -m "feat(ui): FX_CLIP_COLORS for Clip-band + FX_DISPLAY_NAME for Inspector"
```

---

### Task 10 — `AddTrackButton` PICKER_OPTIONS shrink (10 → 3 visible)

**Files:**
- Modify: `components/Workspace/Timeline/AddTrackButton.tsx`
- Create: `tests/unit/components/Timeline/AddTrackButton.test.tsx`

- [ ] **Step 1 — Write the failing test**

```tsx
// tests/unit/components/Timeline/AddTrackButton.test.tsx — NEW:

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddTrackButton } from '@/components/Workspace/Timeline/AddTrackButton';

// Mock the store so addTrack is a spy.
vi.mock('@/lib/store', () => ({
  useAppStore: (sel: (s: { timelineActions: { addTrack: (k: string) => void } }) => unknown) =>
    sel({ timelineActions: { addTrack: vi.fn() } })
}));

describe('AddTrackButton — Plan 5.9c picker', () => {
  it('renders exactly 3 picker options (Image, Video, FX)', () => {
    render(<AddTrackButton />);
    fireEvent.click(screen.getByRole('button')); // open picker
    expect(screen.getByText(/image/i)).toBeInTheDocument();
    expect(screen.getByText(/video/i)).toBeInTheDocument();
    expect(screen.getByText(/^fx$/i)).toBeInTheDocument();
  });

  it('does not show an Audio option (still gated by toast)', () => {
    render(<AddTrackButton />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText(/audio/i)).not.toBeInTheDocument();
  });

  it('clicking the FX option calls addTrack("fx")', () => {
    const addTrack = vi.fn();
    // Re-mock with a captured spy so we can assert against it.
    vi.doMock('@/lib/store', () => ({
      useAppStore: (sel: (s: { timelineActions: { addTrack: typeof addTrack } }) => unknown) =>
        sel({ timelineActions: { addTrack } })
    }));
    // Re-import after mock so the component picks up the spy.
    // (vi.resetModules() if your test setup needs it.)
    const { AddTrackButton: Fresh } = require('@/components/Workspace/Timeline/AddTrackButton');
    render(<Fresh />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText(/^fx$/i));
    expect(addTrack).toHaveBeenCalledWith('fx');
  });
});
```

Run: FAIL — current picker still has 10 entries (the per-FX-kind options).

- [ ] **Step 2 — Shrink `PICKER_OPTIONS`**

```tsx
// components/Workspace/Timeline/AddTrackButton.tsx — REPLACE:

const PICKER_OPTIONS: Array<{ kind: TrackKind; label: string }> = [
  { kind: 'image', label: 'Image' },
  { kind: 'video', label: 'Video' },
  { kind: 'fx',    label: 'FX' }
  // 'audio' intentionally omitted — added through 5.9d when Multi-Audio lands.
];
```

- [ ] **Step 3 — Run tests + smoke**

```powershell
npm test -- --run tests/unit/components/Timeline/AddTrackButton.test.tsx
npm test -- --run
```

Expected: PASS.

- [ ] **Step 4 — Commit**

```powershell
git add components/Workspace/Timeline/AddTrackButton.tsx tests/unit/components/Timeline/AddTrackButton.test.tsx
git commit -m "feat(ui): AddTrackButton picker shrinks to 3 options (image/video/fx)"
```

---

### Task 11 — KNOWN_LIMITATIONS doc note

**Files:**
- Modify (or CREATE if absent): `docs/KNOWN_LIMITATIONS.md`

- [ ] **Step 1 — Append the note**

```markdown
## Plan 5.9c — FX-Track Consolidation

- **Offline render path:** No separate eingriff. `lib/export/offline-render.ts`
  drives the same `tick()` as the live preview via `makeOfflineRenderer` —
  whatever the renderer does for FX clips on `'fx'` tracks, the offline
  export does too. Confirmed by `tests/unit/renderer/fx-multi-clip.test.ts`
  exercising the selector that both code paths consume.
- **v5 → v6 store migration:** the `v4 → v5` append-default-tracks logic is
  now gated to `version < 5`. A v5 user who upgrades will NOT get phantom
  duplicate lanes; the FX-per-kind tracks in their snapshot are rewritten
  in place to `kind: 'fx'`. User-renamed track labels (e.g. "Eigene
  Sweep") are preserved.
- **Multi-FX-Track drop precision:** drops via plugin-badge fall back to
  the first non-muted FX track when no `data-track-id` is on the drop
  target. Direct drops onto a specific FX-Track lane (the user clicks
  on the lane) keep using the explicit target, so users with 3 FX
  tracks who drop directly on track 2 land on track 2.
```

- [ ] **Step 2 — Commit**

```powershell
git add docs/KNOWN_LIMITATIONS.md
git commit -m "docs: KNOWN_LIMITATIONS — Plan 5.9c FX consolidation notes"
```

---

## Verification Gate

Baseline: post-Plan-5.9b HEAD (after hotfix commits, expected test count = 586).
Target: ≥ Baseline + 22 tests. Bundle ≤ Baseline + 2 %.

```powershell
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

All four must be clean. If `npm run build` complains about bundle size, the culprit is most likely a stray `import` from a UI component into the renderer — `plugin-mapping.ts` exists exactly to prevent that; check the import direction.

---

## Smoke Gate

After all tasks land:

```powershell
npm run dev
# 1. Fresh project (clear localStorage first or use an incognito window):
#    timeline shows exactly 4 lanes: Image / Video / Audio / FX.
# 2. Click "Track hinzufügen" → picker shows 3 options (Image / Video / FX).
#    Audio is intentionally absent.
# 3. Add a second FX track → label appears as "FX 2".
# 4. Drag a Contour plugin badge onto the FX track → lands there as
#    a contour-kind clip with purple band color.
# 5. Drag a Sweep badge so it overlaps the Contour clip → both kept,
#    Sweep band sits in front (pink).
# 6. Drag an Image-clip onto the FX track → rejected (canDropOnTrack
#    returns false; existing toast/UX still applies).
# 7. Inspector for the Contour clip → header reads "Contour" (not "FX").
# 8. Press Play → render order matches RENDER_ORDER_TRACK_KIND
#    (Dissolve under Contour under ZoomPulse under … under Text).
# 9. Load an existing v5 project (use the fixture from Task 0 Step 2):
#    every previously per-FX-kind track becomes a "FX" lane with its
#    original name preserved; clips render correctly.
# 10. Export the v5-loaded project → MP4 plays back with all FX visible.
```

Any failure → STOP, investigate before merge.

---

## Risk Table

| Risk | Mitigation |
|---|---|
| v5 snapshots with user-renamed FX-tracks (e.g. "Mein Custom Sweep") lose the rename because the migration normalises name | Migration **preserves** `track.name`; only `track.kind` is rewritten. Confirmed by `migration-v5-v6.test.ts` case 1. |
| Multi-FX-Track drop routing: when user drops a plugin badge anywhere on the timeline (not on a specific FX lane), all drops land on FX-Track 1 | `Tracks.tsx` already routes via `data-track-id` on the lane element when the drop is precise. Plan keeps that precision; fallback to first-match for ambiguous drops is documented in KNOWN_LIMITATIONS. |
| `__blend` cross-kind cleanup misses an edge case where the user moves the LATER clip (not the earlier) and the earlier clip's `__blend` is left stale | `regenerateBlendsForTrack` is called from `addClip` / `moveClip` / `resizeClip` / `removeClip` and walks **every** clip on the affected track each time, so any stale `__blend` is re-evaluated on the next mutation. Confirmed by `blend-lifecycle.test.ts` new case. |
| `tests/fixtures/timeline-v5.json` is a one-off real snapshot — future store-shape changes could silently invalidate it | Treat the fixture as a frozen record. If a later plan changes the persisted shape, that plan must update both the fixture AND the migration tests in lockstep. Document this contract in `tests/fixtures/README.md` (CREATE if absent) as part of Task 3. |
| Renderer's outer-loop refactor reorders FX rendering subtly (tests pass, but visual rendering differs in production) | `RENDER_ORDER_TRACK_KIND` is byte-identical to the old `RENDER_ORDER` after lowercase mapping. Smoke Gate step 8 is the visual verification. |
| TypeScript widening of `Clip.kind` to `TrackKind \| TrackFxKind` cascades into many `as TrackFxKind` casts elsewhere | Centralise the narrowing where it happens (renderer's plugin dispatch, Clip.tsx color lookup). Each cast paired with the matching helper from `plugin-mapping.ts` so the relationship is explicit. |

---

## Out of Scope

- **Auto-Preset System-Prompt Update.** The `/api/analyze-image` Sonnet prompt may still reference per-FX track-kinds (e.g. emits `trackKind: 'contour'`). Verify in Plan 5.8b, NOT here. As long as the analyzer's output sets `clip.kind` to the FX kind (lowercase) and the drop targets a track-kind `'fx'`, the auto-preset still works — the per-FX trackKind in the prompt was always informational.
- **Drag-Reorder of tracks.** Track order is array index; reordering means swapping array positions. Out of scope for v0.1.
- **User-pickable clip colors.** `FX_CLIP_COLORS` is a hard-coded palette. Custom colors are v0.2.
- **Multi-Audio tracks.** Plan 5.9d.

---

## Commit log (target)

```
feat(timeline): plugin-mapping.ts — single source of truth for FX kind mappings
feat(timeline): TrackKind = 'image'|'video'|'audio'|'fx', migrate FxKind import
feat(store): migration v5→v6 (FX tracks → kind:fx) + gate v4→v5 append
feat(store): initialTimelineState 4 lanes + addTrack FX-counter + audio-stub toast
feat(timeline): canDropOnTrack + addClip overlap gate for fx-kind tracks
fix(timeline): regenerateBlendsForTrack drops __blend on cross-kind overlap
feat(renderer): getActiveFxClips + minimal loop refactor for multi-clip fx tracks
feat(ui): Tracks.tsx plugin-drop routes via canDropOnTrack + plugin-mapping
feat(ui): FX_CLIP_COLORS for Clip-band + FX_DISPLAY_NAME for Inspector
feat(ui): AddTrackButton picker shrinks to 3 options (image/video/fx)
docs: KNOWN_LIMITATIONS — Plan 5.9c FX consolidation notes
```

11 commits. Baseline + 11 + buffer for fixup-during-execution.

---

## Execution Notes (CC #1 hand-off)

- Each task is a single commit. Don't batch.
- The Task-2 stub in `loop.ts` leaves FX rendering broken between Tasks 2 and 7. That's intentional — typecheck stays green, the user doesn't smoke-test mid-plan. If you find yourself wanting to smoke-test before Task 7 lands, you're off-script.
- Tests are written FIRST in every task. If the test passes on first run, you wrote the wrong test or the code already does the thing — re-think before continuing.
- Keep `git status` clean between tasks. Don't accumulate cross-task changes.
- If a task fails verification (typecheck / lint / tests / build), STOP. Don't pile on fixes. Investigate root cause via `superpowers:systematic-debugging`.
