# Plan 8f.3 — Edge Glow (GPU-native FX + Variante B Chain-Composition)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new beat-synchron WebGL2-FX **"Edge Glow"** (CapCut/Canva-Look: Sobel-Outline + glow-band) als **separates Plugin** neben dem bestehenden `Contour`. Bestehender Contour bleibt unverändert. Gleichzeitig wird `renderGlFx` um eine **`source: 'bitmap' | 'canvas'`-Option** erweitert, sodass Edge Glow den **bereits composed Frame** (post-ColorGradeShift / post-RetroVHS) sampelt statt nur das Original-Bitmap.

**Architecture:** Single-pass Fragment-Shader (9-Tap Sobel auf Luma → smoothstep-Edge mit `glowAmount`-Bandbreite → Mix mit BG nach `bgOpacity` & beat-decayed `intensity`). Pipeline-Erweiterung um `source='canvas'` lädt `rc.ctx.canvas` per `texSubImage2D` statt `rc.imageBitmap` und setzt `u_contain` auf Identity. Plugin folgt dem RetroVHS-Pattern (Beat-Decay + Flow-Mode-Override). Default-Param-Werte zielen direkt auf den "Cyber-Neon"-Look.

**Tech Stack:** TypeScript strict, WebGL2 (vorhandene `lib/renderer/webgl/`-Infra), Zustand‑agnostisch (FX-Plugin), Vitest + Mock-GL aus `tests/setup/webgl-mock.ts`.

**Baseline:** HEAD post-Plan-10, 1279 Tests, Store v6, alle Verification-Gates grün.

**Bekannte Limitation (dokumentiert, kein Blocker):** Stacken von **ColorGradeShift + RetroVHS auf einer Clip** bleibt "last writer wins" (beide nutzen `source='bitmap'`). Edge Glow chained korrekt AUF die letzte Image-Modifying-FX-Ausgabe, weil es `source='canvas'` nutzt. Ein Folge-Plan (8f.4) kann CGS/VHS auf `source='canvas'` opten.

---

## Undo-Behaviour

| Action | Behandlung |
|---|---|
| Edge-Glow-Param-Änderungen (threshold, color, etc.) | bestehend via `setClipParam` → `record + coalesce` |
| Neuer FX-Clip via Inspector | bestehend via `addClip` → `record` |
| Renderer-Implementation | kein Store-State — kein Undo-Impact |

Reine FX-Addition — keine neuen Store-Actions, kein Undo-Impact auf bestehende Infrastruktur.

---

## Schritt 0 — Pre-Read (PFLICHT, vor Task 1)

Damit die Plan-Bezüge stimmen, vor erster Code-Änderung lesen:

- `lib/fx/color-grade-shift.ts` — Referenz-Plugin (preload-Pattern, render-Skip, renderGlFx-Call)
- `lib/fx/retro-vhs.ts` — Referenz mit Flow-Mode-Override
- `lib/renderer/webgl/pipeline.ts` — `renderGlFx`-API, dort wird `source` ergänzt
- `lib/renderer/webgl/texture.ts` — `uploadImageBitmap`, wird generalisiert
- `lib/renderer/webgl/programs/color-grade.ts` — Shader-Struktur als Vorlage
- `lib/timeline/plugin-mapping.ts` — wo Edge Glow registriert wird (3 Maps + Render-Order)
- `lib/renderer/types.ts` — `FxKind`-Union, wo `'EdgeGlow'` ergänzt wird
- `tests/setup/webgl-mock.ts` — Mock-GL für Shader-Tests
- `tests/unit/fx/color-grade-shift.test.ts` — Test-Vorlage

**Test-Zahl notieren (vor Plan-Start):** Erwartung `1279`. Nach Plan: ≥ `1279 + 14 = 1293`.

---

## Schritt 0.5 — Baseline-Messung (optional, vor Task 7)

Vor Edge-Glow-Plugin: ColorGradeShift auf einem 1080p-Image-Clip messen (avg + p99 ms / Frame über 5 s Playback). Methode: die gleiche Instrumentierung wie in der Plan-9 Diagnose-Session (`fx-ColorGradeShift` performance-mark). Erwartung: **avg 1.0–2.5 ms, p99 < 5 ms**. Ergebnis im PR-Body festhalten. Liefert die ehrliche Vergleichszahl für Edge Glow (das mit 9 Sobel-Taps + 2 Texture-Reads in der gleichen Größenordnung liegen soll).

Wenn nicht möglich (kein Live-Dev-Setup): skip, im PR-Body als "nicht gemessen" markieren.

---

## File Structure

| Datei | Aktion | Verantwortung |
|---|---|---|
| `lib/renderer/webgl/texture.ts` | MODIFY | `uploadImageBitmap` umbenennen/erweitern → `uploadTextureSource` mit `TexImageSource`-Param |
| `lib/renderer/webgl/pipeline.ts` | MODIFY | `RenderGlFxArgs.source?: 'bitmap' \| 'canvas'`; Source-Switch; `u_contain` auf Identity bei `'canvas'` |
| `lib/renderer/webgl/programs/edge-glow.ts` | CREATE | `EDGE_GLOW_FRAG_SRC` — Single-Pass Sobel + smoothstep-Glow |
| `lib/fx/edge-glow.ts` | CREATE | `edgeGlowPlugin` — Param-Schema, render-Logik, hex→vec4 Helper |
| `lib/fx/index.ts` | MODIFY | `register(edgeGlowPlugin)` |
| `lib/renderer/types.ts` | MODIFY | `FxKind` += `'EdgeGlow'` |
| `lib/timeline/plugin-mapping.ts` | MODIFY | `TRACK_FX_KINDS` += `'edge-glow'`; alle 4 Maps; `RENDER_ORDER_TRACK_KIND` nach `'retro-vhs'` |
| `tests/unit/webgl/pipeline-source.test.ts` | CREATE | renderGlFx mit `source='canvas'` lädt aus `rc.ctx.canvas`, `u_contain` ist Identity (4 Tests) |
| `tests/unit/fx/edge-glow.test.ts` | CREATE | Plugin-Verhalten: 6 Uniforms, hex-Conversion, env-Skip, Flow-Mode, preload (8 Tests) |
| `tests/unit/webgl/edge-glow-shader.test.ts` | CREATE | Shader-Source enthält erwartete Uniforms + Sobel-Konstanten (2 Tests) |
| `docs/KNOWN_LIMITATIONS.md` | MODIFY | "Stacking WebGL Kategorie-A FX" als bekannter Bug + Edge-Glow-Workaround |
| `CLAUDE.md` | MODIFY | Plan-Tabelle: 8f.3 ✅ Done, Next-Up entsprechend |

---

## Task 1: Pipeline — `uploadTextureSource` generalisieren

**Files:**
- Modify: `lib/renderer/webgl/texture.ts`

Heute nimmt `uploadImageBitmap(gl, bm: ImageBitmap)` nur ImageBitmaps. WebGL2 `texSubImage2D` akzeptiert aber jeden `TexImageSource` (inkl. `HTMLCanvasElement`, `OffscreenCanvas`). Wir erweitern die Funktion, damit sie auch Canvas-Quellen verarbeitet. Existing Callers bleiben kompatibel über einen Re-Export.

- [ ] **Step 1: Test — neues Test-File für `uploadTextureSource`**

Datei: `tests/unit/webgl/texture-source.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMockGL, type MockGL } from '../../setup/webgl-mock';

describe('uploadTextureSource', () => {
  let gl: MockGL;
  beforeEach(() => {
    gl = createMockGL();
  });
  afterEach(() => {
    // Mock GL is per-test; nothing global.
  });

  it('uploads an ImageBitmap-shaped source (back-compat)', async () => {
    const { uploadTextureSource } = await import('@/lib/renderer/webgl/texture');
    const bm = { width: 100, height: 50 } as unknown as ImageBitmap;
    uploadTextureSource(gl, bm, bm.width, bm.height);
    const calls = gl.__calls.map((c) => c.method);
    expect(calls).toContain('texImage2D');
    expect(calls).toContain('texSubImage2D');
  });

  it('uploads a Canvas-shaped source (HTMLCanvasElement / OffscreenCanvas)', async () => {
    const { uploadTextureSource } = await import('@/lib/renderer/webgl/texture');
    const canvas = { width: 800, height: 450 } as unknown as HTMLCanvasElement;
    uploadTextureSource(gl, canvas, canvas.width, canvas.height);
    const calls = gl.__calls.map((c) => c.method);
    expect(calls).toContain('texSubImage2D');
  });

  it('reuses texture when dimensions match across calls', async () => {
    const { uploadTextureSource } = await import('@/lib/renderer/webgl/texture');
    const bm = { width: 100, height: 50 } as unknown as ImageBitmap;
    uploadTextureSource(gl, bm, bm.width, bm.height);
    uploadTextureSource(gl, bm, bm.width, bm.height);
    const allocs = gl.__calls.filter((c) => c.method === 'texImage2D').length;
    // 1 alloc at first call, 0 at second (dimensions unchanged).
    expect(allocs).toBe(1);
  });

  it('reallocates texture when dimensions change', async () => {
    const { uploadTextureSource } = await import('@/lib/renderer/webgl/texture');
    const a = { width: 100, height: 50 } as unknown as ImageBitmap;
    const b = { width: 200, height: 100 } as unknown as ImageBitmap;
    uploadTextureSource(gl, a, a.width, a.height);
    uploadTextureSource(gl, b, b.width, b.height);
    const allocs = gl.__calls.filter((c) => c.method === 'texImage2D').length;
    expect(allocs).toBe(2);
  });
});
```

- [ ] **Step 2: Run test — verify all 4 fail**

```bash
npx vitest run tests/unit/webgl/texture-source.test.ts
```

Expected: 4 × FAIL with "uploadTextureSource is not a function".

- [ ] **Step 3: Implement — refactor `texture.ts`**

Replace the entire body of `lib/renderer/webgl/texture.ts` with:

```ts
/**
 * Plan 8f.1 + 8f.3 — Texture-Source → WebGL2-Texture mit Reuse.
 *
 * Ein Texture-Slot pro GL-Context, persistiert über die Lifetime des
 * Context-Eintrags. Pro Frame wird `texSubImage2D` aufgerufen (kein
 * GPU-Realloc) — bei einer Auflösungsänderung (z.B. 1080p→4K Export)
 * wird via `texImage2D` neu allokiert.
 *
 * Plan 8f.3: source ist generalisiert auf `TexImageSource` —
 * ImageBitmap (Default), HTMLCanvasElement, OffscreenCanvas (für
 * `renderGlFx`-Variante mit `source='canvas'`, die den bereits
 * composed Main-Canvas-Frame als Edge-Glow-Input nutzt).
 *
 * `UNPACK_FLIP_Y_WEBGL = false`: die Y-Achsen-Korrektur passiert
 * deterministisch im Quad-Buffer (siehe `quad.ts`). Der explizite
 * `pixelStorei`-Call hier ist trotzdem nötig, weil das Pixel-Storage-
 * State per GL-Context lebt.
 */

interface TextureEntry {
  tex: WebGLTexture;
  width: number;
  height: number;
}

const textureByCtx = new WeakMap<WebGL2RenderingContext, TextureEntry>();

export function uploadTextureSource(
  gl: WebGL2RenderingContext,
  source: TexImageSource,
  width: number,
  height: number
): WebGLTexture {
  let entry = textureByCtx.get(gl);

  if (!entry) {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null
    );
    entry = { tex, width, height };
    textureByCtx.set(gl, entry);
  }

  gl.bindTexture(gl.TEXTURE_2D, entry.tex);

  if (entry.width !== width || entry.height !== height) {
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null
    );
    entry.width = width;
    entry.height = height;
  }

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texSubImage2D(
    gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source
  );
  return entry.tex;
}

/**
 * Plan 8f.1 back-compat alias. New code should use `uploadTextureSource`.
 * Kept so existing pipeline.ts code paths (and any external consumers)
 * don't need to be touched in this commit.
 */
export function uploadImageBitmap(
  gl: WebGL2RenderingContext,
  bm: ImageBitmap
): WebGLTexture {
  return uploadTextureSource(gl, bm, bm.width, bm.height);
}
```

- [ ] **Step 4: Run test — verify all pass**

```bash
npx vitest run tests/unit/webgl/texture-source.test.ts
```

Expected: 4 × PASS.

- [ ] **Step 5: Full suite — confirm no regression**

```bash
npm run typecheck && npx vitest run
```

Expected: typecheck clean, 1279 + 4 = 1283 Tests grün.

- [ ] **Step 6: Commit**

```bash
git add lib/renderer/webgl/texture.ts tests/unit/webgl/texture-source.test.ts
git commit -m "refactor(webgl): generalize uploadImageBitmap → uploadTextureSource

Plan 8f.3 prep — accept any TexImageSource so renderGlFx can later
sample HTMLCanvasElement / OffscreenCanvas (chain-composition).
uploadImageBitmap kept as back-compat alias.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Pipeline — `source` Option auf `renderGlFx`

**Files:**
- Modify: `lib/renderer/webgl/pipeline.ts`
- Create: `tests/unit/webgl/pipeline-source.test.ts`

API-Erweiterung: `RenderGlFxArgs` bekommt ein optionales `source: 'bitmap' | 'canvas'`. Default `'bitmap'` (existing behavior). Bei `'canvas'` wird `rc.ctx.canvas` hochgeladen und `u_contain` auf Identity `(0, 0, 1, 1)` gesetzt — der gesamte Texture-Bereich entspricht dem Frame.

- [ ] **Step 1: Test — `source='canvas'` upload + identity u_contain**

Datei: `tests/unit/webgl/pipeline-source.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupWebGLMock, teardownWebGLMock, type MockGL } from '../../setup/webgl-mock';
import { _overrideCapabilities, _resetCapabilities } from '@/lib/renderer/webgl/capabilities';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';
import { makeRenderContext } from '../renderer/_helpers';

const TINY_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec4 u_contain;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 fragColor;
void main(){ fragColor = texture(u_image, v_texCoord); }`;

describe('renderGlFx — source option', () => {
  let gl: MockGL;
  beforeEach(async () => {
    _overrideCapabilities({
      webgl2: true, maxTextureSize: 4096, highPrecision: true,
      isMobile: false, tier: 'high', maxParticles: 500, maxRaySteps: 64
    });
    gl = await setupWebGLMock();
  });
  afterEach(async () => {
    await teardownWebGLMock();
    _resetCapabilities();
  });

  it("source='bitmap' (default) uploads from rc.imageBitmap", () => {
    const rc = makeRenderContext();
    renderGlFx({ rc, fragSrc: TINY_FRAG, uniforms: {}, uniformNames: [] });
    // texSubImage2D should have been called with the imageBitmap-shaped object.
    const sub = gl.__calls.find((c) => c.method === 'texSubImage2D');
    expect(sub).toBeDefined();
    // 7th arg (index 6) is the source. Mock bitmap has width/height props.
    const src = sub!.args[6] as { width: number; height: number };
    expect(src.width).toBe(100); // makeMockImageBitmap default
  });

  it("source='canvas' uploads from rc.ctx.canvas instead", () => {
    const rc = makeRenderContext();
    renderGlFx({
      rc, fragSrc: TINY_FRAG, uniforms: {}, uniformNames: [],
      source: 'canvas'
    });
    const sub = gl.__calls.find((c) => c.method === 'texSubImage2D');
    expect(sub).toBeDefined();
    const src = sub!.args[6] as { width: number; height: number };
    // makeMockCtx canvas is 800×450.
    expect(src.width).toBe(800);
    expect(src.height).toBe(450);
  });

  it("source='canvas' sets u_contain to identity (0,0,1,1)", () => {
    const rc = makeRenderContext();
    renderGlFx({
      rc, fragSrc: TINY_FRAG, uniforms: {}, uniformNames: [],
      source: 'canvas'
    });
    const containCall = gl.__calls.find(
      (c) => c.method === 'uniform4f'
    );
    expect(containCall).toBeDefined();
    // uniform4f(loc, x, y, w, h) — identity = (0, 0, 1, 1)
    expect(containCall!.args.slice(1)).toEqual([0, 0, 1, 1]);
  });

  it("source='bitmap' uses containRect-derived u_contain (not identity)", () => {
    // 800×450 main canvas, 100×100 bitmap → contained at (350, 175, 100, 100)
    const rc = makeRenderContext();
    renderGlFx({ rc, fragSrc: TINY_FRAG, uniforms: {}, uniformNames: [] });
    const containCall = gl.__calls.find((c) => c.method === 'uniform4f');
    expect(containCall).toBeDefined();
    // Should NOT be identity.
    expect(containCall!.args.slice(1)).not.toEqual([0, 0, 1, 1]);
  });
});
```

- [ ] **Step 2: Run test — verify 4 fail (source option not yet supported)**

```bash
npx vitest run tests/unit/webgl/pipeline-source.test.ts
```

Expected: First test (`'bitmap'` default) likely PASSES because default behavior is bitmap. Others FAIL: source option not yet declared on RenderGlFxArgs (TS error), uniform4f not called with identity values.

- [ ] **Step 3: Implement — extend `pipeline.ts`**

Edit `lib/renderer/webgl/pipeline.ts`:

```ts
// Replace the import line for texture.ts:
import { uploadTextureSource } from './texture';

// Extend the interface:
export interface RenderGlFxArgs {
  rc: RenderContext;
  fragSrc: string;
  uniforms: Uniforms;
  uniformNames: UniformNames;
  /** Plan 8f.3 — Texture-Quelle:
   *  - `'bitmap'` (Default): `rc.imageBitmap`, `u_contain` aus containRect.
   *    Back-compat, was alle vor-8f.3-FX nutzen (CGS, RetroVHS).
   *  - `'canvas'`: `rc.ctx.canvas`, `u_contain = (0,0,1,1)` Identity.
   *    Sampelt den bereits composed Frame — gedacht für Post-Effekte wie
   *    Edge Glow, die AUF die vorigen FX chained werden sollen.
   *
   *  Wichtig: 'canvas' lädt die KOMPLETTE Main-Canvas als Texture. Bei
   *  hoher DPR kann das die Texture-Upload-Cost erhöhen (1600×900 vs.
   *  bitmap's 100×100 in Tests). In Production sind beide ~ähnlich groß. */
  source?: 'bitmap' | 'canvas';
}

// Inside renderGlFx, after `const { sx, sy, sw, sh } = containRect(rc);`:
// Replace these lines:
//   uploadImageBitmap(gl, rc.imageBitmap);
//   ... uContain block ...
// with:

  const sourceKind = args.source ?? 'bitmap';
  if (sourceKind === 'canvas') {
    const c = rc.ctx.canvas;
    uploadTextureSource(gl, c as unknown as TexImageSource, c.width, c.height);
  } else {
    uploadTextureSource(gl, rc.imageBitmap, rc.imageBitmap.width, rc.imageBitmap.height);
  }
  const uImage = locs.uniforms.get('u_image');
  if (uImage) gl.uniform1i(uImage, 0);
  const uContain = locs.uniforms.get('u_contain');
  if (uContain) {
    if (sourceKind === 'canvas') {
      // Identity: shader samples the full canvas (no letterbox remap).
      gl.uniform4f(uContain, 0, 0, 1, 1);
    } else {
      gl.uniform4f(
        uContain,
        sx / rc.width, sy / rc.height, sw / rc.width, sh / rc.height
      );
    }
  }
```

The existing import `import { uploadImageBitmap } from './texture';` can be removed (or left for back-compat — no harm).

- [ ] **Step 4: Run pipeline-source test — verify all pass**

```bash
npx vitest run tests/unit/webgl/pipeline-source.test.ts
```

Expected: 4 × PASS.

- [ ] **Step 5: Full suite + typecheck**

```bash
npm run typecheck && npx vitest run
```

Expected: typecheck clean, **1287** Tests (1283 + 4) grün. Existing ColorGradeShift / RetroVHS tests still pass (default `source` remains `'bitmap'`).

- [ ] **Step 6: Commit**

```bash
git add lib/renderer/webgl/pipeline.ts tests/unit/webgl/pipeline-source.test.ts
git commit -m "feat(webgl): renderGlFx source: 'bitmap' | 'canvas' option

Plan 8f.3 — Variante B: post-Effekte können den bereits composed
Frame sampeln statt nur rc.imageBitmap. Default bleibt 'bitmap'
(back-compat für ColorGradeShift + RetroVHS).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Shader — `EDGE_GLOW_FRAG_SRC`

**Files:**
- Create: `lib/renderer/webgl/programs/edge-glow.ts`
- Create: `tests/unit/webgl/edge-glow-shader.test.ts`

Single-Pass 9-Tap Sobel auf Luma. `smoothstep(lo, hi, mag)` mit `lo = threshold − glow * 0.2` ergibt eine 0..0.2 breite Übergangsband — `glow=0` ist harte Kante, `glow=1` ist weicher Halo. Mix mit Background nach `bgOpacity` und `intensity * env`.

- [ ] **Step 1: Test — Shader-String enthält erwartete Uniforms & Konstanten**

Datei: `tests/unit/webgl/edge-glow-shader.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { EDGE_GLOW_FRAG_SRC } from '@/lib/renderer/webgl/programs/edge-glow';

describe('EDGE_GLOW_FRAG_SRC', () => {
  it('declares all 6 FX uniforms', () => {
    expect(EDGE_GLOW_FRAG_SRC).toMatch(/uniform\s+vec2\s+u_resolution/);
    expect(EDGE_GLOW_FRAG_SRC).toMatch(/uniform\s+float\s+u_threshold/);
    expect(EDGE_GLOW_FRAG_SRC).toMatch(/uniform\s+vec4\s+u_color/);
    expect(EDGE_GLOW_FRAG_SRC).toMatch(/uniform\s+float\s+u_glow/);
    expect(EDGE_GLOW_FRAG_SRC).toMatch(/uniform\s+float\s+u_bg_opacity/);
    expect(EDGE_GLOW_FRAG_SRC).toMatch(/uniform\s+float\s+u_intensity/);
  });

  it('uses 9-tap Sobel kernel constants (-1, -2, -1, 1, 2, 1)', () => {
    // Sobel coefficient signature — defensive check that someone hasn't
    // silently replaced the operator with a wrong kernel.
    const src = EDGE_GLOW_FRAG_SRC;
    expect(src).toContain('-2.0');
    expect(src).toContain('2.0');
    expect(src.match(/luma/g)?.length).toBeGreaterThanOrEqual(9);
  });
});
```

- [ ] **Step 2: Run — verify both fail (file not found)**

```bash
npx vitest run tests/unit/webgl/edge-glow-shader.test.ts
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement — write `edge-glow.ts` shader file**

Datei: `lib/renderer/webgl/programs/edge-glow.ts`

```ts
/**
 * Plan 8f.3 — Edge Glow Fragment-Shader.
 *
 * 9-Tap Sobel auf Luma → magnitude → smoothstep mit glow-band → mix
 * mit background nach bgOpacity + intensity-modulation (env-decayed).
 *
 * Single-Pass: kein FBO-Ping-Pong, kein Gauss-Blur (Folge-Plan 8f.4
 * kann echtes Gaussian-Glow ergänzen). `glow` widens the smoothstep-
 * band statt einer separaten Blur-Stufe — billiger und liefert den
 * "Outline mit weichem Rand" Look à la CapCut Outline.
 *
 * `u_color` ist eine vec4 inkl. Alpha — der Plugin parsed Hex →
 * Float-Tuple. `u_intensity` enthält bereits `params.intensity * env`,
 * der Shader weiss nichts von Beats.
 *
 * Erwartet `source='canvas'` aus `renderGlFx` — sampelt den bereits
 * composed Frame, daher kein `u_contain`-Remap nötig (Pipeline setzt
 * Identity).
 */
export const EDGE_GLOW_FRAG_SRC = `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform vec4  u_contain;     // identity when source='canvas'; declared for compat
uniform vec2  u_resolution;
uniform float u_threshold;
uniform vec4  u_color;
uniform float u_glow;
uniform float u_bg_opacity;
uniform float u_intensity;

in  vec2 v_texCoord;
out vec4 fragColor;

float luma(vec2 uv) {
  vec3 c = texture(u_image, uv).rgb;
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 t = 1.0 / u_resolution;

  float tl = luma(v_texCoord + vec2(-t.x, -t.y));
  float tm = luma(v_texCoord + vec2( 0.0, -t.y));
  float tr = luma(v_texCoord + vec2( t.x, -t.y));
  float ml = luma(v_texCoord + vec2(-t.x,  0.0));
  float mr = luma(v_texCoord + vec2( t.x,  0.0));
  float bl = luma(v_texCoord + vec2(-t.x,  t.y));
  float bm = luma(v_texCoord + vec2( 0.0,  t.y));
  float br = luma(v_texCoord + vec2( t.x,  t.y));

  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tm - tr + bl + 2.0 * bm + br;
  float mag = sqrt(gx * gx + gy * gy);

  // Glow band: lower edge of smoothstep widens with u_glow. glow=0 → near
  // hard step (~1 sub-pixel), glow=1 → 0.20-wide soft band.
  //
  // GLSL ES Spec §8.3: smoothstep(a, a, x) ist undefined behavior wenn
  // edge0 >= edge1. ARM Mali / PowerVR (iPhone XR) emittieren in dem
  // Fall NaN/0 → Effekt verschwindet bei glow=0 auf genau den Geräten,
  // die wir mit Plan 11 anpeilen. Daher 0.001-Epsilon auf hi pinnen
  // und lo entsprechend verschieben — visuell identisch (sub-pixel),
  // mathematisch sauber auf jedem Treiber.
  float hi = u_threshold + 0.001;
  float lo = max(0.0, hi - u_glow * 0.20 - 0.001);
  float edge = smoothstep(lo, hi, mag) * u_intensity;

  vec4 bg = texture(u_image, v_texCoord);
  vec3 bgRgb = bg.rgb * u_bg_opacity;
  vec3 outRgb = mix(bgRgb, u_color.rgb, edge);
  // Preserve alpha: respect bg's alpha (so transparent letterbox areas
  // stay transparent) and OR-in the edge's alpha contribution.
  float outA = max(bg.a * u_bg_opacity, edge * u_color.a);
  fragColor = vec4(outRgb, outA);
}`;
```

- [ ] **Step 4: Run shader test — verify both pass**

```bash
npx vitest run tests/unit/webgl/edge-glow-shader.test.ts
```

Expected: 2 × PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/renderer/webgl/programs/edge-glow.ts tests/unit/webgl/edge-glow-shader.test.ts
git commit -m "feat(webgl): edge-glow fragment shader (9-tap Sobel + smoothstep glow band)

Plan 8f.3 — single-pass GPU edge detection für Edge Glow FX. glow-param
widens den smoothstep-band statt separater Gauss-Blur-Pass (Folge-Plan
8f.4 kann echtes Gauss ergänzen).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: FxKind / Plugin-Mapping — `EdgeGlow` registrieren

**Files:**
- Modify: `lib/renderer/types.ts`
- Modify: `lib/timeline/plugin-mapping.ts`

Typen-Erweiterung. Vor Plugin-File, damit das Plugin die typsicher referenzieren kann.

- [ ] **Step 1: Edit `lib/renderer/types.ts`**

Im `FxKind`-Union nach `'RetroVHS'` ergänzen:

```ts
  // Plan 8f.2 — second WebGL2 FX.
  | 'RetroVHS'
  // Plan 8f.3 — third WebGL2 FX (post-composition Edge Glow).
  | 'EdgeGlow';
```

- [ ] **Step 2: Edit `lib/timeline/plugin-mapping.ts`**

In `TRACK_FX_KINDS` array, nach `'retro-vhs'` ergänzen:

```ts
  // Plan 8f.2 — second WebGL2 FX kind.
  'retro-vhs',
  // Plan 8f.3 — third WebGL2 FX kind (chain-composed Edge Glow).
  'edge-glow'
] as const;
```

In `RENDER_ORDER_TRACK_KIND` nach `'retro-vhs'` ergänzen (Edge Glow MUSS am ENDE der image-modifying group sitzen, damit es CGS/VHS-Output via canvas-source sieht):

```ts
  'retro-vhs',
  // Plan 8f.3 — Edge Glow sampelt den bereits composed Frame
  // (source='canvas' in renderGlFx). Muss daher NACH allen anderen
  // image-modifying FX in der Render-Reihenfolge stehen.
  'edge-glow',
  // Overlay FX (paint on top of whatever was drawn underneath).
  'sweep',
```

In `PluginFxKind` union nach `'RetroVHS'`:

```ts
  | 'RetroVHS'
  // Plan 8f.3 — third WebGL2 FX.
  | 'EdgeGlow';
```

In `PLUGIN_KIND_TO_TRACK_KIND` map nach `RetroVHS: 'retro-vhs'`:

```ts
  RetroVHS: 'retro-vhs',
  // Plan 8f.3 — third WebGL2 FX.
  EdgeGlow: 'edge-glow'
};
```

In `TRACK_KIND_TO_PLUGIN_KIND` map nach `'retro-vhs': 'RetroVHS'`:

```ts
  'retro-vhs': 'RetroVHS',
  // Plan 8f.3 — third WebGL2 FX.
  'edge-glow': 'EdgeGlow'
};
```

In `FX_DISPLAY_NAME` nach `'retro-vhs': 'Retro VHS'`:

```ts
  'retro-vhs': 'Retro VHS',
  // Plan 8f.3 — Edge Glow (CapCut-style outline + glow).
  'edge-glow': 'Edge Glow'
};
```

In `FX_CLIP_COLORS` nach `'retro-vhs': '#3aaab3'` (6-digit hex literal — siehe Inline-Kommentar in der Datei):

```ts
  'retro-vhs': '#3aaab3',
  // Plan 8f.3 — Edge Glow. Helles Cyan (Neon-Outline-Vibe).
  'edge-glow': '#00e5ff'
};
```

- [ ] **Step 3: Run typecheck — verify clean**

```bash
npm run typecheck
```

Expected: PASS. (Plugin-File noch nicht da, aber Mapping-Entries sind types-only und brechen nichts.)

- [ ] **Step 4: Run existing tests — verify no break**

```bash
npx vitest run tests/unit/timeline tests/unit/renderer
```

Expected: alle bestehenden Tests grün; Mapping-Erweiterung ist additive.

- [ ] **Step 5: Commit**

```bash
git add lib/renderer/types.ts lib/timeline/plugin-mapping.ts
git commit -m "feat(types): register EdgeGlow / edge-glow FxKind + plugin-mapping

Plan 8f.3 — third WebGL2 FX kind. Render-order positioned at the END
of the image-modifying group so it sees the composed frame via
source='canvas'. Display name 'Edge Glow', clip color #00e5ff (neon
cyan).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Plugin — `edgeGlowPlugin`

**Files:**
- Create: `lib/fx/edge-glow.ts`
- Create: `tests/unit/fx/edge-glow.test.ts`

Plugin folgt dem RetroVHS-Pattern (Flow-Mode-Override, persistente Layer + Beat-Decay). Hex→vec4 Helper inline, exportiert für Tests.

- [ ] **Step 1: Test — Plugin-Verhalten (8 Tests)**

Datei: `tests/unit/fx/edge-glow.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRenderContext } from '../renderer/_helpers';

vi.mock('@/lib/renderer/webgl/pipeline', () => ({
  renderGlFx: vi.fn()
}));

import { edgeGlowPlugin, _hexToRgba01 } from '@/lib/fx/edge-glow';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';

const mockedRenderGlFx = vi.mocked(renderGlFx);

describe('edgeGlowPlugin', () => {
  beforeEach(() => {
    mockedRenderGlFx.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('default params match the schema', () => {
    expect(edgeGlowPlugin.getDefaultParams()).toEqual({
      threshold: 0.10,
      color: '#00e5ff',
      glowAmount: 0.5,
      bgOpacity: 0.3,
      intensity: 1.0,
      decay: 0.25
    });
  });

  it('kind is EdgeGlow and defaultTrigger is beat', () => {
    expect(edgeGlowPlugin.kind).toBe('EdgeGlow');
    expect(edgeGlowPlugin.defaultTrigger).toBe('beat');
  });

  it('skips renderGlFx when env < 0.01 (Beat Mode, past decay)', () => {
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: false });
    edgeGlowPlugin.render(rc, {
      threshold: 0.1, color: '#00e5ff', glowAmount: 0.5,
      bgOpacity: 0.3, intensity: 1.0, decay: 0.25
    });
    expect(mockedRenderGlFx).not.toHaveBeenCalled();
  });

  it('runs in Flow Mode even at beatPhase=0.99 (env pinned to 1)', () => {
    const rc = makeRenderContext({ beatPhase: 0.99, flowMode: true });
    edgeGlowPlugin.render(rc, {
      threshold: 0.1, color: '#00e5ff', glowAmount: 0.5,
      bgOpacity: 0.3, intensity: 1.0, decay: 0.25
    });
    expect(mockedRenderGlFx).toHaveBeenCalledTimes(1);
    const args = mockedRenderGlFx.mock.calls[0][0];
    expect(args.uniforms.u_intensity).toBe(1.0);
  });

  it("uses source: 'canvas' so it samples composed frame", () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    edgeGlowPlugin.render(rc, {
      threshold: 0.1, color: '#00e5ff', glowAmount: 0.5,
      bgOpacity: 0.3, intensity: 1.0, decay: 0.25
    });
    expect(mockedRenderGlFx.mock.calls[0][0].source).toBe('canvas');
  });

  it('passes all 6 uniforms + u_resolution from canvas dimensions', () => {
    const rc = makeRenderContext({ beatPhase: 0 });
    edgeGlowPlugin.render(rc, {
      threshold: 0.15, color: '#ff8800', glowAmount: 0.8,
      bgOpacity: 0.5, intensity: 0.9, decay: 0.3
    });
    const args = mockedRenderGlFx.mock.calls[0][0];
    expect(args.uniformNames).toEqual([
      'u_resolution', 'u_threshold', 'u_color',
      'u_glow', 'u_bg_opacity', 'u_intensity'
    ]);
    expect(args.uniforms.u_threshold).toBe(0.15);
    expect(args.uniforms.u_glow).toBe(0.8);
    expect(args.uniforms.u_bg_opacity).toBe(0.5);
    // intensity = params.intensity * env (env=1 at beatPhase=0)
    expect(args.uniforms.u_intensity).toBe(0.9);
    // color: '#ff8800' → (1, 0.533, 0, 1) approx
    const col = args.uniforms.u_color as readonly number[];
    expect(col[0]).toBeCloseTo(1, 5);
    expect(col[1]).toBeCloseTo(0x88 / 255, 5);
    expect(col[2]).toBeCloseTo(0, 5);
    expect(col[3]).toBe(1);
    // u_resolution = (canvas.width, canvas.height) from helpers = (800, 450)
    expect(args.uniforms.u_resolution).toEqual([800, 450]);
  });

  it('hexToRgba01 parses #rrggbb correctly', () => {
    expect(_hexToRgba01('#00e5ff')).toEqual([0, 0xe5 / 255, 1, 1]);
    expect(_hexToRgba01('ff0000')).toEqual([1, 0, 0, 1]);
    expect(_hexToRgba01('#000000')).toEqual([0, 0, 0, 1]);
    expect(_hexToRgba01('#ffffff')).toEqual([1, 1, 1, 1]);
  });

  it('hexToRgba01 falls back to white on invalid input', () => {
    expect(_hexToRgba01('not a color')).toEqual([1, 1, 1, 1]);
    expect(_hexToRgba01('')).toEqual([1, 1, 1, 1]);
    expect(_hexToRgba01('#abc')).toEqual([1, 1, 1, 1]); // 3-digit not supported
  });
});
```

- [ ] **Step 2: Run — verify all 8 fail (module missing)**

```bash
npx vitest run tests/unit/fx/edge-glow.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement — write `edge-glow.ts` plugin**

Datei: `lib/fx/edge-glow.ts`

```ts
import type { FxPlugin } from '@/lib/renderer/types';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';
import { EDGE_GLOW_FRAG_SRC } from '@/lib/renderer/webgl/programs/edge-glow';

interface EdgeGlowParams {
  threshold: number;
  color: string;
  glowAmount: number;
  bgOpacity: number;
  intensity: number;
  decay: number;
}

/**
 * Parse `#rrggbb` (or `rrggbb`) to a normalized RGBA tuple. Falls back
 * to white on any malformed input — picks correctness over throwing,
 * because the user-facing color-picker is the only producer and there's
 * no safe failure mode mid-render. Exported as `_hexToRgba01` for tests.
 */
export function _hexToRgba01(
  hex: string,
  a = 1
): readonly [number, number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return [1, 1, 1, a] as const;
  const n = parseInt(m[1], 16);
  return [
    ((n >> 16) & 0xff) / 255,
    ((n >> 8) & 0xff) / 255,
    (n & 0xff) / 255,
    a
  ] as const;
}

/**
 * Plan 8f.3 — Edge Glow FX (third WebGL2 plugin).
 *
 * CapCut/Canva-style edge outline with optional glow band. Sobel auf
 * Luma im Fragment-Shader, single-pass, mit smoothstep-Band als
 * Pseudo-Glow (echtes Gaussian wäre 2-Pass mit FBO, kommt ggf. in
 * Plan 8f.4).
 *
 * **Variante B — source='canvas'**: Edge Glow sampelt den **bereits
 * composed Frame** (post-CGS / post-VHS / post-jeder-Image-Modifying-
 * FX), nicht das Original-Bitmap. Damit chained Edge Glow korrekt auf
 * vorherige FX. Bedingt die Render-Order-Position am Ende der
 * image-modifying group in `plugin-mapping.ts`.
 *
 * **Flow Mode**: env pinned auf 1.0 — Edge Glow ist ein persistenter
 * Look (Outline + Glow), kein reiner Beat-Pulse. In Beat Mode dämpft
 * `env = 1 - beatPhase / decay` die intensity nach jedem Beat ab.
 *
 * **Bekannte Limitation**: ColorGradeShift + RetroVHS auf demselben
 * Clip composen noch nicht miteinander (beide nutzen source='bitmap',
 * last writer wins). Edge Glow sieht nur den letzten der beiden im
 * gestackten Fall. Folge-Plan 8f.4 kann CGS/VHS auf 'canvas' opten.
 */
export const edgeGlowPlugin: FxPlugin<EdgeGlowParams> = {
  id: 'edge-glow',
  name: 'Edge Glow',
  kind: 'EdgeGlow',
  defaultTrigger: 'beat',
  preloadState: 'loading',
  paramSchema: {
    threshold: {
      kind: 'slider',
      label: 'Threshold',
      min: 0.02,
      max: 0.40,
      step: 0.01,
      default: 0.10
    },
    color: {
      kind: 'color',
      label: 'Edge color',
      default: '#00e5ff'
    },
    glowAmount: {
      kind: 'slider',
      label: 'Glow',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5
    },
    bgOpacity: {
      kind: 'slider',
      label: 'Background',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.3
    },
    intensity: {
      kind: 'slider',
      label: 'Intensity',
      min: 0,
      max: 1,
      step: 0.05,
      default: 1.0
    },
    decay: {
      kind: 'slider',
      label: 'Decay',
      min: 0.01,
      max: 0.5,
      step: 0.01,
      default: 0.25,
      unit: 'beats'
    }
  },
  getDefaultParams: () => ({
    threshold: 0.10,
    color: '#00e5ff',
    glowAmount: 0.5,
    bgOpacity: 0.3,
    intensity: 1.0,
    decay: 0.25
  }),

  async preload() {
    if (typeof OffscreenCanvas === 'undefined') {
      this.preloadState = 'error';
      return;
    }
    const test = new OffscreenCanvas(1, 1);
    const gl = test.getContext('webgl2');
    this.preloadState = gl ? 'ready' : 'error';
  },

  render(rc, params) {
    // Edge Glow sampelt rc.ctx.canvas (source='canvas'), nicht
    // rc.imageBitmap. Auf den Canvas guarden — wenn künftig overlay-
    // only FX-Clips ohne Bitmap composen, würde ein Bitmap-Guard
    // fälschlicherweise skippen.
    if (!rc.ctx?.canvas) return;

    const isFlow = rc.flowMode;
    const env = isFlow ? 1.0 : Math.max(0, 1 - rc.beatPhase / params.decay);
    if (!isFlow && env < 0.01) return;

    const color = _hexToRgba01(params.color);
    const canvas = rc.ctx.canvas;

    renderGlFx({
      rc,
      fragSrc: EDGE_GLOW_FRAG_SRC,
      source: 'canvas',
      uniformNames: [
        'u_resolution',
        'u_threshold',
        'u_color',
        'u_glow',
        'u_bg_opacity',
        'u_intensity'
      ],
      uniforms: {
        u_resolution: [canvas.width, canvas.height] as const,
        u_threshold: params.threshold,
        u_color: color,
        u_glow: params.glowAmount,
        u_bg_opacity: params.bgOpacity,
        u_intensity: params.intensity * env
      }
    });
  },

  dispose() {}
};
```

- [ ] **Step 4: Run plugin test — verify all 8 pass**

```bash
npx vitest run tests/unit/fx/edge-glow.test.ts
```

Expected: 8 × PASS.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/fx/edge-glow.ts tests/unit/fx/edge-glow.test.ts
git commit -m "feat(fx): edge-glow plugin (Sobel + glow band on composed frame)

Plan 8f.3 — third WebGL2 FX. CapCut/Canva-style outline with smoothstep
glow band, single-pass shader. Uses source='canvas' so it chains AFTER
prior image-modifying FX. Flow Mode pins env=1.0 (persistent look);
Beat Mode decays intensity via env = 1 - beatPhase/decay.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Registry — `register(edgeGlowPlugin)`

**Files:**
- Modify: `lib/fx/index.ts`

- [ ] **Step 1: Edit `lib/fx/index.ts`**

Import nach RetroVHS:

```ts
// Plan 8f.2 — second WebGL2 FX.
import { retroVhsPlugin } from './retro-vhs';
// Plan 8f.3 — third WebGL2 FX.
import { edgeGlowPlugin } from './edge-glow';
```

Register-Call nach RetroVHS (vor `registered = true`):

```ts
  // Plan 8f.2 — second WebGL2 FX.
  register(retroVhsPlugin);
  // Plan 8f.3 — third WebGL2 FX.
  register(edgeGlowPlugin);
  registered = true;
```

- [ ] **Step 2: Run plugin-contract tests (catch-all für Registry)**

```bash
npx vitest run tests/unit/fx/plugin-contract.test.ts
```

Expected: PASS — Edge Glow registriert sich, alle Pflicht-Felder vorhanden (das ist genau das, was der Contract-Test prüft).

- [ ] **Step 3: Full test suite**

```bash
npx vitest run
```

Expected: **1297** Tests (1287 + 2 shader + 8 plugin) grün. Plugin-Contract-Test zählt Edge Glow automatisch mit.

> **Hinweis:** Falls der Plugin-Contract-Test eine fixe Plugin-Count-Assertion hat (z.B. `expect(plugins).toHaveLength(N)`), den N-Wert hier um 1 erhöhen. Vor Commit verifizieren: `grep -n "toHaveLength\|toBe.*plugin" tests/unit/fx/plugin-contract.test.ts`.

- [ ] **Step 4: Typecheck + lint + build (full Verification-Gate aus CLAUDE.md)**

```bash
npm run typecheck && npm run lint && npm run build
```

Expected: alle clean.

- [ ] **Step 5: Commit**

```bash
git add lib/fx/index.ts
git commit -m "feat(fx): register edgeGlowPlugin in built-in registry

Plan 8f.3 — Edge Glow available via Inspector + AddTrack picker.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Docs — KNOWN_LIMITATIONS + CLAUDE.md

**Files:**
- Modify: `docs/KNOWN_LIMITATIONS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: KNOWN_LIMITATIONS — neue Sektion am Ende anhängen**

```markdown
## WebGL2 FX Composition (Plan 8f.3)

VibeGrid hat drei WebGL2-FX-Kategorien (Plan 8f.1 / 8f.2 / 8f.3):
**ColorGradeShift**, **RetroVHS**, **Edge Glow**.

**Edge Glow chained korrekt** auf vorherige image-modifying FX, weil
es `source='canvas'` in `renderGlFx` nutzt — sampelt also den bereits
composed Frame. Render-Order positioniert Edge Glow am ENDE der
image-modifying group.

**Stacken von ColorGradeShift + RetroVHS auf demselben Clip ist
"last writer wins"**: beide nutzen `source='bitmap'`, also sampeln
beide das Original-Bitmap und schreiben separat auf die Main-Canvas.
Der zweite überschreibt den ersten. Folge-Plan 8f.4 kann beide auf
`source='canvas'` opten und so die Composition chainen — Edge Glow
hat den Pfad bereits implementiert und kann als Referenz dienen.

Workaround heute: nur einen der beiden (CGS oder VHS) pro Clip
einsetzen, Edge Glow kann zusätzlich oben drauf laufen.
```

- [ ] **Step 2: CLAUDE.md — Plan-Tabelle aktualisieren**

In der "Plan Execution Order"-Tabelle die Zeile `| 8f.3 | Contour → WebGL2 ... | 📝 Spec ready ... |` ersetzen durch:

```markdown
| 8f.3 | Edge Glow (GPU-native FX + chain-composition) | ✅ Done |
```

Falls ein "Next-Up" Hinweis am Tabellenende existiert, auf den Folge-Plan zeigen (Plan 8f.4 — CGS/VHS auf source='canvas' opten, oder ein anderer User-Plan).

- [ ] **Step 3: Commit (docs separate vom code — siehe memory feedback_commit_granularity)**

```bash
git add docs/KNOWN_LIMITATIONS.md CLAUDE.md
git commit -m "docs: Plan 8f.3 — Edge Glow shipped, WebGL2 composition limitation logged

KNOWN_LIMITATIONS clarifies that Edge Glow chains correctly via
source='canvas' while CGS+VHS stacking is still 'last writer wins'.
CLAUDE.md plan table marks 8f.3 done.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Verify-Gate + Live-Smoke + abschließender Performance-Check

**Files:** keine

- [ ] **Step 1: Full Verification-Gate**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

Expected: alle 4 PASS. Test-Count finale Zahl notieren (≥ 1297).

- [ ] **Step 2: Dev-Server + Live-Smoke**

```bash
npm run dev
```

Browser → `http://localhost:3000`:
1. Demo-Projekt laden (Image + Audio).
2. FX-Track hinzufügen, Edge Glow auswählen, kurzes Clip platzieren.
3. Playback starten → erwartet: Cyan-Outline pulsiert auf jeden Beat,
   default `bgOpacity=0.3` macht das Original sichtbar aber gedimmt.
4. Slider in Inspector durchprobieren:
   - `threshold` 0.02 → viele Kanten; 0.40 → nur starke Kanten.
   - `glowAmount` 0 → harte Linien; 1 → weicher Halo.
   - `bgOpacity` 0 → reine Kanten auf Schwarz; 1 → Original + Kanten.
5. Flow-Mode toggle → Edge Glow läuft konstant (kein Pulse), persistenter Look.
6. **Chain-Test (Variante-B-Verifikation):** Zweiten FX-Track mit
   ColorGradeShift platzieren (oder RetroVHS), darüber Edge Glow.
   Erwartet: Edge Glow sieht die durch CGS/VHS modifizierte Bildversion,
   nicht das Original.
7. **Multi-Clip-Test:** 3 simultane Edge-Glow-Clips auf Video → erwartet kein sichtbares Stutter (Performance-Hauptziel).

- [ ] **Step 3: Performance-Mess-Note**

Falls in Schritt 0.5 CGS-Baseline gemessen wurde: hier Edge-Glow mit derselben Methodik messen (1080p Image-Clip, avg + p99 über 5 s). PR-Body ergänzen mit:

```
Performance (1080p, Edge Glow alleine):
  avg  : X.X ms   (CGS-Vergleich: Y.Y ms)
  p99  : X.X ms   (CGS-Vergleich: Y.Y ms)
  3 Clips simultan: kein sichtbares Stutter / kein FPS-Drop unter 30
```

Erwartung: avg in der gleichen Größenordnung wie CGS (∼1–3 ms), p99 unter 5 ms. Falls deutlich teurer (> 2× CGS): vor Merge melden — der Plan setzt voraus, dass single-pass 9-tap Sobel + smoothstep im selben Range wie CGS landet.

- [ ] **Step 4: (Optional) Push**

```bash
git push
```

Nur wenn vom User signalisiert (siehe `feedback_no_auto_commit`).

---

## Commits-Übersicht

```
1. refactor(webgl): generalize uploadImageBitmap → uploadTextureSource
2. feat(webgl): renderGlFx source: 'bitmap' | 'canvas' option
3. feat(webgl): edge-glow fragment shader
4. feat(types): register EdgeGlow / edge-glow FxKind + plugin-mapping
5. feat(fx): edge-glow plugin
6. feat(fx): register edgeGlowPlugin in built-in registry
7. docs: Plan 8f.3 — Edge Glow shipped, composition limitation logged
```

7 Commits, jeder ein in-sich geschlossener Concern. Docs getrennt vom Code (siehe `feedback_commit_granularity`).

---

## Test-Bilanz

| Quelle | Tests |
|---|---|
| `tests/unit/webgl/texture-source.test.ts` | 4 |
| `tests/unit/webgl/pipeline-source.test.ts` | 4 |
| `tests/unit/webgl/edge-glow-shader.test.ts` | 2 |
| `tests/unit/fx/edge-glow.test.ts` | 8 |
| **Σ neu** | **18** |
| Baseline | 1279 |
| Plan-Soll | **1297** |

---

## Nicht im Scope (explizit out)

- Echtes 2-Pass Gaussian-Glow via FBO ping-pong (kommt als Plan 8f.4 falls smoothstep-Glow visuell nicht reicht).
- Umstellung von ColorGradeShift / RetroVHS auf `source='canvas'` (separater Folge-Plan, würde deren Shader + Tests anfassen).
- Umstellung des **bestehenden** Contour auf WebGL2 (per User-Entscheidung: bleibt unverändert — Edge Glow ist die Performance-Antwort).
- Mobile-Tier-spezifische Anpassungen (Capabilities-Skip greift bereits — Plugin setzt `preloadState='error'` auf Devices ohne WebGL2).
- Preset-Pack-Integration (Plan 9a-Packs verweisen bisher nur auf Contour — separater Folge-Plan kann Edge-Glow-Variants definieren).

---

Rev. 2 — Architekt-Feedback (B1 Undo-Sektion, W1 GLSL-Epsilon, W2 Canvas-Guard) eingearbeitet. Freigegeben für Execution.
