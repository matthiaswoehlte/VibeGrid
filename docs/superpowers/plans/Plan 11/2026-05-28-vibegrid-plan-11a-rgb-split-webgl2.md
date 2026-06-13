# CC #1 Prompt — Plan 11a: RGBSplit → WebGL2 (Rev. 3)

**RGBSplit von Canvas-2D auf WebGL2-Fragment-Shader migrieren.**
Einfachster WebGL2-Migrations-Kandidat — ein einziger Shader-Pass,
kein State, kein Loop.

Baseline: HEAD post-Plan-9c (Test-Zahl in Schritt 0 bestätigen).

**Abhängigkeiten:**
- `renderGlFx` mit `source: 'bitmap' | 'canvas'`-Option ✅ live (Commit `8e2a8eb` + Bugfix `447aa60`)
- **Plan 9c (Trigger-Subdivision + Inspector UX) ✅ live** —
  RGBSplit hat **bereits** `supportsSubdivision: true`,
  `beatSync` ist `kind: 'toggle'` mit boolean-Wert,
  Render-Logik nutzt `rc.subdividedBeatPhase` statt `rc.beatPhase`.
  Plan-11a übernimmt diesen Stand und ändert ihn nicht.

> Rev. 3 — Rev. 2 angepasst an post-9c-Realität.
> Zwei substanzielle Änderungen gegenüber Rev. 2:
> 1. `params.beatSync` ist `boolean` (truthy-check statt `>= 0.5`)
> 2. env-Berechnung nutzt `rc.subdividedBeatPhase` statt `rc.beatPhase`
>
> Rest (Shader, Pipeline-Aufruf, KNOWN_LIMITATIONS-Einträge,
> Behavior-Drift-Variante (b)) bleibt unverändert.

---

## Schritt 0 — Codebase lesen (PFLICHT)

1. `lib/fx/rgb-split.ts` vollständig — der post-9c-Stand zeigt:
   - Param-Interface: `offset`, `decay`, `intensity`, `beatSync: boolean`
   - Plugin-Flag: `supportsSubdivision: true` (Plan 9c)
   - Schema: `beatSync: { kind: 'toggle', default: true, label: 'Beat Sync' }`
   - env-Formel (post-9c): `params.beatSync ? Math.max(0, 1 - rc.subdividedBeatPhase / params.decay) : 1.0`
   - flowMode-Pattern: `if (rc.flowMode) return;` (Skip)
   - `containRect(rc)` aus `@/lib/renderer/loop` wird genutzt
   - `_testOnly_rgbOffByClip`-Export am Dateiende — **muss verschwinden**
   - Map `rgbOffByClip` + `dispose()` — **müssen verschwinden**

   Falls Schritt-0-Befund von dieser Beschreibung abweicht (z.B. 9c
   wurde anders implementiert), CC #1 stoppt und meldet Diff.

2. `lib/renderer/webgl/programs/color-grade.ts` (NICHT `color-grade-shift.ts`)
   — Referenz-Muster Nr. 1:
   - Wie `u_contain` im Shader genutzt wird (Z. 66:
     `vec2 uv = u_contain.xy + v_texCoord * u_contain.zw;`)
   - Vertex-Out heißt `v_texCoord`, NICHT `v_uv`
   - `precision highp` Konvention

3. `lib/renderer/webgl/programs/contour-gl.ts` (Plan 8f.4) — Referenz-Muster
   Nr. 2, neueres Pattern:
   - Wie ein Image-Modifying-FX mit Bitmap-Source aufgebaut ist
   - Wie Uniforms strukturiert übergeben werden

4. `lib/renderer/webgl/pipeline.ts` — `renderGlFx`-API:
   - Signatur: `renderGlFx(args: RenderGlFxArgs): void`
     wobei `RenderGlFxArgs = { rc, fragSrc, uniforms, uniformNames, source? }`
   - **`uniformNames: readonly string[]` ist Pflicht-Argument** für Location-Cache
   - `source` Default ist `'bitmap'`
   - Standard-Uniforms `u_image`, `u_contain`, `u_resolution` werden
     **automatisch** gesetzt — Shader muss `u_contain` nutzen

5. `lib/renderer/types.ts` — `RenderContext.subdividedBeatPhase` bestätigen
   (Plan 9c). Bei `subdivision='1×'` oder `triggerSubdivision === undefined`
   ist `subdividedBeatPhase === beatPhase` — identisches Verhalten zum
   pre-9c-Stand.

6. `tests/unit/fx/rgb-split.test.ts` — welche Tests fallen weg, welche bleiben:
   - Import `_testOnly_rgbOffByClip` → entfernen
   - `class StubOffscreen` + `globalThis.OffscreenCanvas = StubOffscreen` →
     entfernen (kein lokales Offscreen mehr)
   - `_testOnly_rgbOffByClip.clear()` in beforeEach → entfernen
   - *„draws bitmap + 2 channel offscreens (3 drawImage calls)"* →
     umschreiben: 1 `drawImage(webglCanvas, ...)` Final-Composite via
     pipeline.ts:150 (oder besser: `renderGlFx`-Mock-Call-Assert)
   - flowMode + env-Tests bleiben semantisch, müssen aber gegen
     renderGlFx-Mock prüfen
   - **9c-Tests bleiben unverändert** (Subdivision-Berechnung,
     beatSync-toggle-Migration) — Plan-11a touchet die nicht

7. `tests/unit/fx/color-grade-shift.test.ts` + `tests/unit/fx/edge-glow.test.ts`
   — als Mock-Pattern-Vorlage für WebGL2-Tests
   (`_overrideContextFactory`-Seam, gl-Stub, Uniform-Capture)

8. Aktuelle Test-Zahl notieren:
   `npm test -- --run 2>&1 | grep -E "Tests|passed" | tail -3`

---

## Architektur-Entscheidung [Behavior-Drift]

**Variante (b) gewählt: cleane WebGL-Aberration mit `u_intensity` als Mix-Stärke.**

Hintergrund (unverändert seit Rev. 2):
- Canvas-2D-Vorgänger macht **additive Aberration** — Original wird gezeichnet,
  dann zwei tinted Channel-Layer mit `screen`-Composite und
  `globalAlpha = intensity * env` aufaddiert. Resultat: hellere, gepumpte
  Aberration bei großem `intensity`.
- Plan-11a-WebGL-Shader macht **harten channel-replace**: das resultierende
  Pixel hat `r=sample(+s).r, g=sample(0).g, b=sample(-s).b`. Semantisch
  sauberere Aberration, gleiche Helligkeit wie Original.
- `u_intensity` als linearer Mix `mix(original.rgb, split.rgb, intensity)`
  erhält den Param-Range, drift ist visuell aber nicht bit-equivalent.

→ **KNOWN_LIMITATIONS.md ergänzen** (siehe Section unten).

---

## Fragment-Shader (unverändert seit Rev. 2)

```glsl
#version 300 es
precision highp float;

in  vec2 v_texCoord;           // ← NICHT v_uv (Vertex-Shader linkt nicht)
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec4  u_contain;       // ← Pipeline setzt automatisch (xy=offset, zw=size)
uniform vec2  u_resolution;    // ← Standard-Uniform (darf unbenutzt bleiben)
uniform float u_shift;         // UV-Delta für Channel-Trennung
uniform float u_env;           // Beat-Envelope (0.0–1.0)
uniform float u_intensity;     // 0–1 Mix zwischen Original und Aberration

void main() {
  // contain-rect-Mapping — Pflicht, sonst Full-Quad-Stretch.
  vec2 uv = u_contain.xy + v_texCoord * u_contain.zw;

  float s = u_shift * u_env;

  vec4  orig = texture(u_image, uv);
  float r    = texture(u_image, vec2(uv.x + s, uv.y)).r;
  float g    = orig.g;
  float b    = texture(u_image, vec2(uv.x - s, uv.y)).b;
  vec3  split = vec3(r, g, b);

  // Variante (b): intensity als linearer Mix zwischen Original und Aberration.
  vec3 result = mix(orig.rgb, split, u_intensity);
  fragColor   = vec4(result, orig.a);
}
```

Hinweis: Der Shader sieht keine Subdivision direkt — `u_env` ist eine
fertige Zahl 0–1, vom Plugin auf Basis von `rc.subdividedBeatPhase`
berechnet. Bei `subdivision='1×'` und sonst gleichen Inputs ist
`u_env` identisch zum pre-9c-Stand.

---

## Neues Modul: `lib/renderer/webgl/programs/rgb-split.ts`

Analog zu `lib/renderer/webgl/programs/color-grade.ts` (Vorlage Nr. 1)
bzw. `lib/renderer/webgl/programs/contour-gl.ts` (Vorlage Nr. 2).

```ts
/**
 * Plan 11a — RGBSplit Fragment-Shader.
 *
 * Channel-shift Aberration: R-Kanal sampelt bei UV+u_shift*u_env,
 * G unverändert, B bei UV-u_shift*u_env. `u_intensity` mischt linear
 * zwischen Original-RGB und aberriertem Resultat.
 *
 * Behavior-Drift vs. Canvas2D-Vorgänger: hier cleaner channel-replace
 * statt additivem screen-composite. Siehe KNOWN_LIMITATIONS.md
 * Eintrag „RGBSplit WebGL2 Aberration Look".
 *
 * Subdivision (Plan 9c): u_env wird im Plugin auf Basis
 * `rc.subdividedBeatPhase` berechnet — der Shader sieht keine
 * Subdivision direkt.
 */
export const RGB_SPLIT_FRAG_SRC = `...`; // (Shader-Code oben)

export const RGB_SPLIT_UNIFORM_NAMES = [
  'u_shift',
  'u_env',
  'u_intensity'
] as const;
```

Vertex-Shader wird NICHT in diesem Modul exportiert — `renderGlFx` /
`shader.ts` haben den Standard-Quad-Vertex-Shader intern.

---

## Plugin-Änderung: `lib/fx/rgb-split.ts`

```ts
import type { FxPlugin, RenderContext } from '@/lib/renderer/types';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';
import {
  RGB_SPLIT_FRAG_SRC,
  RGB_SPLIT_UNIFORM_NAMES
} from '@/lib/renderer/webgl/programs/rgb-split';

interface RGBSplitParams {
  offset: number;
  decay: number;
  intensity: number;
  beatSync: boolean;   // Plan 9c — toggle, war pre-9c number
}

export const rgbSplitPlugin: FxPlugin<RGBSplitParams> = {
  id: 'rgb-split',
  name: 'RGB Split',
  kind: 'RGBSplit',
  defaultTrigger: 'beat',
  preloadState: 'ready',
  supportsSubdivision: true,                                       // Plan 9c — beibehalten
  paramSchema: {
    // Unverändert post-9c. beatSync ist kind:'toggle', default:true.
    // Restliche Schemas (offset/decay/intensity) unverändert.
    /* siehe lib/fx/rgb-split.ts paramSchema */
  },
  getDefaultParams: () => ({
    offset: 0.004,
    decay: 0.15,
    intensity: 0.6,
    beatSync: true                                                  // Plan 9c — boolean
  }),
  async preload() {},

  render(rc: RenderContext, params: RGBSplitParams) {
    if (!rc.imageBitmap) return;
    if (rc.flowMode) return;

    // Plan 8g beatSync + Plan 9c subdivision — Verhalten erhalten.
    // beatSync truthy-check (boolean post-9c).
    // env basiert auf subdividedBeatPhase, NICHT beatPhase.
    const env = params.beatSync
      ? Math.max(0, 1 - rc.subdividedBeatPhase / params.decay)
      : 1.0;
    if (env < 0.01) return;

    renderGlFx({
      rc,
      fragSrc: RGB_SPLIT_FRAG_SRC,
      uniforms: {
        u_shift:     params.offset,
        u_env:       env,
        u_intensity: params.intensity
      },
      uniformNames: RGB_SPLIT_UNIFORM_NAMES
      // source default = 'bitmap' — RGBSplit sampelt Original-Bitmap
    });
  }
  // KEIN dispose() mehr — kein per-clip State
};

// ENTFERNT (gegenüber pre-11a):
// - const rgbOffByClip = new Map<...>();
// - export const _testOnly_rgbOffByClip = rgbOffByClip;
// - dispose() { rgbOffByClip.clear() }
// - Alle OffscreenCanvas-/clearRect-/multiply-/screen-Composite-Logik
```

**Was sich gegenüber Rev. 2 ändert (nur 9c-Anpassung):**
- `RGBSplitParams.beatSync: number → boolean`
- `params.beatSync >= 0.5 → params.beatSync` (truthy-check)
- `rc.beatPhase → rc.subdividedBeatPhase` in env-Formel
- `getDefaultParams().beatSync: 1 → true`
- `supportsSubdivision: true` als bereits-vorhanden vermerkt
- Schema-Block-Kommentar reflektiert post-9c-Stand

Alles andere (renderGlFx-Aufruf, Shader, Uniform-Namen, KNOWN_LIMITATIONS,
File Map, Commit-Plan) identisch zu Rev. 2.

---

## Was wegfällt aus `lib/fx/rgb-split.ts`

- `const rgbOffByClip = new Map<...>()` — module-scope State
- `dispose()` — kein State mehr zu räumen
- `_testOnly_rgbOffByClip`-Export — Test importiert ihn aktuell, muss raus
- Alle `OffscreenCanvas`-Instanzen, `clearRect`, `multiply`-fillRects,
  `screen`-Composites
- Import `containRect` ist in `lib/fx/rgb-split.ts` selbst nicht mehr nötig —
  `renderGlFx` ruft `containRect` intern auf (pipeline.ts:124)

---

## Source-Modus: `'bitmap'` (Default)

RGBSplit sampelt das Original-Bitmap (`rc.imageBitmap`), nicht den Canvas.

| FX | source |
|---|---|
| RGBSplit (neu) | `'bitmap'` |
| ColorGradeShift | `'bitmap'` |
| RetroVHS | `'bitmap'` |
| Contour-GL | `'bitmap'` |
| Edge Glow | `'canvas'` |

→ Bekannte Limitation (siehe KNOWN_LIMITATIONS-Section): vier
Bitmap-Source-FX auf demselben Clip ergeben last-writer-wins.

---

## KNOWN_LIMITATIONS.md — zwei neue Einträge (unverändert seit Rev. 2)

### Eintrag 1: RGBSplit WebGL2 Aberration Look

```markdown
### RGBSplit WebGL2 — leicht anderer Look als Canvas-2D-Vorgänger

Plan 11a (2026-05-29) migrierte RGBSplit von Canvas-2D auf WebGL2.
Der Canvas-2D-Vorgänger zeichnete das Original + zwei tinted
Channel-Layer mit `screen`-Composite — Resultat: hellere, additive
Aberration. Der WebGL-Shader macht stattdessen channel-replace per
Pixel (`r=sample(+s).r, g=sample(0).g, b=sample(-s).b`) gemixt mit
`u_intensity` gegen das Original. Visuell sauberer, aber nicht
bit-equivalent. Bestandsprojekte mit RGBSplit zeigen nach der
Migration leicht anderen Look — kein UX-Eingriff nötig, dokumentiert.
```

### Eintrag 2: Stack-Composition Bitmap-Source-FX (8f.5-Trigger)

```markdown
### Stack: CGS + VHS + RGBSplit + Contour-GL auf demselben Clip → last-writer-wins

Vier Image-Modifying-FX nutzen aktuell `source: 'bitmap'`:
ColorGradeShift, RetroVHS, RGBSplit (Plan 11a) und Contour-GL (Plan 8f.4).
Wenn 2+ davon auf demselben Clip aktiv sind, sampeln alle das Original-
Bitmap und composen mit `drawImage` auf den Main-Canvas — der letzte
Render-Pass überschreibt den vorigen. User sieht NUR den letzten FX
der Render-Order (siehe `RENDER_ORDER_TRACK_KIND`).

Workaround heute: nur einen Bitmap-Source-FX pro Clip aktiv lassen
ODER explizit Edge Glow (`source: 'canvas'`) als finale Komposition
auf chained FX setzen.

Saubere Lösung: Plan 8f.5 — alle Bitmap-Source-FX schrittweise auf
`source: 'canvas'`-Chaining migrieren, analog zu Edge Glow. Render-
Order wird dann signifikant: jeder FX sampelt was der Vorgänger
hinterlassen hat. Siehe Edge-Glow-Kommentar `lib/fx/edge-glow.ts:54-57`
für das ursprüngliche Symptom-Pair (CGS + VHS).
```

---

## Undo-Behaviour

| Action | Behandlung |
|---|---|
| RGBSplit-Param-Änderungen | Bestehend via `setClipParam` → `record + coalesce` |
| Renderer-Wechsel | Kein Store-State — kein Undo-Impact |

Reine Renderer-Migration, keine neuen Store-Actions.

---

## Tests

### Alte Tests in `tests/unit/fx/rgb-split.test.ts` — Pflicht-Anpassung

| Zeile (post-9c-Stand) | Aktion |
|---|---|
| Import `_testOnly_rgbOffByClip` | **entfernen** |
| `class StubOffscreen` + `globalThis.OffscreenCanvas = StubOffscreen` | **entfernen** |
| `_testOnly_rgbOffByClip.clear()` in beforeEach | **entfernen** |
| plugin-shape-Tests | **bleiben** (`supportsSubdivision: true` etc. bleibt erhalten) |
| flowMode → no draw | **bleibt** semantisch, gegen renderGlFx-Mock prüfen |
| *„3 drawImage calls"*-Test | **umschreiben** → `renderGlFx`-Mock-Call-Assert |
| `env=0` → no draws | **bleibt** semantisch, gegen renderGlFx-Mock prüfen |
| **9c-Tests** (subdivision-render, beatSync-toggle, supportsSubdivision-flag) | **bleiben unverändert** — Plan-11a touchet die nicht |

### Neue Tests `tests/unit/fx/rgb-split-webgl.test.ts`

Pattern-Vorlage: `tests/unit/fx/color-grade-shift.test.ts` oder
`tests/unit/fx/edge-glow.test.ts` (für `_overrideContextFactory`-Seam).

1. **Shader-Quelle ist non-empty + enthält `u_contain`-Mapping**
   (Regex `u_contain.xy + v_texCoord` oder ähnlich)
2. **`u_shift` Uniform = `params.offset`** (UV-direkt, kein Pixel-Konvert)
3. **`u_env` Uniform = beatSync-/subdivision-abhängiger Wert**
   - `beatSync=true, subdividedBeatPhase=0, decay=0.15` → `u_env = 1.0`
   - `beatSync=true, subdividedBeatPhase=0.5, decay=0.15` → `u_env ≈ 0` (geclamped)
   - `beatSync=true, subdivision='4×', beatPhase=0.125, decay=0.15` →
     `subdividedBeatPhase=0.5` → `u_env ≈ 0` (Cross-Check mit 9c-Berechnung)
4. **`u_intensity` Uniform wird übergeben** (Behavior-Drift-Schutz)
5. **`beatSync=false` → `u_env = 1.0` unabhängig von `subdividedBeatPhase`**
   (Plan-8g/9c-Verhalten erhalten)
6. **`renderGlFx` wird aufgerufen, nicht Canvas-2D-Fallback**
   (Mock-Spy auf `renderGlFx`)
7. **`!rc.imageBitmap` → kein `renderGlFx`-Call**

Mindest: **+7 neue Tests + ~4 angepasste alte Tests**.
Die 9c-spezifischen Tests bleiben unverändert und zählen separat.

---

## Performance-Erwartung + Verification

**Vor-Migration Baseline messen** (Pflicht, sonst Aussage spekulativ):
1. Live-Preview mit RGBSplit auf einem Video-Clip
2. `performance.measure('rgb-split-render', 'rgb-split-start', 'rgb-split-end')`
   um den Canvas-2D-render() Aufruf wickeln
3. Avg + p95 über 60 Frames notieren

**Nach-Migration nochmal messen.** Werte in PR-Description und/oder
KNOWN_LIMITATIONS-Eintrag aufnehmen.

Erwartung (anhand 8f / 8f.3 / 8f.4): avg-Reduktion 5–10×, weniger
Spikes bei Video-Quellen. Wird durch Messung bestätigt oder korrigiert.

---

## Dateien

| Datei | Aktion |
|---|---|
| `lib/renderer/webgl/programs/rgb-split.ts` | CREATE |
| `lib/fx/rgb-split.ts` | MODIFY — Canvas-2D-Body → renderGlFx-Delegation; `supportsSubdivision: true` + boolean-beatSync + `subdividedBeatPhase`-env aus 9c bleiben erhalten; `_testOnly_rgbOffByClip` + `dispose()` entfernen |
| `tests/unit/fx/rgb-split.test.ts` | MODIFY — siehe Tabelle oben |
| `tests/unit/fx/rgb-split-webgl.test.ts` | CREATE — 7 neue Tests |
| `docs/KNOWN_LIMITATIONS.md` | MODIFY — zwei neue Einträge (siehe Section) |
| `docs/superpowers/uebergabe-architekt.md` | MODIFY — RGBSplit: Canvas 2D → WebGL2 |

**Keine Änderungen** an `lib/renderer/types.ts`,
`lib/timeline/types.ts` oder `lib/timeline/plugin-mapping.ts` —
RGBSplit existiert bereits, Subdivision-Felder sind 9c-Erbe,
nur der Renderer wechselt.

---

## Commits

```
feat(webgl): rgb-split fragment shader + uniform-names export
feat(fx-rgb-split): replace Canvas-2D with renderGlFx delegation (preserves 9c subdivision + boolean beatSync)
test(fx-rgb-split): adapt existing tests + WebGL2 shader/uniform tests
docs(known-limitations): RGBSplit aberration look + Bitmap-source-stack note
docs(architekt): rgb-split renderer Canvas2D → WebGL2
```

5 Commits.

---

## Nicht vergessen

- `u_contain`-Mapping ist Pflicht im Shader (sonst Aspect-Bruch)
- `uniformNames`-Array ist Pflicht-Argument bei `renderGlFx`
- `_overrideContextFactory`-Seam für Tests (siehe color-grade-shift.test.ts / edge-glow.test.ts)
- Safari 17+ Requirement bleibt (durch `renderGlFx`-Capabilities-Gate abgedeckt)
- **Plan 9c-Erbe respektieren:** `supportsSubdivision: true`,
  `beatSync: boolean`, `subdividedBeatPhase` in env — alles bleibt, Plan 11a
  ändert nur den Renderer-Body, nicht die 9c-Semantik
- Kein `dispose()` mehr nötig — kein per-clip State im neuen Plugin

---

Rev. 3 — Rev. 2 angepasst an post-9c-Realität:
1. `params.beatSync` als `boolean` (truthy-check statt `>= 0.5`)
2. env-Berechnung auf Basis `rc.subdividedBeatPhase`
3. `supportsSubdivision: true` als bestehend dokumentiert
4. Cross-Reference zu Plan 9c im Header + im Plugin-Snippet
5. Test-Snippets reflektieren boolean + subdivision

Shader, Pipeline-Aufruf, KNOWN_LIMITATIONS-Einträge, File Map und
Commit-Plan bleiben gegenüber Rev. 2 inhaltlich gleich.
