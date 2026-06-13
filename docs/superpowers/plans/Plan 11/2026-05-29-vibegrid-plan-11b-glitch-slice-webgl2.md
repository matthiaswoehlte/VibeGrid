# CC #1 Prompt — Plan 11b: GlitchSlice → WebGL2 (Rev. 4)

**GlitchSlice von Canvas-2D auf WebGL2-Fragment-Shader migrieren.**
Horizontale **oder** vertikale Slice-Segmente mit zufälligem Offset —
alles per GPU, kein CPU-Loop, keine per-clip OffscreenCanvas mehr.

Baseline: HEAD post-Plan-11a (Test-Zahl in Schritt 0 bestätigen).

**Abhängigkeiten:**
- `renderGlFx` mit `source: 'bitmap'`-Option ✅ live
- Plan 9c ✅ live — GlitchSlice hat bereits `supportsSubdivision: true`,
  `beatSync: boolean`, `rc.subdividedBeatPhase` in env-Formel
- Plan 11a ✅ live — RGBSplit-Migration als frischeste Vorlage

> **Rev. 4 — Rev-3-fract-Fix zurückgerollt.**
>
> Rev. 3 hatte einen vorgeschlagenen Shader-Fix für ein vermutetes
> "Letterbox-Sampling"-Problem eingebaut. Texture-Setup-Verifikation
> (`lib/renderer/webgl/texture.ts:38-46` + `pipeline.ts:111-113`)
> hat gezeigt: **die Vermutung war falsch.** Im `source='bitmap'`-Modus
> ist die Texture bitmap-sized, ohne Letterbox-Bereich. `fract()`-Wrap
> sampelt deshalb immer echtes Bitmap-Content, nicht transparente
> Letterbox-Pixel.
>
> Rev. 4 nutzt wieder das simple Rev-2-Shader-Pattern. Reviewer-Punkt-2
> (sin-Entropie bei großem `u_seed`) bleibt als bekannter Cosmetic-
> Concern in KNOWN_LIMITATIONS dokumentiert. Architekt-A/B/C-
> Entscheidungen aus Rev. 2 unverändert.

---

## Schritt 0 — Codebase lesen (PFLICHT)

1. `lib/fx/glitch-slice.ts` vollständig — der post-9c-Stand bestätigt:
   - **Params**: `sliceCount: number`, `maxOffset: number`, `decay: number`,
     `seed: number`, `axis: 'h' | 'v'`, `beatSync: boolean`
   - **Plugin-Flag**: `supportsSubdivision: true` (Plan 9c)
   - **Schema**: `beatSync: { kind: 'toggle', default: true }` (Plan 9c)
   - **env-Formel** (post-9c): `params.beatSync ? Math.max(0, 1 - rc.subdividedBeatPhase / params.decay) : 1.0`
   - **Hash heute**: `mulberry32(params.seed + rc.beatIndex)` aus `@/lib/utils/prng`
   - **flowMode-Pattern**: `if (rc.flowMode) return;` (Skip)
   - **Module-scope State** der weg muss:
     - `const glitchOffByClip = new Map<string, OffscreenCanvas>()` (Z. 32)
     - `dispose()` (Z. 136-138)
     - `export const _testOnly_glitchOffByClip = glitchOffByClip` (Z. 142)
   - **Canvas-2D-Mechanik** die weg muss:
     - Pre-Render auf per-clip Offscreen (Z. 105-116)
     - Slice-Loop mit `drawImage`-Aufrufen (Z. 125-134)
     - `containRect`-Import (Z. 2) — Plugin braucht ihn nicht mehr direkt
   - **mulberry32**-Import wird unused nach Migration → entfernen

2. `lib/renderer/webgl/programs/rgb-split.ts` (Plan 11a) — **frischeste
   Vorlage**: Uniform-Struktur, `*_UNIFORM_NAMES`-Pattern, `u_contain`-
   Mapping-Konvention (`vec2 uv = u_contain.xy + v_texCoord * u_contain.zw`).

3. `lib/fx/rgb-split.ts` (Plan 11a Rev. 3) — Plugin-Body-Vorlage:
   `beatSync: boolean` + `rc.subdividedBeatPhase`-env-Berechnung post-9c.

4. `lib/renderer/webgl/pipeline.ts` — `renderGlFx`-Signatur bestätigen:
   `renderGlFx({ rc, fragSrc, uniforms, uniformNames, source? })`.
   Standard-Uniforms `u_image`, `u_contain`, `u_resolution` werden
   automatisch gesetzt.

5. `tests/unit/fx/glitch-slice.test.ts` — Pflicht-Anpassungen siehe
   zeilengenaue Tabelle weiter unten.

6. `tests/unit/fx/rgb-split-webgl.test.ts` (Plan 11a) — Mock-Pattern-
   Vorlage für die neue `glitch-slice-webgl.test.ts`.

7. Aktuelle Test-Zahl notieren:
   `npm test -- --run 2>&1 | grep -E "Tests|passed" | tail -3`

---

## Architektur-Entscheidungen [Behavior-Drift]

**Architekt-A: Variante (b) gewählt — Drift akzeptiert + dokumentiert.**

Konsequenzen:
- **GLSL-Hash `fract(sin(n) * 43758.5453123)`** statt mulberry32-Portierung.
  Bestandsprojekte mit fixiertem `seed=42` sehen nach Migration eine
  andere Glitch-Choreographie.
- **UV-Wrap-Around via `fract()`** statt Pixel-Clipping. Slice-Pixel
  die out-of-bounds rutschen kommen am anderen Rand der Bitmap-Texture
  wieder rein. Optischer Charakter ändert sich vom "Black-Band-Glitch"
  zum "Wrap-Glitch".
- **Kein RGB-Channel-Spread** — Architekt-A streicht das komplett.

Beide Drifts werden in KNOWN_LIMITATIONS dokumentiert (siehe Anhang).

**Architekt-B: Vertical-Mode via `u_axis` (Option i).** Unverändert.

**Architekt-C: `u_seed = params.seed + rc.beatIndex` (Option j).** Unverändert.

**Reviewer-Punkt 2 (sin-Entropie bei großem `u_seed`):**
Bei 120 BPM über lange Sessions wächst `rc.beatIndex` unbeschränkt,
`u_seed` kann 10k+ erreichen. `sin()` bei großen Argumenten in float32
verliert Entropie — benachbarte `sliceIdx`-Werte können korrelierte
Outputs liefern. **Akzeptiert als Cosmetic-Concern, kein Fix in
Plan 11b.** KNOWN_LIMITATIONS-Eintrag benennt das (siehe Anhang).

**Reviewer-Punkt 1 (vermeintlicher fract-im-Letterbox-Bug):**
Aufgrund inkorrektem Texture-Semantik-Mental-Model in Rev. 3 wurde
ein Fix vorgeschlagen. Verifikation gegen `lib/renderer/webgl/texture.ts`
+ `pipeline.ts` zeigt:
- `source='bitmap'`-Mode: Texture-Size = Bitmap-Size, Bitmap füllt
  Texture-Range `[0,1]` komplett, **kein Letterbox-Bereich in der Texture**
- Wrap-Mode = `CLAMP_TO_EDGE`
- `fract(uv + offsetVec)` wraps innerhalb `[0,1]` der bitmap-sized
  Texture → sampelt immer echtes Bitmap-Content
**Konsequenz:** Kein Bug. Rev-2-Shader-Pattern bleibt unverändert.

---

## Fragment-Shader

```glsl
#version 300 es
precision highp float;

in  vec2 v_texCoord;          // ← NICHT v_uv
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec4  u_contain;      // Pipeline setzt automatisch (xy=offset, zw=size)
uniform vec2  u_resolution;   // Pipeline setzt automatisch — für Aspect-Korrektur in vertical mode
uniform float u_sliceCount;   // 2–8, Schema-int via step:1
uniform float u_maxOffset;    // 0–0.05, fraction-of-canvas-width
uniform float u_env;          // Beat-Envelope 0–1, basiert auf rc.subdividedBeatPhase
uniform float u_seed;         // params.seed + rc.beatIndex
uniform float u_axis;         // 0.0 = horizontal, 1.0 = vertical (Option i)

// GPU-Standard-Hash — fract(sin)-Familie.
// Behavior-Drift gegenüber mulberry32-Vorgänger ist akzeptiert (Variante b).
// Entropie-Drift bei großem u_seed (>10k) ebenfalls dokumentiert.
float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

void main() {
  // contain-rect-Mapping — Pflicht, sonst Aspect-Bruch
  vec2 uv = u_contain.xy + v_texCoord * u_contain.zw;

  // Slice-Index: bei u_axis=0 entlang y-Achse (horizontale Streifen),
  // bei u_axis=1 entlang x-Achse (vertikale Streifen)
  float sliceCoord = mix(uv.y, uv.x, u_axis);
  // sliceCount-Guard: Schema-min ist 2, aber defensiv für korrupte States
  float n = max(u_sliceCount, 1.0);
  float sliceIdx = floor(sliceCoord * n);
  float r = hash(sliceIdx + u_seed);

  // Zentriert um 0, skaliert mit maxOffset × env
  float offset = (r - 0.5) * 2.0 * u_maxOffset * u_env;

  // Versatz-Vektor je nach Achse. Vertical-Mode skaliert mit
  // Aspect-Ratio damit Pixel-Versatz konsistent zum Canvas-2D-Verhalten
  // ist (das immer w-basiert war, unabhängig von axis):
  vec2 offsetVec = mix(
    vec2(offset, 0.0),                                     // horizontal: x-Versatz
    vec2(0.0, offset * (u_resolution.x / u_resolution.y)), // vertical: y-Versatz, aspect-korrigiert
    u_axis
  );

  // UV-Wrapping mit fract() — bewusstes Glitch-Artefakt (Variante b).
  // Texture ist bitmap-sized im source='bitmap'-Mode (kein Letterbox),
  // also wrappt fract zwischen Bitmap-Rändern. CLAMP_TO_EDGE wäre
  // alternativer Look (Edge-Smear), aber Wrap passt zum Glitch-Charakter.
  vec2 uvShifted = fract(uv + offsetVec);

  fragColor = texture(u_image, uvShifted);
}
```

**Shader-Entscheidungen-Recap:**
- `u_maxOffset` statt `u_intensity` (Architekt-A Pflicht-Korrektur)
- Kein `u_rgbSpread`, kein Channel-Shift im Shader (Architekt-A)
- `u_axis` als Float-Uniform mit `mix()`-Pattern (Architekt-B Option i)
- `max(u_sliceCount, 1.0)` als defensive Maßnahme
- `u_resolution.x / u_resolution.y` für vertical-mode Aspect-Korrektur
- `fract(uv + offsetVec)` für Wrap im Texture-Space — keine
  Sonderbehandlung nötig, weil Texture bitmap-sized ist und der
  Wrap deshalb immer auf echtem Bitmap-Content landet (Reviewer-
  Punkt-1-Verifikation, siehe Architektur-Section oben)

---

## Neues Modul: `lib/renderer/webgl/programs/glitch-slice.ts`

Analog zu `lib/renderer/webgl/programs/rgb-split.ts`:

```ts
/**
 * Plan 11b — GlitchSlice Fragment-Shader.
 *
 * Horizontale (u_axis=0) oder vertikale (u_axis=1) Slices mit
 * Pseudo-Random-Versatz pro Slice. u_seed (params.seed + rc.beatIndex)
 * dreht die Random-Verteilung pro Beat. u_env (aus subdividedBeatPhase
 * + decay) steuert die Burst-Stärke.
 *
 * Behavior-Drift vs. Canvas2D-Vorgänger (Architekt-A Variante b):
 * - fract(sin)-Hash statt mulberry32 → andere Slice-Verteilung bei gleichem seed
 * - fract-UV-Wrap statt Pixel-Clipping → Wrap-Around-Glitch (Texture
 *   ist bitmap-sized, Wrap sampelt anderen Bitmap-Rand)
 * Beide in KNOWN_LIMITATIONS.md dokumentiert.
 *
 * Subdivision (Plan 9c): u_env basiert auf rc.subdividedBeatPhase.
 */
export const GLITCH_SLICE_FRAG_SRC = `...`; // Shader oben

export const GLITCH_SLICE_UNIFORM_NAMES = [
  'u_sliceCount',
  'u_maxOffset',
  'u_env',
  'u_seed',
  'u_axis'
] as const;
```

Vertex-Shader wird NICHT exportiert — `renderGlFx` / `shader.ts` haben
den Standard-Quad-Vertex-Shader intern.

---

## Plugin-Änderung: `lib/fx/glitch-slice.ts`

```ts
import type { FxPlugin, RenderContext } from '@/lib/renderer/types';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';
import {
  GLITCH_SLICE_FRAG_SRC,
  GLITCH_SLICE_UNIFORM_NAMES
} from '@/lib/renderer/webgl/programs/glitch-slice';

interface GlitchSliceParams {
  sliceCount: number;
  maxOffset: number;
  decay: number;
  seed: number;
  axis: string;            // 'h' | 'v'
  beatSync: boolean;       // Plan 9c
}

export const glitchSlicePlugin: FxPlugin<GlitchSliceParams> = {
  id: 'glitch-slice',
  name: 'Glitch Slice',
  kind: 'GlitchSlice',
  defaultTrigger: 'beat',
  supportsSubdivision: true,                                    // Plan 9c
  preloadState: 'ready',
  paramSchema: { /* unverändert post-9c; siehe lib/fx/glitch-slice.ts:41-85 */ },
  getDefaultParams: (): GlitchSliceParams => ({
    sliceCount: 4,
    maxOffset: 0.01,
    decay: 0.08,
    seed: 42,
    axis: 'h',
    beatSync: true
  }),
  async preload() {},

  render(rc: RenderContext, params: GlitchSliceParams) {
    if (!rc.imageBitmap) return;
    if (rc.flowMode) return;

    const env = params.beatSync
      ? Math.max(0, 1 - rc.subdividedBeatPhase / params.decay)
      : 1.0;
    if (env < 0.01) return;

    renderGlFx({
      rc,
      fragSrc: GLITCH_SLICE_FRAG_SRC,
      uniforms: {
        u_sliceCount: Math.round(params.sliceCount),
        u_maxOffset:  params.maxOffset,
        u_env:        env,
        u_seed:       params.seed + rc.beatIndex,             // Architekt-C
        u_axis:       params.axis === 'v' ? 1.0 : 0.0          // Architekt-B
      },
      uniformNames: GLITCH_SLICE_UNIFORM_NAMES
    });
  }
};

// ENTFERNT (gegenüber pre-11b):
// - const glitchOffByClip = new Map<string, OffscreenCanvas>();
// - export const _testOnly_glitchOffByClip = glitchOffByClip;
// - dispose() { glitchOffByClip.clear() }
// - mulberry32-Import (unused nach Migration)
// - containRect-Import (renderGlFx ruft es intern auf)
// - Alle OffscreenCanvas + clearRect + drawImage-Slice-Loops
```

---

## Was wegfällt aus `lib/fx/glitch-slice.ts` (zeilengenau, post-9c-Stand)

| Zeile | Inhalt | Aktion |
|---|---|---|
| Z. 2 | `import { containRect } from '@/lib/renderer/loop';` | **entfernen** |
| Z. 3 | `import { mulberry32 } from '@/lib/utils/prng';` | **entfernen** |
| Z. 32 | `const glitchOffByClip = new Map<string, OffscreenCanvas>();` | **entfernen** |
| Z. 95-134 | Kompletter Canvas-2D render-Body | **ersetzen** durch renderGlFx-Snippet |
| Z. 136-138 | `dispose() { glitchOffByClip.clear() }` | **entfernen** |
| Z. 142 | `export const _testOnly_glitchOffByClip = glitchOffByClip;` | **entfernen** |

---

## Source-Modus: `'bitmap'` (Default)

GlitchSlice sampelt das Original-Bitmap — identisch zu RGBSplit (11a),
ContourGL (8f.4), ColorGradeShift, RetroVHS. Last-writer-wins bei
4+ Bitmap-Source-FX-Stacking ist bekannte Limitation (KNOWN_LIMITATIONS.md
seit 11a).

**Texture-Semantik im `source='bitmap'`-Mode** (Reviewer-Punkt-1-
Verifikation, siehe `lib/renderer/webgl/texture.ts` + `pipeline.ts:111-113`):
- Texture-Size = Bitmap-Size (nicht canvas-sized)
- Bitmap füllt Texture-Range `[0,1]` komplett — kein Letterbox-Bereich
- Wrap-Mode `CLAMP_TO_EDGE` — `fract()` im Shader wraps zwischen
  Bitmap-Rändern (immer echtes Content), kein theoretisch-möglicher
  Letterbox-Sampling-Bug

---

## Undo-Behaviour

| Action | Behandlung |
|---|---|
| GlitchSlice-Param-Änderungen | Bestehend via `setClipParam` → `record + coalesce` |
| Renderer-Wechsel | Kein Store-State — kein Undo-Impact |

---

## Tests

### Alte Tests in `tests/unit/fx/glitch-slice.test.ts` — Pflicht-Anpassung (zeilengenau, post-9c-Stand)

| Zeile | Inhalt | Aktion |
|---|---|---|
| Z. 2-5 | `import { glitchSlicePlugin, _testOnly_glitchOffByClip }` | **`_testOnly_glitchOffByClip` entfernen** |
| Z. 7 | `import { mulberry32 } from '@/lib/utils/prng';` | **entfernen** |
| Z. 13-26 | `class StubOffscreen` | **entfernen** |
| Z. 27-28 | `globalThis.OffscreenCanvas = StubOffscreen` | **entfernen** |
| Z. 31-33 | `beforeEach({ _testOnly_glitchOffByClip.clear() })` | **entfernen** |
| Z. 35-39 | plugin-shape-Test | **bleibt** |
| Z. 41-48 | flowMode → no draw | **bleibt** semantisch, gegen `renderGlFx`-Mock prüfen |
| Z. 50-57 | `"sliceCount=4 → 4 drawImage calls"` | **umschreiben** → 1 `renderGlFx`-Call mit `u_sliceCount=4` |
| ab Z. 59 | weitere `drawImage`-Counter-Tests | **umschreiben** → `renderGlFx`-Mock-Asserts auf Uniform-Werte |
| 9c-Tests | (falls vorhanden) | **bleiben unverändert** |

### Neue Tests `tests/unit/fx/glitch-slice-webgl.test.ts`

Pattern-Vorlage: `tests/unit/fx/rgb-split-webgl.test.ts` (Plan 11a).

1. **Shader-Quelle enthält `u_contain.xy + v_texCoord * u_contain.zw`**
2. **`u_sliceCount = Math.round(params.sliceCount)`** — `params.sliceCount=4` → `u_sliceCount=4`
3. **`u_maxOffset = params.maxOffset`** — direkt durchgereicht
4. **`u_env = 1.0` bei `beatSync=false`** (Plan-9c-Verhalten)
5. **`u_env < 1.0` bei `beatSync=true` + `subdividedBeatPhase > 0`**:
   `subdividedBeatPhase=0, decay=0.08` → `u_env = 1.0`
   `subdividedBeatPhase=0.04, decay=0.08` → `u_env ≈ 0.5`
   `subdividedBeatPhase=0.1, decay=0.08` → `u_env = 0` (geclamped) → kein Call
6. **`u_seed = params.seed + rc.beatIndex`** (Architekt-C):
   `params.seed=42, rc.beatIndex=0` → `u_seed=42`
   `params.seed=42, rc.beatIndex=1` → `u_seed=43`
   `params.seed=100, rc.beatIndex=5` → `u_seed=105`
7. **`u_axis = 0.0` bei `params.axis='h'`** (Architekt-B)
8. **`u_axis = 1.0` bei `params.axis='v'`** (Architekt-B)
9. **9c-Subdivision-Cross-Check** analog 11a-Rev-3-Test 3:
   `subdivision='4×', beatPhase=0.025, decay=0.08` →
   `subdividedBeatPhase=0.1` → `u_env = 0` → kein `renderGlFx`-Call
10. **`renderGlFx` aufgerufen, nicht Canvas-2D-Fallback**
11. **`!rc.imageBitmap` → kein `renderGlFx`-Call**
12. **`env < 0.01` → kein `renderGlFx`-Call**

Mindest: **+12 neue Tests + ~6 angepasste alte Tests**.

---

## Performance-Erwartung + Verification

**Vor-Migration messen** (Pflicht): Live-Preview mit GlitchSlice auf
einem Video-Clip + `performance.measure` um den Canvas-2D-render() Aufruf,
Avg + p95 über 60 Frames notieren.

**Nach-Migration nochmal messen.** Erwartung: **avg-Reduktion 2-3×,
deutliche p95-Spike-Reduktion.** Begründung: GlitchSlice ist im
Status-quo schon vergleichsweise günstig (keine `getImageData`/
`putImageData`, nur `drawImage`-Aufrufe). Der echte Win ist die
Eliminierung des Pre-Render-Pre-Composite-Stalls bei Video-Quellen
+ die one-pass-Shader-Architektur.

---

## KNOWN_LIMITATIONS.md — neuer Eintrag (Anhang-Vorschlag)

```markdown
### GlitchSlice WebGL2 — anderes Look-Profil als Canvas-2D-Vorgänger

Plan 11b (2026-05-29) migrierte GlitchSlice von Canvas-2D auf WebGL2.
Drei bewusst akzeptierte Verhaltens-Drifts (Architekt-Entscheidung
Variante b):

1. **Hash-Verteilung:** Canvas-2D nutzte mulberry32 (deterministic
   integer PRNG, lib/utils/prng.ts). Shader nutzt GLSL-Standard
   `fract(sin(n) * 43758.5453123)`. Bei gleichem `seed`-Param und
   gleichem `rc.beatIndex` produzieren beide deterministisch denselben
   Output je Render — aber die Slice-Versatz-Verteilung ist anders.
   Bestandsprojekte mit fixiertem `seed=42` sehen nach Migration eine
   andere Glitch-Choreographie.

2. **Wrap-Around statt Clipping:** Canvas-2D-`drawImage` mit X-/Y-
   Versatz clippte Pixel die über die Canvas-Kante rutschten (sichtbare
   schwarze Bänder am Rand). Shader nutzt `fract()` für UV-Wrapping in
   der bitmap-sized Texture — Pixel kommen am anderen Rand der Bitmap
   wieder rein. Optischer Charakter ändert sich von „Black-Band-Glitch"
   zum „Wrap-Glitch".

3. **Cosmetic — sin-Entropie bei sehr großen `u_seed`:** Über lange
   Sessions wächst `rc.beatIndex` unbeschränkt. Ab `u_seed ≈ 10000`
   verliert `sin()` in float32 etwas Entropie — benachbarte
   `sliceIdx`-Werte können visuell-korrelierte Outputs liefern (subtile
   Pattern-Bildung statt klean random). Ist Teil des Glitch-Charmes,
   für viele User vermutlich unsichtbar. Falls je problematisch:
   integer-arithmetic PCG-Hash im Shader portieren — separater Plan.

User die bit-identische Reproduktion alter GlitchSlice-Renders brauchen:
Re-Render unter pre-11b-Stand. Für Vorwärts-Workflow ist der neue Look
die referenzwertige Variante.

Keine Schema-Migration nötig — `params.seed` und alle anderen Params
sind weiterhin kompatibel.
```

---

## Dateien

| Datei | Aktion |
|---|---|
| `lib/renderer/webgl/programs/glitch-slice.ts` | CREATE |
| `lib/fx/glitch-slice.ts` | MODIFY — Canvas-2D-Body → renderGlFx-Delegation; 9c-Erbe bleibt; State + dispose + `_testOnly_*`-Export + `mulberry32`-Import + `containRect`-Import entfernen |
| `tests/unit/fx/glitch-slice.test.ts` | MODIFY — siehe zeilengenaue Tabelle |
| `tests/unit/fx/glitch-slice-webgl.test.ts` | CREATE — 12 neue Tests |
| `docs/KNOWN_LIMITATIONS.md` | MODIFY — neuer GlitchSlice-Eintrag (Text-Vorschlag oben) |
| `docs/superpowers/uebergabe-architekt.md` | MODIFY — GlitchSlice: Canvas 2D → WebGL2 |

---

## Commits

```
feat(webgl): glitch-slice fragment shader + uniform-names export (incl. u_axis vertical mode)
feat(fx-glitch-slice): replace Canvas-2D with renderGlFx delegation (preserves 9c subdivision + boolean beatSync)
test(fx-glitch-slice): adapt existing tests + WebGL2 shader/uniform tests
docs(known-limitations): GlitchSlice hash distribution + wrap-around drift + sin-entropy cosmetic
docs(architekt): glitch-slice renderer Canvas2D → WebGL2
```

5 Commits.

---

## Nicht vergessen

- `v_texCoord` (nicht `v_uv`) im Shader
- `u_contain`-Mapping als erste Zeile in `main()` — Pflicht
- `u_resolution` für Aspect-Korrektur in vertical mode
- `uniformNames`-Array ist Pflicht-Argument bei `renderGlFx`
- `_overrideContextFactory`-Seam für Tests
- Safari 17+ durch `renderGlFx`-Capabilities-Gate abgedeckt
- **Plan 9c-Erbe respektieren:** `supportsSubdivision: true`, `beatSync: boolean`,
  `subdividedBeatPhase` in env — alles bleibt
- Kein `dispose()` mehr nötig — kein per-clip State im neuen Plugin
- `mulberry32`- und `containRect`-Imports im Plugin entfernen (werden unused)

---

## Architekt-Checkliste — Status

- [x] A: Behavior-Drift Variante (b) — `u_intensity` → `u_maxOffset`, `u_rgbSpread` gestrichen, KNOWN_LIMITATIONS-Anhang
- [x] B: Vertical-Mode via `u_axis`-Uniform (Option i) mit `mix()`-Pattern
- [x] C: `u_seed = params.seed + rc.beatIndex` (Option j)
- [x] Pflicht: `u_intensity` → `u_maxOffset` durchgängig
- [x] Pflicht: `u_rgbSpread` aus Plan + Shader komplett gestrichen
- [x] Pflicht: `u_axis`-Shader-Path eingebaut
- [x] Pflicht: `u_seed = params.seed + rc.beatIndex`
- [x] Pflicht: `rc.beatIndex` ohne `?? 0`
- [x] Pflicht: `Math.round(params.sliceCount)` vor Uniform-Pass
- [x] Pflicht: Zeilengenaue Test-Tabelle wie 11a Rev. 3
- [x] Pflicht: KNOWN_LIMITATIONS-Textvorschlag als Anhang
- [x] Pflicht: Performance-Erwartung „2-3× avg, p95-Spike-Reduktion"
- [x] Reviewer-Punkt-1 verifiziert (Texture bitmap-sized, kein
      Letterbox-Bug) → Rev-3-fract-Fix zurückgerollt
- [x] Reviewer-Punkt-2 (sin-Entropie) als Cosmetic in KNOWN_LIMITATIONS

---

Rev. 4 — Rev-3-fract-Fix zurückgerollt nach Texture-Semantik-Verifikation
(bitmap-sized, kein Letterbox). Rev-2-Shader-Pattern ist korrekt.
Reviewer-Punkt-2 bleibt als Cosmetic-Concern dokumentiert. Architekt-
A/B/C-Entscheidungen unverändert in Kraft. Bereit für CC #1 Implementation.
