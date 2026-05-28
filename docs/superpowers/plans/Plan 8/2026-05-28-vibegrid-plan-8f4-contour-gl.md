# Plan 8f.4 — Contour GL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a GPU-native Contour effect (`contour-gl`) that mirrors the Canvas2D Contour FX's visual intent (edge outline + directional sweep) but runs as a fragment-shader pass on the already-composed canvas — same architectural pattern as Plan 8f.3 Edge Glow.

**Architecture:**
- Single-pass fragment shader using `renderGlFx({ source: 'canvas' })` (re-uses Edge Glow's chain-composition pipeline).
- **9-tap Sobel** on luma → edge magnitude.
- **Dilate-Pass** (5-sample box-max at radius `dilatePx`) widens the edge mask, giving honest variable `lineWidth` control.
- **Sweep gating** with linear alpha falloff (`1 - dist/REVEAL_TRAIL`) — same math as the Canvas2D Contour's reveal window, ported to GLSL.
- **Stipple-Hash** dashing: `dashLength` semantics replaced by `stippleSize` (cell-size in px); per-cell hash gates 50/50 of pixels.
- Per-clip beat-sync envelope identical to Edge Glow (Plan 8g pattern): `beatSync` slider 0/1, Flow Mode + Beat Mode share the `env` machinery.
- Output is RGBA with `alpha = edge` → composes cleanly over the underlying frame (no background dimming, unlike Edge Glow which has `bgOpacity`).

**Tech Stack:** WebGL2 (GLSL ES 300), TypeScript strict, Vitest. No new dependencies.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/renderer/webgl/programs/contour-gl.ts` | Create | Fragment shader source string (`CONTOUR_GL_FRAG_SRC`). |
| `lib/fx/contour-gl.ts` | Create | FX plugin (schema, defaults, preload, render). |
| `tests/unit/webgl/contour-gl-shader.test.ts` | Create | Shader-string sanity: uniform declarations, Sobel kernel signature, sweep branching. |
| `tests/unit/fx/contour-gl.test.ts` | Create | Plugin behaviour: defaults, source='canvas', uniform passing, beat-sync envelope, dilatePx mapping, sweep direction encoding. |
| `lib/renderer/types.ts` | Modify | Add `'ContourGL'` to `FxKind`. |
| `lib/timeline/plugin-mapping.ts` | Modify | Add `'contour-gl'` to `TRACK_FX_KINDS`, `PluginFxKind`, both kind-maps, `RENDER_ORDER_TRACK_KIND` (after `'edge-glow'`), `FX_DISPLAY_NAME`, `FX_CLIP_COLORS`. |
| `lib/fx/index.ts` | Modify | Import + register `contourGlPlugin`. |
| `tests/unit/renderer/plugin-contract.test.ts` | Modify | Add `'ContourGL'` to `ALL_PLUGIN_KINDS`, `'contour-gl'` to `ALL_PLUGIN_IDS`, bump count assertion 20 → 21. |

---

## Parameter Schema

| Param | Type | Range | Default | Notes |
|---|---|---|---|---|
| `color` | color | — | `#a86bff` | Stroke color (matches old Contour default purple). |
| `threshold` | slider | 0.05–0.40 step 0.01 | 0.15 | Sobel magnitude threshold. |
| `lineWidth` | slider | 0.5–4 step 0.1 px | 1.0 | Maps to `dilatePx` ∈ [0, 2] via linear: `(lineWidth - 0.5) * (2/3.5)`. |
| `stippleSize` | slider | 0–20 step 1 px | 0 | 0 = solid. Cell-size for hash stipple. |
| `sweepDirection` | select | 9 values | `all` | `all` disables sweep gating. Same option set as Canvas2D Contour. |
| `sweepSpeed` | slider | 0.25–4 step 0.25 cyc/bar | 1 | `visibleWhen: p.sweepDirection !== 'all'`. |
| `intensity` | slider | 0–1 step 0.05 | 1.0 | Multiplied with `env` into `u_intensity`. |
| `decay` | slider | 0.01–0.5 step 0.01 beats | 0.25 | Beat-mode envelope decay. |
| `beatSync` | slider | 0–1 step 1 | 1 | 0 = constant (Flow-like), 1 = beat-decay. Plan 8g pattern. |

---

## Render-Order Position

Contour GL is `source: 'canvas'` like Edge Glow, so it samples the already-composed frame. It belongs in the image-modifying group, immediately after `'edge-glow'` (which also reads the composed canvas):

```
… → edge-glow → contour-gl → (overlay FX: sweep, particles, …)
```

Stacking Contour GL after Edge Glow means: if both are on the same clip, Contour GL sees Edge Glow's output (which is what the user expects visually — "outline on top of glow").

---

## Sweep Phase Math (identical to Canvas2D Contour)

```ts
const BEATS_PER_BAR = 4;
const cycleBeats = BEATS_PER_BAR / Math.max(0.01, params.sweepSpeed);
const cyclePos =
  (((rc.beatIndex + rc.beatPhase) % cycleBeats) + cycleBeats) % cycleBeats;
const sweepPhase = cyclePos / cycleBeats; // 0..1
```

Direction is encoded as a float uniform (the pipeline's uniform uploader supports number/vec2/vec4 only — no int path), with the shader branching on float comparisons:

| dir | code |
|---|---|
| `all` | 0 |
| `lr` | 1 |
| `rl` | 2 |
| `tb` | 3 |
| `bt` | 4 |
| `bl-tr` | 5 |
| `tl-br` | 6 |
| `tr-bl` | 7 |
| `br-tl` | 8 |

`REVEAL_TRAIL = 0.2` (linear falloff, user decision #1).

---

## Tasks

### T1 — Shader + shader tests

**Files:**
- Create: `lib/renderer/webgl/programs/contour-gl.ts`
- Create: `tests/unit/webgl/contour-gl-shader.test.ts`

- [ ] **Step 1: Write the failing shader tests**

```ts
import { describe, it, expect } from 'vitest';
import { CONTOUR_GL_FRAG_SRC } from '@/lib/renderer/webgl/programs/contour-gl';

describe('CONTOUR_GL_FRAG_SRC', () => {
  it('declares all FX uniforms', () => {
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+vec2\s+u_resolution/);
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+float\s+u_threshold/);
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+vec4\s+u_color/);
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+float\s+u_dilate_px/);
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+float\s+u_stipple_size/);
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+float\s+u_sweep_dir/);
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+float\s+u_sweep_phase/);
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+float\s+u_reveal_trail/);
    expect(CONTOUR_GL_FRAG_SRC).toMatch(/uniform\s+float\s+u_intensity/);
  });
  it('uses 9-tap Sobel kernel signature (-1, -2, 1, 2 coefficients)', () => {
    expect(CONTOUR_GL_FRAG_SRC).toContain('-2.0');
    expect(CONTOUR_GL_FRAG_SRC).toContain('2.0');
    expect(CONTOUR_GL_FRAG_SRC.match(/luma/g)?.length).toBeGreaterThanOrEqual(9);
  });
  it('branches sweep direction on 8 cardinal/diagonal values', () => {
    // Float comparisons at 0.5..7.5 boundaries (8 dirs ≠ 'all').
    expect(CONTOUR_GL_FRAG_SRC.match(/u_sweep_dir/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (file does not exist)**

Run: `npx vitest run tests/unit/webgl/contour-gl-shader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement shader**

Create `lib/renderer/webgl/programs/contour-gl.ts` with the full shader (see plan body — Sobel + dilate + sweep + stipple + alpha out).

- [ ] **Step 4: Run shader tests to verify they pass**

Run: `npx vitest run tests/unit/webgl/contour-gl-shader.test.ts`
Expected: PASS.

### T2 — Plugin + plugin tests

**Files:**
- Create: `lib/fx/contour-gl.ts`
- Create: `tests/unit/fx/contour-gl.test.ts`

- [ ] **Step 1: Write failing plugin tests** mirroring `tests/unit/fx/edge-glow.test.ts`:
  - default params match schema
  - kind=ContourGL, defaultTrigger=beat
  - skips renderGlFx when env < 0.01 in Beat Mode
  - Flow Mode pins env=1.0
  - source='canvas'
  - all uniforms passed with correct values
  - `beatSync=0` pins env=1.0 in Beat Mode
  - `sweepDirection='all'` → `u_sweep_dir = 0`
  - `sweepDirection='lr'` → `u_sweep_dir = 1`, `u_sweep_phase` in [0,1]
  - `lineWidth=0.5` → `u_dilate_px ≈ 0`
  - `lineWidth=4.0` → `u_dilate_px ≈ 2`
  - `stippleSize=0` → `u_stipple_size = 0`
  - `u_resolution` taken from `rc.ctx.canvas` dims (800, 450 in mock)

- [ ] **Step 2: Run tests to verify they fail** — module not found.

- [ ] **Step 3: Implement plugin** at `lib/fx/contour-gl.ts`. Re-use `_hexToRgba01` from `./edge-glow` (already exported for tests).

- [ ] **Step 4: Run plugin tests to verify they pass.**

### T3 — Wire types + registry + plugin-mapping

**Files:**
- Modify: `lib/renderer/types.ts:31-56` (FxKind union)
- Modify: `lib/timeline/plugin-mapping.ts` (TRACK_FX_KINDS, PluginFxKind, both kind-maps, RENDER_ORDER_TRACK_KIND, FX_DISPLAY_NAME, FX_CLIP_COLORS)
- Modify: `lib/fx/index.ts:25,60` (import + register)

- [ ] **Step 1: Add `'ContourGL'` to `FxKind`** in `lib/renderer/types.ts`.
- [ ] **Step 2: Add `'contour-gl'` to all `plugin-mapping.ts` constants.** Insert immediately after `'edge-glow'` in `TRACK_FX_KINDS` and `RENDER_ORDER_TRACK_KIND`. Display name: `'Contour GL'`. Clip color: `'#7a4bff'` (deeper purple than Contour's `#a86bff`, distinguishable on timeline).
- [ ] **Step 3: Register plugin** in `lib/fx/index.ts` (import line + `register(contourGlPlugin)` call). Comment: `// Plan 8f.4 — fourth WebGL2 FX (Contour GL: chain-composed Sobel outline).`

### T4 — Bump contract + mapping tests

**Files:**
- Modify: `tests/unit/renderer/plugin-contract.test.ts` (ALL_PLUGIN_KINDS, ALL_PLUGIN_IDS, count assertion)
- Modify: `tests/unit/timeline/plugin-mapping.test.ts` (if it has count assertions)

- [ ] **Step 1: Add `'ContourGL'` to `ALL_PLUGIN_KINDS` and `'contour-gl'` to `ALL_PLUGIN_IDS`** in plugin-contract test.
- [ ] **Step 2: Bump `expect(listPlugins().length).toBe(20)` → `21`** and update the message string `'(v0.1 + Plan 5.8a + Plan 8e + Plan 8f.1 + Plan 8f.2 + Plan 8f.3 + Plan 8f.4)'`.
- [ ] **Step 3: Check plugin-mapping.test.ts** for any count/exhaustive assertions that need bumping.

### T5 — Verification Gate

- [ ] `npm run typecheck` — must pass.
- [ ] `npm run lint` — must pass.
- [ ] `npm test` — all unit + integration tests green (expect +~15 new tests).
- [ ] `npm run build` — `next build` succeeds.

---

## Out of Scope

- Replacing the existing Canvas2D `contour` FX. Contour GL ships **alongside** it. Existing clips remain untouched.
- True parametric dashed lines (Canvas2D `setLineDash` semantics). Replaced by Stipple-Hash per user decision #2.
- Animated colour gradient (`colorEnd` like Edge Glow). Can be added later if requested.
- Sweep angle other than the 8 cardinal/diagonal directions.
- Live-smoke gating — author runs a manual smoke after commit, but the gate is "tests + build green", not "user verified browser".
