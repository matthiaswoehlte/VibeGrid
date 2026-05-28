# CC #1 Prompt — Plan 8g: Beat Sync Toggle

**Einen `beatSync`-Param (0/1 Slider) auf alle impulsiven FX bringen,
der Beat-Synchronisation **pro Clip** abschaltbar macht und über
Automation-Kurven steuerbar ist.**

Baseline: HEAD post-8f.3 (≥1298 Tests, Store v6).

---

## Konzeptioneller Hintergrund (wichtig vor dem Reinlesen)

Es gibt **zwei verschiedene Controls** für "FX läuft konstant statt beat-synchron":

| Control | Scope | Wirkung |
|---|---|---|
| `rc.flowMode` (existiert) | **GLOBAL** — Toggle für die ganze Timeline | Schaltet Beat-Sync für **alle** FX gleichzeitig aus |
| `beatSync` (Plan 8g) | **PER CLIP** | Schaltet Sync **nur für diesen einen Clip** aus, während andere FX weiter pulsieren |

Plan 8g liefert die per-Clip-Variante. Das ist nicht redundant zu flowMode — es ist eine andere Bedienungsebene. Beispiel: User will Edge Glow als persistenten Backdrop-Look, während BeatFlash auf demselben Beat pulsiert. Heute geht das nicht (flowMode würde alles konstantifizieren). Mit beatSync=0 auf dem Edge-Glow-Clip + beatSync=1 auf dem BeatFlash-Clip geht es.

---

## Schritt 0 — Codebase lesen (PFLICHT)

Für jeden FX in der Kandidaten-Liste (s.u.) genau lesen:

1. Hat er eine `env`/`decay`-Logik? Wie heißt die Variable?
2. Wie sieht der Beat-Sync-Pfad aus (beatPhase, flowMode, decay)?
3. **flowMode-Pattern bestimmen**: macht der FX `if (rc.flowMode) return;` (**skip-Pattern**) oder `const env = isFlow ? 1.0 : ...` (**pin-Pattern**)? Das entscheidet welches der zwei render()-Templates unten greift.

Lese außerdem:
- `lib/renderer/types.ts` — RenderContext-Felder. **Achtung**: `beatPhase` und `beatIndex` existieren, `rc.beat` NICHT.
- `lib/renderer/loop.ts:539-542` — bestätigen, dass der Loop bereits `resolveClipParams(...)` aufruft BEVOR die Plugin-`render()` invoked wird. Daraus folgt: Plugins bekommen `params.beatSync` als reines Number, kein `StaticOrAuto<T>`. Plugin selbst ruft **niemals** `resolveParam` auf.
- `lib/automation/resolve.ts` — informativ (zeigt was der Loop tut)
- `lib/fx/color-grade-shift.ts` — Referenz für direkte Param-Reads
- `lib/fx/edge-glow.ts` — Referenz pin-Pattern
- `lib/fx/retro-vhs.ts` — Referenz pin-Pattern mit zusätzlichem Zeroing von beat-spezifischen Uniforms. Plan-Vorgabe nennt `dropoutIntensity` + `warpIntensity` (verifiziert auf Z. 165-168). **CC #1 muss in Schritt 0 zusätzlich prüfen, ob es WEITERE beat-only Uniforms gibt, die ebenfalls bei `isConstant` gezerot werden müssen** — sonst rendert beatSync=0 mit Resteffekten die nur in Beat Mode sinnvoll sind. Falls weitere gefunden: in der isConstant-Zeroing-Liste ergänzen, RetroVHS-Test entsprechend erweitern.

**Per-FX env-Tabelle vervollständigen** (siehe Section "Per-FX env-Tabelle" unten). Vorgegebene Werte für BeatFlash, ZoomPunch, Edge Glow, RetroVHS sind code-verifiziert; für die restlichen 5 FX **echte Variablennamen aus dem Code übernehmen — kein Raten**.

Aktuelle Test-Zahl notieren (Erwartung: 1298).

---

## Kandidaten-Liste (Rev. 3)

### ✅ beatSync bekommt — 10 FX

| FX | kind | flowMode-Pattern | Begründung |
|---|---|---|---|
| BeatFlash | BeatFlash | skip | Klassischer Impuls-FX |
| ZoomPunch | ZoomPunch | skip | Impulsiv, attack+decay-Sonderform |
| ScreenShake | ScreenShake | skip | Impulsiv, decay |
| GlitchSlice | GlitchSlice | skip | Impulsiv, decay |
| RGBSplit | RGBSplit | skip | Impulsiv, decay |
| FilmGrainBurst | FilmGrainBurst | skip | Impulsiv, decay |
| LensFlareBurst | LensFlareBurst | skip | Impulsiv, decay |
| **ColorGradeShift** | **ColorGradeShift** | **skip** | **WebGL2 Beat-Pulse, flowMode-return bestätigt (Schritt 0)** |
| **Edge Glow** | **EdgeGlow** | **pin** | **User will persistenten Backdrop‑Look pro Clip ohne globalen Flow Mode** |
| **RetroVHS** | **RetroVHS** | **pin** | **Wie Edge Glow — persistenter Stil pro Clip ohne globalen Flow Mode** |

### ✅ ColorGradeShift — skip-Pattern (Template A, CC #1 bestätigt in Schritt 0)

`lib/fx/color-grade-shift.ts` verwendet `if (rc.flowMode) return;` (Zeile 102) → **skip-Pattern, Template A**.

CGS bekommt beatSync mit Template A. Kandidaten sind 10.

### ❌ beatSync bekommt NICHT — Begründung

| FX | Grund |
|---|---|
| VignetteBreathe | Persistenter Atem-Rhythmus, kein Beat-Impuls-Pattern |
| LetterboxSqueeze | Persistente Bewegung — kein Impuls-Pattern |
| ZoomPulse | Grenzfall persistenter FX, kein env-Decay |
| Contour | CPU-basiert, kein env-Pattern |
| Text | Kein Beat-Decay-Konzept |
| Particles | Eigen-State, kein env |
| Sweep | Eigen-State, Richtung nicht beat-basiert |
| Sunray | Persistenter Look |
| Dissolve | Transition-FX, kein Beat-Impuls |

**CC #1 prüft in Schritt 0 ob diese Einschätzungen mit dem echten Code übereinstimmen — bei Abweichungen melden, nicht raten.**

---

## ⚠️ Bekannte Limitation: flowMode-Verhältnis ist je nach Pattern unterschiedlich

| FX-Pattern | Beat Mode + beatSync=1 | Beat Mode + beatSync=0 | Flow Mode + beatSync=1 | Flow Mode + beatSync=0 |
|---|---|---|---|---|
| **skip-FX** (8 Stück: BeatFlash, ZoomPunch, ScreenShake, GlitchSlice, RGBSplit, FilmGrainBurst, LensFlareBurst, ColorGradeShift) | pulsiert | konstant (env=1) | **skipped** (flowMode-return) | **skipped** (flowMode-return) |
| **pin-FX** (Edge Glow, RetroVHS) | pulsiert | konstant (env=1) | konstant (env=1) | konstant (env=1) |

**Für die 8 skip-FX:** beatSync wirkt nur in Beat Mode. In Flow Mode trumpft `rc.flowMode` — FX skippt weiterhin. Wer beatSync=0 in Flow Mode nutzen will, müsste Flow Mode ausschalten.

**Für die pin-FX:** beatSync=0 und Flow Mode konvergieren beide zu env=1.0 → kein Konflikt, beide Wege geben denselben persistenten Look. Per-Clip-beatSync ist die feinere Bedienungsebene; globaler Flow Mode ist die grobe.

Diese Limitation wird in `docs/KNOWN_LIMITATIONS.md` dokumentiert (im selben Commit wie der Test-Commit am Ende).

**Folge-Plan 8g.5** (separates Vorhaben nach 8g): flowMode-Pattern-Vereinheitlichung. Die 8 skip-FX werden auf das pin-Pattern umgestellt, so dass die Tabelle oben für alle FX gleich aussieht. Eigene Architektur-Frage unabhängig vom beatSync-Feature.

---

## Was sich pro FX ändert

### paramSchema — 1 neuer Eintrag (für alle 10 FX identisch)

```ts
beatSync: {
  kind: 'slider',
  label: 'Beat Sync',
  min: 0,
  max: 1,
  step: 1,
  default: 1,
}
```

Immer als **letzter Param** im Schema (nach decay/intensity/allen FX-spezifischen Params) — damit bestehende Inspector-Reihenfolge unverändert bleibt.

### getDefaultParams() — 1 neuer Key

```ts
beatSync: 1,
```

### render() — zwei Templates je nach flowMode-Pattern

**Template A — skip-FX (BeatFlash, ZoomPunch, ScreenShake, GlitchSlice, RGBSplit, FilmGrainBurst, LensFlareBurst, ColorGradeShift)**

```ts
if (rc.flowMode) return;  // unverändert — skip trumpft beatSync
const synced = params.beatSync >= 0.5
const env = synced
  ? <bestehende FX-spezifische env-Formel>
  : 1.0
if (env < 0.01) return;  // unverändert
// rest of render() unverändert
```

**Beispiel BeatFlash (`params.duration`, nicht `decay`):**

```ts
if (rc.flowMode) return;
const synced = params.beatSync >= 0.5
const env = synced
  ? Math.max(0, 1 - rc.beatPhase / params.duration)
  : 1.0
if (env < 0.01) return;
```

**Beispiel ZoomPunch (Sonderform mit `attack`-Offset):**

```ts
if (rc.flowMode) return;
const synced = params.beatSync >= 0.5
const env = synced
  ? Math.max(0, 1 - (p - params.attack) / params.decay)
  : 1.0
const scale = 1 + (params.strength - 1) * env
```

**Template B — pin-FX (Edge Glow, RetroVHS)**

```ts
const synced = params.beatSync >= 0.5
const isConstant = rc.flowMode || !synced  // pin-Pfad: flowMode ODER beatSync=0
const env = isConstant
  ? 1.0
  : Math.max(0, 1 - rc.beatPhase / params.decay)
if (!isConstant && env < 0.01) return;  // nur in Beat Mode + synced skippen
// rest of render() unverändert
```

**Wichtig für RetroVHS** (`lib/fx/retro-vhs.ts:165-168`): das `isFlow ? 0 : params.dropoutIntensity` / `isFlow ? 0 : params.warpIntensity` Pattern muss auf `isConstant ? 0 : ...` umgestellt werden — beatSync=0 soll auch dropout/warp zeroen (sonst rendert RetroVHS in beatSync=0-Modus dauerhaft auf Maximal-Dropout/Warp, was visuell Müll wäre).

**Für Edge Glow** (`lib/fx/edge-glow.ts:138-140`): nur `isFlow` durch `isConstant` ersetzen, sonst keine zusätzlichen Anpassungen — Edge Glow hat keine beat-only-Uniforms zu zeroen.

---

## Per-FX env-Tabelle

CC #1 trägt die fehlenden Felder in Schritt 0 ein. Code-verifizierte Vorgaben:

| FX | env-Variable(n) | Formel-Besonderheit | flowMode-Pattern | Template |
|---|---|---|---|---|
| BeatFlash | `params.duration` | Standard — **Achtung: heißt nicht `decay`** | skip | A |
| ZoomPunch | `params.attack` + `params.decay` | Attack-Offset — env ersetzt das `Math.max(...)`-Inner | skip | A |
| ScreenShake | `params.decay` | Standard — `Math.max(0, 1 - rc.beatPhase / params.decay)` | skip | A |
| GlitchSlice | `params.decay` | Standard — `Math.max(0, 1 - rc.beatPhase / params.decay)` | skip | A |
| RGBSplit | `params.decay` | Standard — `Math.max(0, 1 - rc.beatPhase / params.decay)` | skip | A |
| FilmGrainBurst | `params.decay` | Standard — `Math.max(0, 1 - rc.beatPhase / params.decay)` | skip | A |
| LensFlareBurst | `params.decay` | Standard — `Math.max(0, 1 - rc.beatPhase / params.decay)` | skip | A |
| Edge Glow | `params.decay` | Standard | pin | B |
| RetroVHS | `params.decay` + zero `dropoutIntensity`/`warpIntensity` wenn `isConstant` | Standard env + Sondersorgfalt für beat-only-Uniforms | pin | B |
| ColorGradeShift | `params.decay` | Standard — `Math.max(0, 1 - rc.beatPhase / params.decay)` | skip | A |

CC #1 implementiert exakt was im Code steht — **kein Raten**. Wenn ein FX nicht der erwarteten env-Form folgt, vor Commit melden.

---

## TODO-Kommentar für Inspector-UX (Pflicht in einer Plugin-File)

Slider mit `step:1, min:0, max:1` rendert als 2-Stop-Slider — auf Touch-Geräten (Plan-11-Target) ungünstig zu treffen. In einer der Plugin-Files (z.B. `lib/fx/beat-flash.ts`) als Anker für den künftigen UX-Audit:

```ts
// TODO(Plan-UX-1): replace beatSync slider (step:1) with kind:'toggle'
// when Inspector supports toggle params. Touch-UX is suboptimal with
// a 2-stop slider.
```

Nur an einer Stelle — die TODO ist kategorisch, nicht pro-FX.

---

## JSON-Kompatibilität (kein Migration-Bedarf)

Bestehende Projekte haben `beatSync` nicht in `clip.params`.
`getDefaultParams()` liefert `1` → Beat Sync bleibt standardmäßig an.
Exakt gleicher Behavior wie vor dem Plan. **Keine Store-Migration.**

---

## Undo-Behaviour

| Action | Behandlung |
|---|---|
| `beatSync` Slider-Änderung im Inspector | bestehend via `setClipParam` → `record + coalesce` |
| Automation-Kurve auf `beatSync` | bestehend via Automation-Editor |

Keine neuen Store-Actions — bestehende Infrastruktur deckt alles ab.

---

## Commit-Struktur

```
feat(fx): beatSync toggle on BeatFlash + ZoomPunch + ScreenShake (Template A)
feat(fx): beatSync toggle on GlitchSlice + RGBSplit + FilmGrainBurst + LensFlareBurst + ColorGradeShift (Template A)
feat(fx): beatSync toggle on Edge Glow + RetroVHS (Template B, RetroVHS mit isConstant-Zeroing)
test(fx): beatSync param + render behaviour (alle 10 FX) + KNOWN_LIMITATIONS flowMode-Note
```

4 Commits. Der letzte Commit bündelt Tests + Doku-Limitation in `docs/KNOWN_LIMITATIONS.md`, weil beides denselben Concern adressiert.

---

## Tests

Pro FX mindestens 2 neue Tests:

**Template-A-FX (skip-Pattern):**

```ts
it('beatSync=1 decays with beat phase', () => {
  const rc = makeRenderContext({ beatPhase: 0.5, flowMode: false })
  plugin.render(rc, { ...defaults, beatSync: 1 })
  // env < 1 erwartet
})

it('beatSync=0 runs at full intensity (env=1.0) regardless of beatPhase', () => {
  const rc = makeRenderContext({ beatPhase: 0.99, flowMode: false })
  plugin.render(rc, { ...defaults, beatSync: 0, <decay-or-duration>: 0.1 })
  // kein Skip, env=1.0
})
```

**Template-B-FX zusätzlich Konvergenz-Test:**

```ts
it('beatSync=0 in Flow Mode produces the same env as Flow Mode alone', () => {
  // beide Pfade → env=1.0 → identisches Verhalten
  const rcA = makeRenderContext({ beatPhase: 0.5, flowMode: true })
  const rcB = makeRenderContext({ beatPhase: 0.5, flowMode: false })
  plugin.render(rcA, { ...defaults, beatSync: 1 })
  plugin.render(rcB, { ...defaults, beatSync: 0 })
  // beide renderGlFx-Calls → u_intensity identisch
})
```

**Speziell RetroVHS:** dritter Test für das dropout/warp-Zeroing in beatSync=0:

```ts
it('beatSync=0 zeros u_dropout_intensity and u_warp_intensity (like Flow Mode)', () => {
  const rc = makeRenderContext({ beatPhase: 0, flowMode: false })
  plugin.render(rc, { ...defaults, beatSync: 0 })
  const args = mockedRenderGlFx.mock.calls[0][0]
  expect(args.uniforms.u_dropout_intensity).toBe(0)
  expect(args.uniforms.u_warp_intensity).toBe(0)
})
```

**Mindest-Tests:** 10 FX × 2 = **20 neue Tests** + RetroVHS-Extra = **21**.

Test-Zahl-Soll: 1298 → 1319.

---

## Nicht im Scope

- **Neues `kind: 'toggle'`** im Param-Schema (siehe TODO-Kommentar)
- **Beat Sync für persistente FX** (VignetteBreathe, LetterboxSqueeze, ZoomPulse, etc.) — kein env-Pattern, anderer Mechanismus nötig
- **flowMode-Pattern-Vereinheitlichung** (skip-FX auf pin-Pattern umstellen) — separater Folge-Plan 8g.5
- **Inspector-UI-Anpassungen** (2-Stop-Slider akzeptiert für v1)

---

Rev. 3 — 2026-05-28. Korrektur gegen Rev. 2: Edge Glow + RetroVHS sind in die Kandidaten-Liste zurückgeführt, weil per-Clip-beatSync und globaler flowMode zwei verschiedene Bedienungsebenen sind. Die Rev. 2 / Architekt-Entscheidung hatte sie irrtümlich als "redundant zu flowMode" eingestuft. Plan trennt jetzt explizit zwischen skip-Pattern (Template A) und pin-Pattern (Template B) und beschreibt das Render-Template + die Test-Erwartung pro Pattern. **Architekt-Approval Rev. 3 erhalten 2026-05-28** mit einer Zusatzpflicht: Schritt 0 muss verifizieren, ob RetroVHS weitere beat-only Uniforms hat (über dropoutIntensity + warpIntensity hinaus) die ebenfalls gezerot werden müssen. Freigegeben zur subagent-driven Execution.
