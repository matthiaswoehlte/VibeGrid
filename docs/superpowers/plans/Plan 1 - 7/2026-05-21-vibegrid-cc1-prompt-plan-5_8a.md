# Architekt-Antwort — Plan 5.8 Pre-Review + Aktualisierter Prompt

---

## Entscheidungen zu den Blocker-Punkten

### B1 — FxKind-Union / TrackKind / RENDER_ORDER ✅ Adressiert

Vollständig berechtigt. Plan muss enthalten:

```ts
// lib/renderer/types.ts
export type FxKind =
  | 'Contour' | 'Pulse' | 'Sweep' | 'Particle' | 'ZoomPulse'
  | 'Text' | 'Dissolve' | 'Sunray';  // ← neu

// lib/timeline/types.ts — TrackKind ergänzen
export type TrackKind = 'image' | 'audio' | 'fx-contour' | 'fx-pulse' | ...
  | 'fx-text' | 'fx-dissolve' | 'fx-sunray';  // ← neu

// loop.ts — RENDER_ORDER + KIND_TO_TRACK_KIND ergänzen (siehe N2)
```

Store-Migration: version bump v3→v4, migrate-Hook ergänzt die drei
neuen Tracks mit leeren `clips: []`. Eigener Task 0 im Plan.

---

### B2 — Dissolve: destination-out fällt weg ✅ Entschieden

**destination-out ist falsch** mit opaquem Background. Korrekte
Implementierung: **source-over Overlay**.

Dissolve zeichnet einen gerichteten Schleier **über** das Bild:

```ts
// Beat-getriggert: sweepAlpha = sweepProgress * intensity
const origin = directionToOrigin(direction, w, h);
const end = { x: w - origin.x, y: h - origin.y };
const grad = ctx.createLinearGradient(origin.x, origin.y, end.x, end.y);
grad.addColorStop(0, `rgba(12,13,18,${sweepAlpha})`); // --bg Farbe
grad.addColorStop(softness, `rgba(12,13,18,0)`);
ctx.fillStyle = grad;
ctx.fillRect(0, 0, w, h);
```

Der Schleier ist ein halbtransparenter `--bg`-farbiger Vorhang der
sich von der Richtung her "aufhebt". source-over, kein gCO-Wechsel,
kein ctx.save/restore nötig. Korrekt auf opaquem Background.

---

### B3 — Rock-Jitter: per-Clip cachen ✅ Entschieden

**Math.random() pro Frame = Flackern.** Mein Fehler im Prompt.

Fix: Jitter-Array einmalig beim ersten Spawn berechnen und in der
per-clip state Map cachen:

```ts
// In getOrCreateState(clipId):
interface TextClipState {
  rockJitter: Array<{dx: number; dy: number}>;  // length = maxDepth (30)
}

function getOrCreateState(clipId: string): TextClipState {
  if (!states.has(clipId)) {
    states.set(clipId, {
      rockJitter: Array.from({length: 30}, () => ({
        dx: Math.random() * 1.5 - 0.75,
        dy: Math.random() * 1.5 - 0.75,
      })),
    });
  }
  return states.get(clipId)!;
}
```

Jitter wird einmal generiert und bleibt stabil — kein Flackern.
Kein Seed nötig (unterschiedliche Jitter-Werte zwischen Sessions
sind akzeptabel per Matthias-Entscheidung).

---

### B4 — Inspector Conditional Visibility ✅ Plan-Split

CC #1's Empfehlung ist richtig. Plan 5.8 wird geteilt:

**Plan 5.8a — FX-Plugins** (dieser Plan):
- FXDirection + Helpers
- Text FX Plugin (ohne konditionelle Controls vorerst)
- Dissolve FX Plugin
- Sunray FX Plugin
- FxKind/TrackKind/RENDER_ORDER Registration
- **Text FX zeigt ALLE Params im Inspector** (auch wenn 3D aus ist)
  — kein Conditional. Akzeptabler v0.1-Kompromiss.

**Plan 5.8b — Inspector Conditional Visibility + Auto-Preset Update**:
- Neues `visibleWhen?: (params: Record<string, unknown>) => boolean`
  Feld im paramSchema
- Inspector-Rendering-Logik filtert damit
- `blinkDecay` verschwindet wenn `blink === false`
- 3D-Params verschwinden wenn `enable3d === false`
- Auto-Preset system_prompt Update für neue FX-Kinds
- Eigener kleiner Plan, kein Blocker für 5.8a

---

## Entscheidungen zu den Unklarheiten

### E1 — Beat-Trigger: stateless aus beatPhase ✅

**Stateless ist die richtige Wahl.** Konsistenz mit Pulse/ZoomPulse,
kein Seek-Problem, kein per-clip State für Dissolve/Sunray nötig
(außer Text für den Rock-Jitter):

```ts
// In Dissolve + Sunray render():
const sweepAlpha = Math.max(0, 1 - rc.beatPhase * (1 + decay * 3))
                   * intensity;
```

`rc.beatPhase` ist 0 direkt auf dem Beat, läuft zu 1 bis zum nächsten
Beat — genau was wir brauchen. Plan soll das so vorschreiben.

---

### E2 — Text-Position-Animation: `progress`-Param ✅

Sauberere Lösung. Implementierung:

```ts
// In render():
const raw = rc.time - rc.clipStartSec; // clip-relative time in seconds
const duration = rc.clipDurationSec;
const progress = resolveParam(params.progress, rc.beat, duration);
// progress = 0..1

const x = (params.startX + (params.endX - params.startX) * progress) * rc.width;
const y = (params.startY + (params.endY - params.startY) * progress) * rc.height;
```

`params.progress: StaticOrAuto<number>` mit Default-Value `0` (static).
Wenn static bleibt, interpoliert der Renderer automatisch via
clip-relative Zeit — das macht ein eigener `progressFromTime`-Resolver.

---

### E3 — Clip-relative Zeit im RC ✅ RC erweitern

`rc.clipStartSec` und `rc.clipDurationSec` werden dem `RenderContext`
hinzugefügt. Der Renderer berechnet sie aus `clip.startBeat` und
`clip.lengthBeats` via `beatToSec(bpm)`:

```ts
// In loop.ts, beim Aufbau des RC:
clipStartSec: beatToSec(clip.startBeat, beatGrid),
clipDurationSec: beatToSec(clip.lengthBeats, beatGrid),
```

Bestehende Plugins ignorieren diese Felder — kein Breaking Change.
Eigener Mini-Task im Plan (RC-Erweiterung + Typen + 2 Tests).

---

### E4 — Auto-Preset ✅ nach Plan 5.8b

Auto-Preset system_prompt Update kommt in Plan 5.8b zusammen mit
Conditional Visibility. In 5.8a: die neuen Plugins werden noch nicht
von Auto-Preset vorgeschlagen — akzeptabler Zustand für v0.1-alpha.

---

### E5 — Font Loading: nur System-Fonts ✅

**Nur System-Fonts in der Preset-Liste.** Keine Google Fonts für v0.1:

```ts
export type TextFontFamily =
  | 'Arial'
  | 'Georgia'
  | 'Impact'
  | 'Courier New'
  | 'Times New Roman'
  | 'Verdana';
```

Begründung: kein Network-Request, kein Build-Größen-Impact, keine
CORS-Probleme, funktioniert offline. 'Playfair Display' und 'Inter'
aus dem Prompt-Vorschlag gestrichen. v0.2 kann Google Fonts via
`next/font` ergänzen wenn gewünscht.

---

## Antworten auf Doku-Lücken

### N1 — Sunray undefined Variablen ✅

```ts
const spreadAngle = params.spread * Math.PI;       // max = 180°
const maxLength = Math.hypot(rc.width, rc.height); // Diagonale = sicher außerhalb
const baseAngle = directionToAngle(params.direction); // aus Helper
```

In Plan ergänzen.

### N2 — RENDER_ORDER ✅

```ts
// loop.ts RENDER_ORDER (von unten nach oben):
const RENDER_ORDER: FxKind[] = [
  'Dissolve',    // 1. Manipuliert das Image direkt
  'Contour',
  'Sweep',
  'Pulse',
  'ZoomPulse',
  'Particle',
  'Sunray',      // Lichteffekt über FX
  'Text',        // Immer ganz oben
];
```

### N3 — Plan-Nummerierung ✅

5.8a / 5.8b bleibt bei 5.x-Serie. FX-Erweiterungen gehören zum
Kern-Featureset, keine eigene Nummerierung nötig.

### N4 — Verification Gate ✅

Baseline 453, neue Tests ~25 → Gate: **≥ 478 Tests**. Im Plan korrigieren.

### N5 — Bundle-Budget ✅

Baseline 153 kB. Budget: **≤ 160 kB** (+5%). Im Plan als explizites
Build-Gate ergänzen:
```
npm run build
# Studio-Page First Load JS: ≤ 160 kB (Baseline 153 kB)
```

---

## Aktualisierter Plan-Prompt für CC #1

Bitte den bestehenden Prompt **ersetzen** durch folgenden:

---

# CC #1 Prompt — Schreibe Plan 5.8a: Text FX + Dissolve FX + Sunray FX

## Kontext

Plan 6-R abgeschlossen. Baseline: **453 Tests**, alle Gates grün.

Schreibe nur den Plan — noch keinen Code.

---

## Vorbedingung: RC-Erweiterung (Task 0)

Vor allen FX-Tasks: `RenderContext` um zwei Felder erweitern:

```ts
// lib/renderer/types.ts — ergänzen:
clipStartSec: number;    // clip.startBeat umgerechnet via beatToSec
clipDurationSec: number; // clip.lengthBeats umgerechnet via beatToSec
```

Im Renderer (`loop.ts`): beim RC-Aufbau mit expliziten Formeln berechnen:
```ts
clipStartSec: (clip.startBeat * 60) / beatGrid.bpm + beatGrid.offsetMs / 1000,
clipDurationSec: (clip.lengthBeats * 60) / beatGrid.bpm,
```
`offsetMs` nur für den Zeitpunkt, nicht für die Dauer. Bestehende Plugins
ignorieren die neuen Felder — kein Breaking Change.

**ParamType-Erweiterung:** `lib/renderer/types.ts` ParamType Union ergänzen:
```ts
| { kind: 'text'; default: string; maxLength?: number }
```
(`'select'` existiert bereits — nur `'text'` ist neu.)

Tests: ≥ 2 (RC enthält korrekte clipStartSec/clipDurationSec).

---

## FxKind / TrackKind / RENDER_ORDER (Task 1)

**Muss vor den Plugin-Tasks stehen.**

1. `lib/renderer/types.ts`: `FxKind` um `'Text' | 'Dissolve' | 'Sunray'` erweitern
2. `lib/timeline/types.ts`: `TrackKind` um `'text' | 'dissolve' | 'sunray'` erweitern
3. `loop.ts`: `RENDER_ORDER` und `KIND_TO_TRACK_KIND` ergänzen:

```ts
const RENDER_ORDER: FxKind[] = [
  'Dissolve', 'Contour', 'Sweep', 'Pulse', 'ZoomPulse',
  'Particle', 'Sunray', 'Text',  // Dissolve ganz unten, Text ganz oben
];
```

4. `lib/store/timeline-slice.ts`: `initialTimelineState.tracks` um
   drei neue Tracks ergänzen
5. **Store-Migration v3→v4**: migrate-Hook fügt die drei neuen Tracks
   mit `clips: []` ein falls sie fehlen (bestehende Projekte upgraden)

Tests: ≥ 3 (RENDER_ORDER-Reihenfolge, Migration v3→v4 behält bestehende
Clips, KIND_TO_TRACK_KIND liefert korrekte TrackKind)

---

## Gemeinsamer Typ: FXDirection (Task 2)

```ts
// lib/fx/direction.ts
export type FXDirection =
  | 'top' | 'bottom' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  | 'center';

export function directionToOrigin(dir: FXDirection, w: number, h: number):
  { x: number; y: number }

export function directionToAngle(dir: FXDirection): number
// 'top'→-π/2, 'right'→0, 'bottom'→π/2, 'left'→π,
// 'top-right'→-π/4, 'bottom-right'→π/4, etc., 'center'→0
```

Tests: ≥ 5 (alle 9 Richtungen für Origin + Angle)

---

## Plugin 1 — Text FX (Task 3)

**Datei:** `lib/fx/text.ts` | **Kind:** `'Text'`

### Parameter

```ts
interface TextParams {
  text: string;
  fontSize: number;                    // 8–200, default: 48
  fontFamily: TextFontFamily;          // 'Arial'|'Georgia'|'Impact'|'Courier New'|'Times New Roman'|'Verdana'
  colorFrom: string;                   // default: '#ffffff'
  colorTo: string;                     // default: '#a86bff'
  gradientOrientation: 'top-to-bottom' | 'left-to-right'
    | 'top-left-to-bottom-right' | 'center-to-outside';
  useAutoProgress: boolean;            // default: true — wenn true, ignoriere progress
  progress: number;                    // 0..1, nur aktiv wenn useAutoProgress=false
  startX: number;                      // 0..1, default: 0.1
  startY: number;                      // 0..1, default: 0.5
  endX: number;                        // 0..1, default: 0.9
  endY: number;                        // 0..1, default: 0.5
  blink: boolean;                      // default: false
  blinkDecay: number;                  // 0..1, default: 0.7
  enable3d: boolean;                   // default: false
  extrusionDirection: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  extrusionDepth: number;              // 2–30, default: 8
  extrusionStyle: 'plain' | 'rock';   // default: 'plain'
}
```

### Canvas-Implementierung

```ts
// Position
const t = params.useAutoProgress
  ? Math.max(0, Math.min(1,
      rc.clipDurationSec > 0
        ? (rc.time - rc.clipStartSec) / rc.clipDurationSec
        : 0
    ))
  : Math.max(0, Math.min(1, params.progress));

const x = (params.startX + (params.endX - params.startX) * t) * rc.width;
const y = (params.startY + (params.endY - params.startY) * t) * rc.height;

// Gradient
// 'center-to-outside' → ctx.createRadialGradient, sonst linear
// Gradient über Text mit ctx.fillStyle = gradient

// 3D-Extrusion (wenn enable3d)
// plain: deterministisch, kein State
// rock: Jitter aus per-clip state Map (einmalig gecacht):
//   rockJitter = Array.from({length:30}, () => ({dx: Math.random()*1.5-0.75, dy: ...}))
//   für Layer i: dx += state.rockJitter[i].dx

// Blink: stateless aus beatPhase
const blinkAlpha = params.blink
  ? Math.max(0, 1 - rc.beatPhase * (1 + params.blinkDecay * 3))
  : 1;
ctx.globalAlpha *= blinkAlpha;

// Darken helper für plain 3D:
// darken(hex, factor) in lib/utils/color.ts
```

Tests: ≥ 5

---

## Plugin 2 — Dissolve FX (Task 4)

**Datei:** `lib/fx/dissolve.ts` | **Kind:** `'Dissolve'`

### Parameter

```ts
interface DissolveParams {
  dissolveMode: 'beat-wipe' | 'directional-blur' | 'reveal-wipe'; // default: 'beat-wipe'
  direction: FXDirection;              // default: 'left'
  intensity: number;                   // 0..1, default: 0.8
  softness: number;                    // 0..1, default: 0.5
  decay: number;                       // 0..1, default: 0.6 (nur beat-wipe)
}
```

### Canvas-Implementierung — drei Modi (alle source-over, kein gCO-Wechsel)

Gemeinsamer Gradient-Helper (alle Modi):
```ts
const origin = directionToOrigin(params.direction, rc.width, rc.height);
const end = { x: rc.width - origin.x, y: rc.height - origin.y };
const clampedSoftness = Math.max(0.01, Math.min(0.99, params.softness));

function overlayGradient(alpha: number) {
  const grad = ctx.createLinearGradient(origin.x, origin.y, end.x, end.y);
  grad.addColorStop(0, `rgba(12,13,18,${alpha})`);
  grad.addColorStop(clampedSoftness, 'rgba(12,13,18,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, rc.width, rc.height);
}
```

**beat-wipe** — auf dem Beat kommt Schleier von der Richtung her,
klingt mit beatPhase ab:
```ts
const sweepAlpha = Math.max(0, 1 - rc.beatPhase * (1 + params.decay * 3))
                   * params.intensity;
overlayGradient(sweepAlpha);
```

**directional-blur** — permanenter Weichzeichner von der Richtung her,
kein Beat-Trigger. Simuliert mit 5 gestaffelten Overlay-Layers:
```ts
const layers = 5;
for (let i = 0; i < layers; i++) {
  const alpha = params.intensity * ((layers - i) / layers) * 0.18;
  overlayGradient(alpha);
}
```

**reveal-wipe** — Bild enthüllt sich einmalig über die Clip-Länge.
`t=0` = komplett verdeckt, `t=1` = komplett sichtbar:
```ts
const t = rc.clipDurationSec > 0
  ? Math.max(0, Math.min(1, (rc.time - rc.clipStartSec) / rc.clipDurationSec))
  : 1;
const coverAlpha = params.intensity * (1 - t);
overlayGradient(coverAlpha);
```

Tests: ≥ 5 (mode='beat-wipe' auf Beat, mode='beat-wipe' zwischen Beats,
mode='directional-blur' immer aktiv unabhängig von beatPhase,
mode='reveal-wipe' alpha=intensity bei t=0 und alpha=0 bei t=1,
softness edge-cases)

---

## Plugin 3 — Sunray FX (Task 5)

**Datei:** `lib/fx/sunray.ts` | **Kind:** `'Sunray'`

### Parameter

```ts
interface SunrayParams {
  direction: FXDirection;           // default: 'top'
  color: string;                    // default: '#fffbe6'
  intensity: StaticOrAuto<number>; // 0..1, default: 0.6
  rayCount: StaticOrAuto<number>;  // 3–16, default: 8
  spread: StaticOrAuto<number>;    // 0..1, default: 0.6
  decay: number;                   // 0..1, default: 0.65
}
```

### Canvas-Implementierung

```ts
const pulseAlpha = Math.max(0, 1 - rc.beatPhase * (1 + params.decay * 3))
                   * params.intensity;

const origin = directionToOrigin(params.direction, rc.width, rc.height);
const baseAngle = directionToAngle(params.direction);
const spreadAngle = params.spread * Math.PI;
const maxLength = Math.hypot(rc.width, rc.height);
const rayCount = Math.round(params.rayCount);

for (let i = 0; i < rayCount; i++) {
  const angle = baseAngle + (i / rayCount) * spreadAngle - spreadAngle / 2;
  const ex = origin.x + Math.cos(angle) * maxLength;
  const ey = origin.y + Math.sin(angle) * maxLength;
  const grad = ctx.createLinearGradient(origin.x, origin.y, ex, ey);
  grad.addColorStop(0, hexToRgba(params.color, pulseAlpha));
  grad.addColorStop(1, hexToRgba(params.color, 0));

  const halfSpread = 0.04;
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  ctx.lineTo(
    origin.x + Math.cos(angle - halfSpread) * maxLength,
    origin.y + Math.sin(angle - halfSpread) * maxLength
  );
  ctx.lineTo(
    origin.x + Math.cos(angle + halfSpread) * maxLength,
    origin.y + Math.sin(angle + halfSpread) * maxLength
  );
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
}
```

Tests: ≥ 4

---

## Plugin-Registrierung (Task 6)

`lib/fx/index.ts`: alle drei Plugins registrieren.
Alle bestehenden Tests müssen weiterhin grün sein.

---

## Color Utilities (Task 7 — falls neu)

`lib/utils/color.ts`:
```ts
export function hexToRgba(hex: string, alpha: number): string
export function darken(hex: string, factor: number): string
```

Tests: ≥ 3

---

## Inspector: 'text-input' Control + 'select' für Direction (Task 8)

Falls `'text-input'` und `'select'` als Inspector-Control-Typen
noch nicht existieren: in `components/Inspector/controls/` ergänzen.

**Kein Conditional Visibility in Plan 5.8a** — alle Params sind
sichtbar. Conditional kommt in Plan 5.8b.

---

## Verification Gate

Baseline: **453 Tests**. Ziel: **≥ 478 Tests**.

```powershell
npm test -- --run
# Erwartung: ≥ 478, 0 failing

npm run typecheck
npm run lint

npm run build
# Studio-Page First Load JS: ≤ 160 kB (Baseline 153 kB, Budget +5%)
```

---

## Smoke Gate

```
npm run dev
# Text FX: Text erscheint, bewegt sich, Gradient sichtbar,
#   3D-Extrusion plain + rock sichtbar, kein Flackern im Rock-Modus
# Dissolve FX: Schleier-Sweep von der gewählten Richtung auf dem Beat
# Sunray FX: Lichtstrahlen von der gewählten Richtung auf dem Beat
# Flow Mode: alle drei FX laufen smooth
# Export: alle drei FX im MP4 sichtbar
# Bestehende Projekte (v3): laden sauber, neue Tracks sind leer
```

---

## Commit-Struktur

```
feat(renderer): extend RenderContext with clipStartSec + clipDurationSec
feat(fx): FxKind/TrackKind extensions + RENDER_ORDER + store migration v4
feat(fx): FXDirection type + directionToOrigin/Angle helpers
feat(fx): Text FX plugin
feat(fx): Dissolve FX plugin (source-over, stateless beatPhase)
feat(fx): Sunray FX plugin
feat(utils): hexToRgba + darken color helpers
feat(inspector): text-input + select control types
feat(fx): register Text/Dissolve/Sunray in fx/index.ts
test: RC extension + direction helpers + Text/Dissolve/Sunray coverage
```

---

## Out of Scope (kommt in Plan 5.8b)

- Inspector Conditional Visibility (`visibleWhen`)
- Auto-Preset system_prompt Update für neue FX-Kinds
- Google Fonts (v0.2)

Abgabe: `2026-05-21-vibegrid-plan-5_8a-fx-plugins.md`
