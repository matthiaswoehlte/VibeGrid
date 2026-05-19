# VibeGrid Plan 1 — Timeline Module (pure)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure functional core of the timeline — types, selectors, operations — with full unit-test coverage, and wire a timeline slice into the existing Zustand store so the rest of the app can consume it without coupling to the algorithms.

**Architecture:** Three flat files under `lib/timeline/`. `types.ts` defines the data model. `selectors.ts` exposes read-only queries that take a `TimelineState` (plus arguments) and return derived data — never mutate. `operations.ts` exposes state transitions that take a `TimelineState` and return a new `TimelineState`, throwing a typed `OperationError` on invariant violations. The Zustand store wraps each operation as an action and re-throws errors so the UI layer can surface them as toasts (Spec §6.2). No I/O, no time, no React — everything is testable as a pure function.

**Tech Stack:** TypeScript strict, Vitest + jsdom (already wired in Plan 0), Zustand (existing store). No new runtime dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-19-vibegrid-design.md` §6 (Timeline Module), §10 (State Management).

**Verification gate (must pass before Plan 2 starts):**

```
npm test -- timeline         # ≥ 30 tests across selectors + operations, all green
npm run typecheck            # tsc --noEmit clean
npm run lint                 # eslint clean
```

**Dependencies on prior plans:** Plan 0 (scaffold). `lib/store/index.ts` exists with a `ui` slice; this plan extends it with a `timeline` slice and updates `partialize` accordingly.

---

## File map

| File | Purpose |
|---|---|
| `lib/timeline/types.ts` | `TrackKind`, `SnapMode`, `Track`, `Clip`, `PlayheadState`, `TimelineState`. Re-exports `TriggerMode` from `lib/renderer/types.ts`? **No** — `lib/renderer/types.ts` does not exist yet; define `TriggerMode` here and let Plan 3 import it. |
| `lib/timeline/selectors.ts` | `activeClipsAt`, `activeImageClip`, `activeFxClipsByKind`, `snapBeats`, `totalBeats`, `beatsToTimecode`, `hasOverlap` |
| `lib/timeline/operations.ts` | `OperationError` class, `addClip`, `moveClip`, `resizeClip`, `removeClip`, `setClipParams`, `setPlayhead`, `setMuted` |
| `lib/store/timeline-slice.ts` | Zustand slice wrapping the pure operations |
| `lib/store/index.ts` (modify) | Compose `ui` + `timeline` slices; extend `partialize` |
| `lib/store/types.ts` (modify) | Compose `AppState` from `UIState` + `TimelineState` + actions |
| `tests/unit/timeline/types.test.ts` | Minimal type-guard sanity (default state shape) |
| `tests/unit/timeline/selectors.test.ts` | One `describe` per selector |
| `tests/unit/timeline/operations.test.ts` | One `describe` per operation; immutability assertions throughout |
| `tests/unit/store/timeline-slice.test.ts` | Slice wiring + OperationError propagation |

---

## Conventions used in this plan

- **Test names** are full sentences in English, present tense, asserting one behavior. Example: `'returns clips whose interval contains the playhead'`.
- **Immutability check pattern**: every operation test must assert `result !== input` AND `input.clips` was not mutated. A small helper `freezeState(state)` from `tests/unit/timeline/_helpers.ts` (Task 0) calls `Object.freeze` recursively so accidental mutation throws in strict mode.
- **Test fixtures**: built inline per test. Do not share mutable fixtures across tests.
- **`it` vs `test`**: use `it` consistently (Vitest supports both; pick one to keep the file uniform).
- **Float comparison**: timeline values are fractional beats. Use `toBeCloseTo(expected, 5)` for derived numbers, exact `toBe` for inputs you constructed directly.

---

## Task 0: Test-helper module

**Files:**

- Create: `tests/unit/timeline/_helpers.ts`

> This file is shared by every test file in this plan. The leading underscore signals "not a test file" (matches Vitest's default `include` since the helper has no `.test.` infix).

- [ ] **Step 1: Write the helper**

```ts
import type { Clip, TimelineState, Track } from '@/lib/timeline/types';

export function makeTrack(overrides: Partial<Track> & Pick<Track, 'id' | 'kind'>): Track {
  return {
    name: overrides.name ?? `${overrides.kind}-track`,
    muted: false,
    order: 0,
    ...overrides
  };
}

export function makeClip(overrides: Partial<Clip> & Pick<Clip, 'id' | 'trackId' | 'kind'>): Clip {
  return {
    startBeat: 0,
    lengthBeats: 4,
    label: overrides.id,
    ...overrides
  };
}

export function makeState(overrides?: Partial<TimelineState>): TimelineState {
  return {
    tracks: [],
    clips: [],
    playhead: { beats: 0, playing: false },
    zoom: 1,
    snap: 'beat',
    ...overrides
  };
}

/**
 * Deep-freeze a TimelineState so accidental mutation throws under strict mode.
 * Works on arrays too: Object.keys on an array returns string indices ('0', '1', …),
 * which is intentional — every element is visited and frozen recursively.
 */
export function freezeState<T extends object>(value: T): T {
  Object.freeze(value);
  for (const key of Object.keys(value) as (keyof T)[]) {
    const v = value[key];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) freezeState(v as object);
  }
  return value;
}
```

> Note: `types.ts` doesn't exist yet — this file references it. Vitest only fails on missing imports when the test that uses it runs. Defer running tests until Task 1 lands the types.

- [ ] **Step 2: Commit**

```bash
git add tests/unit/timeline/_helpers.ts
git commit -m "test(timeline): add fixtures and freeze helper"
```

---

## Task 1: Type definitions

**Files:**

- Create: `lib/timeline/types.ts`
- Create: `tests/unit/timeline/types.test.ts`

> The spec gives us the exact shape (§6). We restate it here verbatim and add one shape test so the helper module above compiles.

- [ ] **Step 1: Write the failing test**

`tests/unit/timeline/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeState } from './_helpers';

describe('TimelineState default shape', () => {
  it('produces a valid empty timeline with snap=beat and zoom=1', () => {
    const s = makeState();
    expect(s.tracks).toEqual([]);
    expect(s.clips).toEqual([]);
    expect(s.playhead).toEqual({ beats: 0, playing: false });
    expect(s.zoom).toBe(1);
    expect(s.snap).toBe('beat');
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL on module-not-found**

```
npm test -- timeline
```

Expected: `Cannot find module '@/lib/timeline/types'`.

- [ ] **Step 3: Write `lib/timeline/types.ts`**

```ts
export type TrackKind = 'image' | 'contour' | 'sweep' | 'pulse' | 'particles';

export type FxKind = Exclude<TrackKind, 'image'>;

/** Trigger cadence for FX. Defined here (not in renderer) because clips own a trigger. */
export type TriggerMode = 'half-bar' | 'beat' | 'bar' | 'two-bar';

export type SnapMode = 'beat' | 'half' | 'quarter' | 'off';

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

export const SNAP_TO_BEATS: Record<SnapMode, number> = {
  beat: 1,
  half: 0.5,
  quarter: 0.25,
  off: 0 // 0 means "no snap" — selectors short-circuit on this value
};
```

- [ ] **Step 4: Run the test — expect PASS**

```
npm test -- timeline
```

Expected: `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/timeline/types.ts tests/unit/timeline/types.test.ts
git commit -m "feat(timeline): add types (Track, Clip, TimelineState, TriggerMode)"
```

---

## Task 2: `OperationError` class

**Files:**

- Create: `lib/timeline/operations.ts` (initial — class only)
- Create: `tests/unit/timeline/operations.test.ts` (initial — one test)

> Defining the error class up front lets Tasks 7+ throw it without import churn.

- [ ] **Step 1: Write the failing test**

`tests/unit/timeline/operations.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OperationError } from '@/lib/timeline/operations';

describe('OperationError', () => {
  it('is throwable, identifiable via instanceof, and carries a code', () => {
    const err = new OperationError('OVERLAP', 'Clip overlaps existing clip');
    expect(err).toBeInstanceOf(OperationError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('OVERLAP');
    expect(err.message).toBe('Clip overlaps existing clip');
    expect(err.name).toBe('OperationError');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Write the class**

`lib/timeline/operations.ts`:

```ts
export type OperationErrorCode =
  | 'OVERLAP'
  | 'CLIP_NOT_FOUND'
  | 'TRACK_NOT_FOUND'
  | 'INVALID_LENGTH';

export class OperationError extends Error {
  readonly code: OperationErrorCode;

  constructor(code: OperationErrorCode, message: string) {
    super(message);
    this.name = 'OperationError';
    this.code = code;
    // Restore prototype chain — required when extending Error in strict TS with target ES5+.
    Object.setPrototypeOf(this, OperationError.prototype);
  }
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/timeline/operations.ts tests/unit/timeline/operations.test.ts
git commit -m "feat(timeline): add OperationError class with code discriminator"
```

---

## Task 3: `snapBeats` selector

**Files:**

- Create: `lib/timeline/selectors.ts` (initial — one selector)
- Create: `tests/unit/timeline/selectors.test.ts` (initial)

- [ ] **Step 1: Write the failing tests**

`tests/unit/timeline/selectors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { snapBeats } from '@/lib/timeline/selectors';

describe('snapBeats', () => {
  it('rounds to nearest beat when mode=beat', () => {
    expect(snapBeats(2.3, 'beat')).toBe(2);
    expect(snapBeats(2.5, 'beat')).toBe(3); // half rounds up (Math.round)
    expect(snapBeats(2.7, 'beat')).toBe(3);
  });

  it('rounds to nearest half-beat when mode=half', () => {
    expect(snapBeats(2.3, 'half')).toBe(2.5);
    expect(snapBeats(2.2, 'half')).toBe(2);
    expect(snapBeats(2.74, 'half')).toBe(2.5);
    expect(snapBeats(2.76, 'half')).toBe(3);
  });

  it('rounds to nearest quarter-beat when mode=quarter', () => {
    expect(snapBeats(2.3, 'quarter')).toBe(2.25);
    expect(snapBeats(2.4, 'quarter')).toBe(2.5);
  });

  it('returns input unchanged when mode=off', () => {
    expect(snapBeats(2.37, 'off')).toBe(2.37);
    expect(snapBeats(-1.5, 'off')).toBe(-1.5);
  });

  it('handles negative beats (clip dragged before timeline origin)', () => {
    expect(snapBeats(-0.3, 'beat')).toBe(-0); // Math.round(-0.3) === -0; treat as 0 downstream
    expect(snapBeats(-0.7, 'beat')).toBe(-1);
  });

  it('returns exact value when input is already on grid', () => {
    expect(snapBeats(4, 'beat')).toBe(4);
    expect(snapBeats(4.5, 'half')).toBe(4.5);
    expect(snapBeats(4.25, 'quarter')).toBe(4.25);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Write the selector**

`lib/timeline/selectors.ts`:

```ts
import { SNAP_TO_BEATS, type SnapMode } from './types';

export function snapBeats(beats: number, mode: SnapMode): number {
  if (mode === 'off') return beats;
  const step = SNAP_TO_BEATS[mode];
  return Math.round(beats / step) * step;
}
```

- [ ] **Step 4: Run — expect PASS (6 tests)**

- [ ] **Step 5: Commit**

```bash
git add lib/timeline/selectors.ts tests/unit/timeline/selectors.test.ts
git commit -m "feat(timeline): snapBeats selector with beat/half/quarter/off modes"
```

---

## Task 4: `hasOverlap` selector

**Files:**

- Modify: `lib/timeline/selectors.ts`
- Modify: `tests/unit/timeline/selectors.test.ts`

> Semantics: clips occupy the half-open interval `[startBeat, startBeat + lengthBeats)`. Touching (end of A == start of B) is **not** an overlap. Only clips on the same `trackId` can overlap.

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/timeline/selectors.test.ts`:

```ts
import { hasOverlap } from '@/lib/timeline/selectors';
import { makeClip, makeState } from './_helpers';

describe('hasOverlap', () => {
  it('returns false on empty timeline', () => {
    const s = makeState();
    expect(hasOverlap(s, 't1', 0, 4)).toBe(false);
  });

  it('returns true when proposed interval intersects an existing clip on same track', () => {
    const s = makeState({
      clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 8 })]
    });
    expect(hasOverlap(s, 't1', 4, 4)).toBe(true);
  });

  it('returns false when proposed interval is on a different track', () => {
    const s = makeState({
      clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 8 })]
    });
    expect(hasOverlap(s, 't2', 0, 8)).toBe(false);
  });

  it('treats end-to-start touch as non-overlap (half-open intervals)', () => {
    const s = makeState({
      clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 })]
    });
    expect(hasOverlap(s, 't1', 4, 4)).toBe(false); // new clip starts exactly where old ends
    expect(hasOverlap(s, 't1', -4, 4)).toBe(false); // new clip ends exactly where old starts
  });

  it('excludes a given clipId from the overlap check (used by moveClip/resizeClip)', () => {
    const s = makeState({
      clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 8 })]
    });
    // moving clip 'a' inside its own footprint must not trip overlap
    expect(hasOverlap(s, 't1', 2, 4, 'a')).toBe(false);
  });

  it('detects overlap when proposed clip is fully contained inside existing one', () => {
    const s = makeState({
      clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 16 })]
    });
    expect(hasOverlap(s, 't1', 4, 4)).toBe(true);
  });

  it('detects overlap when proposed clip fully contains existing one', () => {
    const s = makeState({
      clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 4, lengthBeats: 4 })]
    });
    expect(hasOverlap(s, 't1', 0, 16)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect 7 failures (function not defined)**

- [ ] **Step 3: Implement**

Append to `lib/timeline/selectors.ts`:

```ts
import type { TimelineState } from './types';

export function hasOverlap(
  state: TimelineState,
  trackId: string,
  startBeat: number,
  lengthBeats: number,
  excludeClipId?: string
): boolean {
  const end = startBeat + lengthBeats;
  for (const c of state.clips) {
    if (c.trackId !== trackId) continue;
    if (c.id === excludeClipId) continue;
    const cEnd = c.startBeat + c.lengthBeats;
    // Half-open intervals: overlap iff start < cEnd AND end > cStart
    if (startBeat < cEnd && end > c.startBeat) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/timeline/selectors.ts tests/unit/timeline/selectors.test.ts
git commit -m "feat(timeline): hasOverlap selector with half-open interval semantics"
```

---

## Task 5: Activation selectors — `activeClipsAt`, `activeImageClip`, `activeFxClipsByKind`

**Files:**

- Modify: `lib/timeline/selectors.ts`
- Modify: `tests/unit/timeline/selectors.test.ts`

> Definition: a clip is active at beat `b` iff `b ∈ [startBeat, startBeat + lengthBeats)`. Muted tracks contribute their clips to `activeClipsAt` and `activeFxClipsByKind` (mute is a render-time concern, not a state-filter concern) — but the spec says §6.1 selectors don't filter. Document this and let the renderer skip muted clips. **Confirm with the user during review.**

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/timeline/selectors.test.ts`:

```ts
import { activeClipsAt, activeImageClip, activeFxClipsByKind } from '@/lib/timeline/selectors';

describe('activeClipsAt', () => {
  it('returns empty array on empty timeline', () => {
    expect(activeClipsAt(makeState(), 0)).toEqual([]);
  });

  it('includes clips whose half-open interval contains the playhead', () => {
    const s = makeState({
      clips: [
        makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 }),
        makeClip({ id: 'b', trackId: 't2', kind: 'sweep', startBeat: 4, lengthBeats: 4 })
      ]
    });
    expect(activeClipsAt(s, 2).map((c) => c.id)).toEqual(['a']);
    expect(activeClipsAt(s, 4).map((c) => c.id)).toEqual(['b']); // end of 'a' (4) is exclusive
    expect(activeClipsAt(s, 7.99).map((c) => c.id)).toEqual(['b']);
    expect(activeClipsAt(s, 8).map((c) => c.id)).toEqual([]); // both exclusive
  });

  it('does not filter by track mute (caller is responsible)', () => {
    const s = makeState({
      tracks: [{ id: 't1', kind: 'contour', name: 'c', muted: true, order: 0 }],
      clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 })]
    });
    expect(activeClipsAt(s, 2)).toHaveLength(1);
  });
});

describe('activeImageClip', () => {
  it('returns null when no image clip is active', () => {
    expect(activeImageClip(makeState(), 0)).toBeNull();
  });

  it('returns the single active image clip when one exists', () => {
    const s = makeState({
      clips: [
        makeClip({ id: 'img', trackId: 't0', kind: 'image', startBeat: 0, lengthBeats: 100 }),
        makeClip({ id: 'fx', trackId: 't1', kind: 'pulse', startBeat: 0, lengthBeats: 4 })
      ]
    });
    expect(activeImageClip(s, 10)?.id).toBe('img');
  });

  it('returns the FIRST active image clip if multiple overlap (invariant guarded by addClip)', () => {
    // This case should never occur in practice — addClip enforces non-overlap per track.
    // The selector must remain deterministic regardless: return the first one found.
    const s = makeState({
      clips: [
        makeClip({ id: 'img1', trackId: 't0', kind: 'image', startBeat: 0, lengthBeats: 100 }),
        makeClip({ id: 'img2', trackId: 't1', kind: 'image', startBeat: 50, lengthBeats: 100 })
      ]
    });
    expect(activeImageClip(s, 75)?.id).toBe('img1');
  });
});

describe('activeFxClipsByKind', () => {
  it('groups active non-image clips by kind', () => {
    const s = makeState({
      clips: [
        makeClip({ id: 'img', trackId: 't0', kind: 'image', startBeat: 0, lengthBeats: 100 }),
        makeClip({ id: 'c1', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 8 }),
        makeClip({ id: 'c2', trackId: 't1', kind: 'contour', startBeat: 8, lengthBeats: 8 }),
        makeClip({ id: 'p1', trackId: 't2', kind: 'pulse', startBeat: 0, lengthBeats: 16 })
      ]
    });
    const r = activeFxClipsByKind(s, 4);
    expect(r.contour.map((c) => c.id)).toEqual(['c1']);
    expect(r.pulse.map((c) => c.id)).toEqual(['p1']);
    expect(r.sweep).toEqual([]);
    expect(r.particles).toEqual([]);
  });

  it('excludes image clips from the grouping', () => {
    const s = makeState({
      clips: [makeClip({ id: 'img', trackId: 't0', kind: 'image', startBeat: 0, lengthBeats: 4 })]
    });
    const r = activeFxClipsByKind(s, 2);
    expect(r.contour).toEqual([]);
    expect(r.sweep).toEqual([]);
    expect(r.pulse).toEqual([]);
    expect(r.particles).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect 7 failures**

- [ ] **Step 3: Implement**

Append to `lib/timeline/selectors.ts`:

```ts
import type { Clip, FxKind } from './types';

export function activeClipsAt(state: TimelineState, beats: number): Clip[] {
  return state.clips.filter((c) => beats >= c.startBeat && beats < c.startBeat + c.lengthBeats);
}

export function activeImageClip(state: TimelineState, beats: number): Clip | null {
  for (const c of state.clips) {
    if (c.kind !== 'image') continue;
    if (beats >= c.startBeat && beats < c.startBeat + c.lengthBeats) return c;
  }
  return null;
}

export function activeFxClipsByKind(
  state: TimelineState,
  beats: number
): Record<FxKind, Clip[]> {
  const result: Record<FxKind, Clip[]> = {
    contour: [],
    sweep: [],
    pulse: [],
    particles: []
  };
  for (const c of state.clips) {
    if (c.kind === 'image') continue;
    if (beats < c.startBeat || beats >= c.startBeat + c.lengthBeats) continue;
    result[c.kind].push(c);
  }
  return result;
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/timeline/selectors.ts tests/unit/timeline/selectors.test.ts
git commit -m "feat(timeline): activation selectors (activeClipsAt, activeImageClip, activeFxClipsByKind)"
```

---

## Task 6: Display selectors — `totalBeats`, `beatsToTimecode`

**Files:**

- Modify: `lib/timeline/selectors.ts`
- Modify: `tests/unit/timeline/selectors.test.ts`

> `totalBeats` = `max(clip.startBeat + clip.lengthBeats)` over all clips, or 0 if empty. Used to draw the right edge of the ruler.
>
> `beatsToTimecode(beats, bpm)` returns `"mm:ss"` (or `"h:mm:ss"` if ≥ 1 h). The Ruler renders this on every beat label.

- [ ] **Step 1: Add failing tests**

```ts
import { totalBeats, beatsToTimecode } from '@/lib/timeline/selectors';

describe('totalBeats', () => {
  it('returns 0 on empty timeline', () => {
    expect(totalBeats(makeState())).toBe(0);
  });

  it('returns max(startBeat + lengthBeats) across all clips', () => {
    const s = makeState({
      clips: [
        makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 16 }),
        makeClip({ id: 'b', trackId: 't1', kind: 'contour', startBeat: 20, lengthBeats: 4 }),
        makeClip({ id: 'c', trackId: 't2', kind: 'pulse', startBeat: 8, lengthBeats: 8 })
      ]
    });
    expect(totalBeats(s)).toBe(24);
  });
});

describe('beatsToTimecode', () => {
  it('formats whole minutes at 120 BPM', () => {
    // 120 bpm → 2 beats per second → 480 beats = 240 sec = 4:00
    expect(beatsToTimecode(480, 120)).toBe('4:00');
  });

  it('formats sub-minute durations', () => {
    expect(beatsToTimecode(0, 120)).toBe('0:00');
    expect(beatsToTimecode(60, 120)).toBe('0:30'); // 60 beats / 2 bps = 30 s
    expect(beatsToTimecode(119, 120)).toBe('0:59'); // truncates fractional seconds
  });

  it('formats h:mm:ss for durations ≥ 1 hour', () => {
    // 120 bpm, 1 h = 3600 s = 7200 beats
    expect(beatsToTimecode(7200, 120)).toBe('1:00:00');
    expect(beatsToTimecode(7320, 120)).toBe('1:01:00');
  });

  it('clamps negative input to 0:00', () => {
    expect(beatsToTimecode(-5, 120)).toBe('0:00');
  });

  it('handles non-default BPMs', () => {
    // 60 bpm → 1 beat per second → 60 beats = 1 min
    expect(beatsToTimecode(60, 60)).toBe('1:00');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
export function totalBeats(state: TimelineState): number {
  let max = 0;
  for (const c of state.clips) {
    const end = c.startBeat + c.lengthBeats;
    if (end > max) max = end;
  }
  return max;
}

/**
 * Format beats as a timecode string.
 *
 * Format rules (v0.1):
 * - Under 1 hour: `m:ss` — minutes are NOT zero-padded. e.g. `0:30`, `4:00`, `12:05`.
 * - 1 hour or more: `h:mm:ss` — minutes ARE zero-padded inside the hours form. e.g. `1:01:00`.
 * - Seconds are always zero-padded to 2 digits.
 * - Negative beats clamp to `0:00`.
 *
 * Fractional seconds are truncated (Math.floor), matching the Ruler's per-beat resolution
 * for v0.1. If sub-second precision is needed later, switch to `m:ss.cc`.
 */
export function beatsToTimecode(beats: number, bpm: number): string {
  const safe = Math.max(0, beats);
  const totalSeconds = Math.floor((safe * 60) / bpm);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = seconds.toString().padStart(2, '0');
  if (hours === 0) return `${minutes}:${ss}`;
  const mm = minutes.toString().padStart(2, '0');
  return `${hours}:${mm}:${ss}`;
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/timeline/selectors.ts tests/unit/timeline/selectors.test.ts
git commit -m "feat(timeline): totalBeats + beatsToTimecode display selectors"
```

---

## Task 7: `addClip` operation

**Files:**

- Modify: `lib/timeline/operations.ts`
- Modify: `tests/unit/timeline/operations.test.ts`

> `addClip(state, clip)` returns a new state with the clip appended. Throws `OperationError('OVERLAP', …)` if the clip overlaps any existing clip on the same track. The original `state` is never mutated.

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/timeline/operations.test.ts`:

```ts
import { addClip } from '@/lib/timeline/operations';
import { freezeState, makeClip, makeState } from './_helpers';

describe('addClip', () => {
  it('appends the clip to a fresh state and returns a new state object', () => {
    const s0 = freezeState(makeState());
    const clip = makeClip({ id: 'a', trackId: 't1', kind: 'contour' });
    const s1 = addClip(s0, clip);
    expect(s1).not.toBe(s0);
    expect(s1.clips).toHaveLength(1);
    expect(s1.clips[0]).toEqual(clip);
    expect(s0.clips).toHaveLength(0); // input untouched
  });

  it('preserves other state fields unchanged (referential equality)', () => {
    const s0 = freezeState(
      makeState({ tracks: [{ id: 't1', kind: 'contour', name: 'c', muted: false, order: 0 }] })
    );
    const s1 = addClip(s0, makeClip({ id: 'a', trackId: 't1', kind: 'contour' }));
    expect(s1.tracks).toBe(s0.tracks);
    expect(s1.playhead).toBe(s0.playhead);
  });

  it('throws OperationError(OVERLAP) when proposed clip intersects existing on same track', () => {
    const s0 = freezeState(
      makeState({
        clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 8 })]
      })
    );
    expect(() =>
      addClip(s0, makeClip({ id: 'b', trackId: 't1', kind: 'contour', startBeat: 4, lengthBeats: 4 }))
    ).toThrow(OperationError);
  });

  it('does NOT throw when proposed clip is on a different track', () => {
    const s0 = freezeState(
      makeState({
        clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 8 })]
      })
    );
    expect(() =>
      addClip(s0, makeClip({ id: 'b', trackId: 't2', kind: 'pulse', startBeat: 0, lengthBeats: 8 }))
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

Append to `lib/timeline/operations.ts`:

```ts
import type { Clip, TimelineState } from './types';
import { hasOverlap } from './selectors';

/**
 * Add a clip to the timeline.
 *
 * ID-generation convention: the CALLER provides `clip.id`. Operations stay
 * pure — they never call `crypto.randomUUID()` or any other non-deterministic
 * source. UI/store callers generate the ID before invoking. This keeps the
 * operation trivially testable with stable, hand-written IDs.
 *
 * @throws {OperationError} code=OVERLAP when the clip intersects an existing
 *   clip on the same track. Half-open interval semantics — see `hasOverlap`.
 */
export function addClip(state: TimelineState, clip: Clip): TimelineState {
  if (hasOverlap(state, clip.trackId, clip.startBeat, clip.lengthBeats)) {
    throw new OperationError(
      'OVERLAP',
      `Clip ${clip.id} overlaps existing clip on track ${clip.trackId}`
    );
  }
  return { ...state, clips: [...state.clips, clip] };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/timeline/operations.ts tests/unit/timeline/operations.test.ts
git commit -m "feat(timeline): addClip (immutable, throws OperationError on overlap)"
```

---

## Task 8: `moveClip` operation

**Files:**

- Modify: `lib/timeline/operations.ts`
- Modify: `tests/unit/timeline/operations.test.ts`

> `moveClip(state, clipId, newStartBeat)` returns a new state with the clip's `startBeat` updated. Throws `OperationError('CLIP_NOT_FOUND')` if the clip doesn't exist. Throws `OperationError('OVERLAP')` if the moved clip would collide with another clip on the same track (excluding itself).

- [ ] **Step 1: Add failing tests**

```ts
import { moveClip } from '@/lib/timeline/operations';

describe('moveClip', () => {
  it('updates startBeat and returns a new state', () => {
    const s0 = freezeState(
      makeState({
        clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 })]
      })
    );
    const s1 = moveClip(s0, 'a', 10);
    expect(s1.clips[0].startBeat).toBe(10);
    expect(s0.clips[0].startBeat).toBe(0); // input untouched
  });

  it('throws CLIP_NOT_FOUND when clipId is unknown', () => {
    const s0 = freezeState(makeState());
    expect(() => moveClip(s0, 'missing', 0)).toThrow(OperationError);
    try {
      moveClip(s0, 'missing', 0);
    } catch (e) {
      expect((e as OperationError).code).toBe('CLIP_NOT_FOUND');
    }
  });

  it('allows moving a clip within its own footprint (excludes self from overlap)', () => {
    const s0 = freezeState(
      makeState({
        clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 8 })]
      })
    );
    const s1 = moveClip(s0, 'a', 2);
    expect(s1.clips[0].startBeat).toBe(2);
  });

  it('throws OVERLAP when the moved clip would collide with another clip on the same track', () => {
    const s0 = freezeState(
      makeState({
        clips: [
          makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 }),
          makeClip({ id: 'b', trackId: 't1', kind: 'contour', startBeat: 10, lengthBeats: 4 })
        ]
      })
    );
    expect(() => moveClip(s0, 'a', 8)).toThrow(OperationError); // would overlap 'b'
  });

  it('preserves non-moved clips unchanged', () => {
    const s0 = freezeState(
      makeState({
        clips: [
          makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 }),
          makeClip({ id: 'b', trackId: 't2', kind: 'pulse', startBeat: 0, lengthBeats: 4 })
        ]
      })
    );
    const s1 = moveClip(s0, 'a', 10);
    expect(s1.clips.find((c) => c.id === 'b')).toBe(s0.clips.find((c) => c.id === 'b'));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
export function moveClip(
  state: TimelineState,
  clipId: string,
  newStartBeat: number
): TimelineState {
  const idx = state.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) {
    throw new OperationError('CLIP_NOT_FOUND', `Clip ${clipId} not found`);
  }
  const clip = state.clips[idx];
  if (hasOverlap(state, clip.trackId, newStartBeat, clip.lengthBeats, clipId)) {
    throw new OperationError(
      'OVERLAP',
      `Moving clip ${clipId} to ${newStartBeat} would overlap an existing clip`
    );
  }
  const next = state.clips.slice();
  next[idx] = { ...clip, startBeat: newStartBeat };
  return { ...state, clips: next };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/timeline/operations.ts tests/unit/timeline/operations.test.ts
git commit -m "feat(timeline): moveClip (CLIP_NOT_FOUND + OVERLAP checks, immutable)"
```

---

## Task 9: `resizeClip` operation

**Files:**

- Modify: `lib/timeline/operations.ts`
- Modify: `tests/unit/timeline/operations.test.ts`

> `resizeClip(state, clipId, newLengthBeats)` updates the clip's `lengthBeats`. Length must be > 0 — throws `OperationError('INVALID_LENGTH')` otherwise. The spec (§6.2) does not require an overlap check on resize, but logically a resize that extends into another clip should fail the same invariant `addClip`/`moveClip` enforce. We add the overlap check here. **Note for review:** confirm this is intended; if not, drop the OVERLAP branch.

- [ ] **Step 1: Add failing tests**

```ts
import { resizeClip } from '@/lib/timeline/operations';

describe('resizeClip', () => {
  it('updates lengthBeats and returns a new state', () => {
    const s0 = freezeState(
      makeState({
        clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 })]
      })
    );
    const s1 = resizeClip(s0, 'a', 8);
    expect(s1.clips[0].lengthBeats).toBe(8);
    expect(s0.clips[0].lengthBeats).toBe(4);
  });

  it('throws INVALID_LENGTH when newLengthBeats <= 0', () => {
    const s0 = freezeState(
      makeState({
        clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 })]
      })
    );
    expect(() => resizeClip(s0, 'a', 0)).toThrow(OperationError);
    expect(() => resizeClip(s0, 'a', -1)).toThrow(OperationError);
  });

  it('throws CLIP_NOT_FOUND when clipId is unknown', () => {
    expect(() => resizeClip(makeState(), 'missing', 4)).toThrow(OperationError);
  });

  it('throws OVERLAP when the new length would extend into another clip on the same track', () => {
    const s0 = freezeState(
      makeState({
        clips: [
          makeClip({ id: 'a', trackId: 't1', kind: 'contour', startBeat: 0, lengthBeats: 4 }),
          makeClip({ id: 'b', trackId: 't1', kind: 'contour', startBeat: 8, lengthBeats: 4 })
        ]
      })
    );
    expect(() => resizeClip(s0, 'a', 10)).toThrow(OperationError); // would overlap 'b' (starts at 8)
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
export function resizeClip(
  state: TimelineState,
  clipId: string,
  newLengthBeats: number
): TimelineState {
  if (newLengthBeats <= 0) {
    throw new OperationError(
      'INVALID_LENGTH',
      `Clip length must be > 0 (got ${newLengthBeats})`
    );
  }
  const idx = state.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) {
    throw new OperationError('CLIP_NOT_FOUND', `Clip ${clipId} not found`);
  }
  const clip = state.clips[idx];
  if (hasOverlap(state, clip.trackId, clip.startBeat, newLengthBeats, clipId)) {
    throw new OperationError(
      'OVERLAP',
      `Resizing clip ${clipId} to ${newLengthBeats} beats would overlap an existing clip`
    );
  }
  const next = state.clips.slice();
  next[idx] = { ...clip, lengthBeats: newLengthBeats };
  return { ...state, clips: next };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/timeline/operations.ts tests/unit/timeline/operations.test.ts
git commit -m "feat(timeline): resizeClip (INVALID_LENGTH / CLIP_NOT_FOUND / OVERLAP)"
```

---

## Task 10: Remaining operations bundle — `removeClip`, `setClipParams`, `setPlayhead`, `setMuted`

**Files:**

- Modify: `lib/timeline/operations.ts`
- Modify: `tests/unit/timeline/operations.test.ts`

> These four operations are mechanically simple. They are bundled into one task to avoid 4× boilerplate commits without losing the per-function tests.

- [ ] **Step 1: Add failing tests**

```ts
import { removeClip, setClipParams, setPlayhead, setMuted } from '@/lib/timeline/operations';

describe('removeClip', () => {
  it('returns a new state without the named clip', () => {
    const s0 = freezeState(
      makeState({
        clips: [
          makeClip({ id: 'a', trackId: 't1', kind: 'contour' }),
          makeClip({ id: 'b', trackId: 't2', kind: 'pulse' })
        ]
      })
    );
    const s1 = removeClip(s0, 'a');
    expect(s1.clips.map((c) => c.id)).toEqual(['b']);
    expect(s0.clips).toHaveLength(2);
  });

  it('throws CLIP_NOT_FOUND when clipId is unknown', () => {
    expect(() => removeClip(makeState(), 'x')).toThrow(OperationError);
  });
});

describe('setClipParams', () => {
  it('shallow-merges params and returns a new state', () => {
    const s0 = freezeState(
      makeState({
        clips: [
          makeClip({
            id: 'a',
            trackId: 't1',
            kind: 'contour',
            params: { threshold: 0.5, color: '#fff' }
          })
        ]
      })
    );
    const s1 = setClipParams(s0, 'a', { threshold: 0.8 });
    expect(s1.clips[0].params).toEqual({ threshold: 0.8, color: '#fff' });
    expect(s0.clips[0].params).toEqual({ threshold: 0.5, color: '#fff' });
  });

  it('initializes params if previously undefined', () => {
    const s0 = freezeState(
      makeState({
        clips: [makeClip({ id: 'a', trackId: 't1', kind: 'contour' })]
      })
    );
    const s1 = setClipParams(s0, 'a', { x: 1 });
    expect(s1.clips[0].params).toEqual({ x: 1 });
  });

  it('throws CLIP_NOT_FOUND when clipId is unknown', () => {
    expect(() => setClipParams(makeState(), 'x', {})).toThrow(OperationError);
  });
});

describe('setPlayhead', () => {
  it('updates beats while preserving the playing flag', () => {
    const s0 = freezeState(makeState({ playhead: { beats: 0, playing: true } }));
    const s1 = setPlayhead(s0, 12);
    expect(s1.playhead).toEqual({ beats: 12, playing: true });
    expect(s0.playhead.beats).toBe(0);
  });

  it('clamps negative beats to 0', () => {
    const s0 = freezeState(makeState());
    const s1 = setPlayhead(s0, -5);
    expect(s1.playhead.beats).toBe(0);
  });
});

describe('setMuted', () => {
  it('toggles the muted flag on the named track', () => {
    const s0 = freezeState(
      makeState({
        tracks: [{ id: 't1', kind: 'contour', name: 'c', muted: false, order: 0 }]
      })
    );
    const s1 = setMuted(s0, 't1', true);
    expect(s1.tracks[0].muted).toBe(true);
    expect(s0.tracks[0].muted).toBe(false);
  });

  it('throws TRACK_NOT_FOUND when trackId is unknown', () => {
    expect(() => setMuted(makeState(), 'x', true)).toThrow(OperationError);
  });
});
```

- [ ] **Step 2: Run — expect 10 failures**

- [ ] **Step 3: Implement**

Append to `lib/timeline/operations.ts`:

```ts
export function removeClip(state: TimelineState, clipId: string): TimelineState {
  const idx = state.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) throw new OperationError('CLIP_NOT_FOUND', `Clip ${clipId} not found`);
  const next = state.clips.slice();
  next.splice(idx, 1);
  return { ...state, clips: next };
}

export function setClipParams(
  state: TimelineState,
  clipId: string,
  params: Record<string, unknown>
): TimelineState {
  const idx = state.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) throw new OperationError('CLIP_NOT_FOUND', `Clip ${clipId} not found`);
  const clip = state.clips[idx];
  const next = state.clips.slice();
  next[idx] = { ...clip, params: { ...clip.params, ...params } };
  return { ...state, clips: next };
}

export function setPlayhead(state: TimelineState, beats: number): TimelineState {
  const clamped = Math.max(0, beats);
  if (clamped === state.playhead.beats) return state;
  return { ...state, playhead: { ...state.playhead, beats: clamped } };
}

export function setMuted(state: TimelineState, trackId: string, muted: boolean): TimelineState {
  const idx = state.tracks.findIndex((t) => t.id === trackId);
  if (idx < 0) throw new OperationError('TRACK_NOT_FOUND', `Track ${trackId} not found`);
  if (state.tracks[idx].muted === muted) return state;
  const next = state.tracks.slice();
  next[idx] = { ...next[idx], muted };
  return { ...state, tracks: next };
}
```

- [ ] **Step 4: Run — expect PASS (10 tests added)**

- [ ] **Step 5: Commit**

```bash
git add lib/timeline/operations.ts tests/unit/timeline/operations.test.ts
git commit -m "feat(timeline): removeClip / setClipParams / setPlayhead / setMuted"
```

---

## Task 11: Zustand store integration — timeline slice

**Files:**

- Create: `lib/store/timeline-slice.ts`
- Modify: `lib/store/types.ts`
- Modify: `lib/store/index.ts`
- Create: `tests/unit/store/timeline-slice.test.ts`

> The slice mirrors the pure operations as store actions. Each action re-throws `OperationError` so the UI layer (Plan 5) can `try/catch` and toast. `partialize` must be extended to include the timeline state (without re-persisting actions).

- [ ] **Step 1: Modify `lib/store/types.ts`**

```ts
import type { TimelineState, Clip } from '@/lib/timeline/types';

export interface UIState {
  zoom: number;
  inspectorOpen: boolean;
}

export interface TimelineActions {
  addClip(clip: Clip): void;
  moveClip(clipId: string, newStartBeat: number): void;
  resizeClip(clipId: string, newLengthBeats: number): void;
  removeClip(clipId: string): void;
  setClipParams(clipId: string, params: Record<string, unknown>): void;
  setPlayhead(beats: number): void;
  setMuted(trackId: string, muted: boolean): void;
}

export interface AppState {
  ui: UIState;
  setZoom(zoom: number): void;
  setInspectorOpen(open: boolean): void;
  timeline: TimelineState;
  timelineActions: TimelineActions;
}
```

> Grouping timeline actions under `timelineActions` keeps the top-level keyset tidy and makes the `partialize` exclusion trivial (drop one key, not seven).

- [ ] **Step 2: Write the slice**

`lib/store/timeline-slice.ts`:

```ts
import type { StateCreator } from 'zustand';
import type { AppState } from './types';
import type { TimelineState } from '@/lib/timeline/types';
import * as ops from '@/lib/timeline/operations';

export const initialTimelineState: TimelineState = {
  tracks: [],
  clips: [],
  playhead: { beats: 0, playing: false },
  zoom: 1,
  snap: 'beat'
};

export const createTimelineSlice: StateCreator<
  AppState,
  [],
  [],
  Pick<AppState, 'timeline' | 'timelineActions'>
> = (set, get) => ({
  timeline: initialTimelineState,
  timelineActions: {
    addClip: (clip) => set({ timeline: ops.addClip(get().timeline, clip) }),
    moveClip: (clipId, newStartBeat) =>
      set({ timeline: ops.moveClip(get().timeline, clipId, newStartBeat) }),
    resizeClip: (clipId, newLengthBeats) =>
      set({ timeline: ops.resizeClip(get().timeline, clipId, newLengthBeats) }),
    removeClip: (clipId) => set({ timeline: ops.removeClip(get().timeline, clipId) }),
    setClipParams: (clipId, params) =>
      set({ timeline: ops.setClipParams(get().timeline, clipId, params) }),
    setPlayhead: (beats) => set({ timeline: ops.setPlayhead(get().timeline, beats) }),
    setMuted: (trackId, muted) =>
      set({ timeline: ops.setMuted(get().timeline, trackId, muted) })
  }
});
```

- [ ] **Step 3: Modify `lib/store/index.ts`**

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppState } from './types';
import { createTimelineSlice } from './timeline-slice';

export const useAppStore = create<AppState>()(
  persist(
    (set, get, store) => ({
      ui: { zoom: 1, inspectorOpen: true },
      setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
      setInspectorOpen: (open) => set((s) => ({ ui: { ...s.ui, inspectorOpen: open } })),
      ...createTimelineSlice(set, get, store)
    }),
    {
      name: 'vibegrid-store',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Persist only serializable data slices — never actions, never blobs.
      partialize: (state) => ({
        ui: state.ui,
        timeline: state.timeline
      })
    }
  )
);
```

- [ ] **Step 4: Write the slice test**

`tests/unit/store/timeline-slice.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { initialTimelineState } from '@/lib/store/timeline-slice';
import { OperationError } from '@/lib/timeline/operations';

describe('timeline store slice', () => {
  beforeEach(() => {
    useAppStore.setState({ timeline: initialTimelineState });
  });

  it('exposes initialTimelineState as the default', () => {
    expect(useAppStore.getState().timeline).toEqual(initialTimelineState);
  });

  it('addClip mutates the store via the pure operation', () => {
    useAppStore.getState().timelineActions.addClip({
      id: 'a',
      trackId: 't1',
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'a'
    });
    expect(useAppStore.getState().timeline.clips).toHaveLength(1);
  });

  it('addClip re-throws OperationError on overlap so the UI can catch it', () => {
    const { timelineActions } = useAppStore.getState();
    timelineActions.addClip({
      id: 'a',
      trackId: 't1',
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 8,
      label: 'a'
    });
    expect(() =>
      timelineActions.addClip({
        id: 'b',
        trackId: 't1',
        kind: 'contour',
        startBeat: 4,
        lengthBeats: 4,
        label: 'b'
      })
    ).toThrow(OperationError);
  });

  it('setPlayhead updates the timeline.playhead.beats', () => {
    useAppStore.getState().timelineActions.setPlayhead(10);
    expect(useAppStore.getState().timeline.playhead.beats).toBe(10);
  });
});
```

- [ ] **Step 5: Run all timeline + store tests — expect PASS**

```
npm test -- timeline
npm test -- store
```

- [ ] **Step 6: Commit**

```bash
git add lib/store/timeline-slice.ts lib/store/types.ts lib/store/index.ts tests/unit/store/timeline-slice.test.ts
git commit -m "feat(store): integrate timeline slice (actions re-throw OperationError)"
```

---

## Task 12: Final verification gate

- [ ] **Step 1: Run typecheck**

```
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run lint**

```
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Run timeline + store tests**

```
npm test -- timeline
npm test -- store
```

Expected: all green; combined ≥ 30 tests across selectors + operations + slice.

- [ ] **Step 4: Run the full test suite (catch regressions in the smoke + isClient tests)**

```
npm test
```

Expected: every prior test still passes.

- [ ] **Step 5: Run production build (catches store-import cycles)**

```
npm run build
```

Expected: PASS.

---

## Done condition

All 12 tasks committed, all five verification steps green. The timeline module is a pure, fully-tested core with a Zustand slice wrapping it. **Plan 2 (Audio) can start.**

## Decisions resolved during review (2026-05-19)

1. **resizeClip overlap check** — KEEP. Invariant consistency with add/move trumps strict spec literalism.
2. **Mute filtering in selectors** — selectors do NOT filter mute. Renderer honors `track.muted` at draw time.
3. **`setClipParams`** — shallow merge `{ ...existing, ...incoming }`. Inspector sliders update single params.
4. **Timecode format** — `m:ss` under 1 h, `h:mm:ss` at or above 1 h. Minutes NOT zero-padded under 1 h (`0:30`, `4:00`). Documented in `beatsToTimecode`'s JSDoc (Task 6).
5. **`addClip` ID-generation** — Caller provides `clip.id`. Operations stay pure — no `crypto.randomUUID()` inside the operation. Documented in `addClip`'s JSDoc (Task 7).
