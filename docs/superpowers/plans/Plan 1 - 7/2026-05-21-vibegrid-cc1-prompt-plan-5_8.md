# CC #1 Prompt — Schreibe Plan 5.8: Text FX + Dissolve FX + Sunray FX

## Kontext

Du arbeitest an **VibeGrid** (`C:\_Dev\VibeGrid`).

Plan 6-R (Offline Render Pipeline) ist abgeschlossen und freigegeben.
Baseline: aktueller HEAD nach Plan 6-R, alle Gates grün.

Schreibe nur den **Plan** — noch keinen Code.

---

## Was Plan 5.8 leisten soll

**Name:** Text FX + Dissolve FX + Sunray FX

Drei neue FX-Plugins. Alle drei folgen dem bestehenden Plugin-Pattern
(`lib/fx/`, registriert in `lib/fx/index.ts`, Inspector-Params automatisch).

---

## Gemeinsamer Typ: `FXDirection`

Alle richtungsbasierten Parameter nutzen diesen Union-Typ, der einmal
in `lib/fx/types.ts` (oder `lib/fx/direction.ts`) definiert wird:

```ts
export type FXDirection =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center';
```

Helper-Funktion `directionToOrigin(dir: FXDirection, w: number, h: number):
{ x: number; y: number }` — pure Funktion, eigene Datei, eigene Tests.

---

## Plugin 1 — Text FX

**Datei:** `lib/fx/text.ts`
**Kind:** `'Text'`

### Parameter

```ts
interface TextParams {
  text: string;               // Der angezeigte Text — Typ: 'text', default: 'VibeGrid'
  fontSize: number;           // 8–200 px, default: 48
  fontFamily: string;         // select aus Preset-Liste (s.u.), default: 'Inter'
  colorFrom: string;          // Hex-Farbe, Start des Gradienten, default: '#ffffff'
  colorTo: string;            // Hex-Farbe, Ende des Gradienten, default: '#a86bff' (--a1)
  gradientOrientation:        // Richtung des Farbverlaufs
    | 'top-to-bottom'
    | 'left-to-right'
    | 'top-left-to-bottom-right'
    | 'center-to-outside';    // default: 'left-to-right'
  startX: number;             // 0..1 (normalisiert auf Canvas-Breite), default: 0.1
  startY: number;             // 0..1 (normalisiert auf Canvas-Höhe), default: 0.5
  endX: number;               // 0..1, default: 0.9
  endY: number;               // 0..1, default: 0.5
  blink: boolean;             // Beat-Blink aktiv, default: false
  blinkDecay: number;         // 0..1, Abklinggeschwindigkeit des Blinks, default: 0.7
}
```

**Font-Preset-Liste** (CC #1 kann erweitern):
`'Inter' | 'Georgia' | 'Impact' | 'Courier New' | 'Arial' | 'Playfair Display'`

### Canvas-Implementierung

- Position: Text bewegt sich von `(startX * w, startY * h)` zu
  `(endX * w, endY * h)` über die Clip-Länge (linear interpoliert
  via `resolveParam` falls automatable, sonst direkt via `timeSec /
  clip.durationSec`)
- Gradient: `ctx.createLinearGradient(...)` oder `ctx.createRadialGradient(...)`
  je nach `gradientOrientation`. Für `'center-to-outside'` radial,
  sonst linear
- `ctx.font = \`bold ${fontSize}px ${fontFamily}\``
- `ctx.textAlign = 'center'`, `ctx.textBaseline = 'middle'`
- `ctx.fillStyle = gradient`
- Blink: Beat-getriggert, `ctx.globalAlpha *= (blink ? blinkAlpha : 1)`.
  `blinkAlpha` decays nach dem Beat analog zu Pulse FX

### 3D-Extrusion Parameter

```ts
  // 3D-Erweiterung — nur relevant wenn enable3d === true
  enable3d: boolean;          // default: false
  extrusionDirection:         // Richtung der Z-Achse (welche Seite "rauskommt")
    | 'top-right'
    | 'top-left'
    | 'bottom-right'
    | 'bottom-left';          // default: 'bottom-right'
  extrusionDepth: number;     // 2–30 px, Tiefe der Extrusion, default: 8
  extrusionStyle:
    | 'plain'                 // Glatter gleichmäßiger Sockel
    | 'rock';                 // Felsartiger unregelmäßiger Sockel
```

**Canvas-Implementierung 3D:**

Beide Stile basieren auf Layer-Stacking: Text wird `extrusionDepth`-mal
hintereinander gezeichnet, jede Iteration um 1px in `extrusionDirection`
versetzt, von dunkel (hintere Layer) nach hell (vordere Layer).

**Plain:**
```ts
for (let i = extrusionDepth; i > 0; i--) {
  const dx = i * dirX;  // dirX/dirY aus extrusionDirection (+1/-1)
  const dy = i * dirY;
  ctx.fillStyle = darken(colorFrom, i / extrusionDepth * 0.6);
  ctx.fillText(text, x + dx, y + dy);
}
// Dann den Haupttext (i=0) on top
```

**Rock:**
Wie Plain, aber jede Layer bekommt einen kleinen zufälligen Jitter
(`Math.random() * 1.5 - 0.75`) auf dx/dy — erzeugt unregelmäßige,
felsartige Kanten. Kein Seed nötig (Unterschied zwischen Renders
nicht wahrnehmbar, Matthias-Entscheidung).

`darken(hex, factor)` → pure Helper in `lib/utils/color.ts` neben
`hexToRgba`.

### Automatable Parameter

`fontSize`, `startX`, `startY`, `endX`, `endY`, `extrusionDepth`
sollen `StaticOrAuto<number>` sein. `text`, `fontFamily`,
`gradientOrientation`, `blink`, `enable3d`, `extrusionDirection`,
`extrusionStyle` bleiben static.

---

## Plugin 2 — Dissolve FX

**Datei:** `lib/fx/dissolve.ts`
**Kind:** `'Dissolve'`

Effekt: Das Bild wird von einer Richtung her "eingeblendet" — als ob
ein Schleier von dieser Seite her aufgehoben wird. Beat-getriggert:
auf dem Beat beginnt der Dissolve-Sweep, dann klingt er ab.

### Parameter

```ts
interface DissolveParams {
  direction: FXDirection;     // default: 'left'
  intensity: number;          // 0..1, Deckkraft des Sweeps, default: 0.8
  softness: number;           // 0..1, Weichheit der Kante, default: 0.5
  decay: number;              // 0..1, Abklinggeschwindigkeit, default: 0.6
}
```

### Canvas-Implementierung

Beat-getriggert (wie Pulse): auf dem Beat wird ein `sweepProgress`-Wert
auf 1 gesetzt, der dann mit `decay` pro Frame abklingt (1 → 0).

Der Sweep: Ein `ctx.createLinearGradient` von der Richtungs-Seite her
(via `directionToOrigin`). Der Gradient geht von
`rgba(0,0,0, intensity * sweepProgress)` → `rgba(0,0,0, 0)`. Auf dem
Canvas mit `ctx.globalCompositeOperation = 'destination-out'` aufgetragen
— dadurch "frisst" der Gradient die darunterliegenden Pixel weg.

**Wichtig:** `ctx.save()` vor und `ctx.restore()` nach der Composite-
Operation — sonst beeinflusst die gCO den Rest des Renders.

In Flow Mode: `sweepProgress` kontinuierlich interpoliert (0→1→0 über
die Clip-Länge), kein Beat-Trigger.

### Automatable Parameter

`intensity`, `softness`, `decay` — alle `StaticOrAuto<number>`.

---

## Plugin 3 — Sunray FX

**Datei:** `lib/fx/sunray.ts`
**Kind:** `'Sunray'`

Effekt: Lichtstrahlen die von einem Punkt (bestimmt durch `direction`)
radial nach außen strahlen. Beat-getriggert: Strahlen blitzen auf dem
Beat auf und klingen ab.

### Parameter

```ts
interface SunrayParams {
  direction: FXDirection;     // default: 'top'
  color: string;              // Hex-Farbe, default: '#fffbe6' (warmes Weiß/Gelb)
  intensity: number;          // 0..1, default: 0.6
  rayCount: number;           // 3..16, default: 8
  spread: number;             // 0..1, Öffnungswinkel der Strahlen, default: 0.6
  decay: number;              // 0..1, default: 0.65
}
```

### Canvas-Implementierung

Ursprungspunkt: `directionToOrigin(direction, w, h)` — z.B. `'top'` →
`{ x: w/2, y: 0 }`, `'top-left'` → `{ x: 0, y: 0 }`, `'center'` →
`{ x: w/2, y: h/2 }`.

Strahlen-Zeichnung:
```ts
for (let i = 0; i < rayCount; i++) {
  const angle = baseAngle + (i / rayCount) * spreadAngle - spreadAngle / 2;
  const gradient = ctx.createLinearGradient(
    origin.x, origin.y,
    origin.x + Math.cos(angle) * maxLength,
    origin.y + Math.sin(angle) * maxLength
  );
  gradient.addColorStop(0, hexToRgba(color, intensity * pulseAlpha));
  gradient.addColorStop(1, hexToRgba(color, 0));
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  // Dreieck für Strahlbreite
  const halfWidth = maxLength * 0.04;
  ctx.lineTo(
    origin.x + Math.cos(angle - 0.05) * maxLength,
    origin.y + Math.sin(angle - 0.05) * maxLength
  );
  ctx.lineTo(
    origin.x + Math.cos(angle + 0.05) * maxLength,
    origin.y + Math.sin(angle + 0.05) * maxLength
  );
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
}
```

`baseAngle`: aus `directionToAngle(direction)` — `'top'` → `-π/2`,
`'right'` → `0`, `'bottom'` → `π/2`, etc. Diagonalen entsprechend.

Beat-Trigger analog zu Pulse: `pulseAlpha` wird auf 1 gesetzt und
klingt mit `decay` ab. In Flow Mode: kontinuierliche Sinuswelle.

### Automatable Parameter

`intensity`, `rayCount`, `spread`, `decay` — alle `StaticOrAuto<number>`.

---

## Inspector-Integration

Alle drei Plugins brauchen spezifische Inspector-Controls:

**Text FX:**
- `text` → neuer Control-Typ `'text-input'` (einzeiliges Textfeld)
- `fontFamily` → `'select'` Control mit den Preset-Optionen
- `gradientOrientation` → `'select'` Control
- `colorFrom`, `colorTo` → `'color'` Control (existiert bereits)
- `startX/Y`, `endX/Y` → `'slider'` (0..1)
- `blink` → `'toggle'`
- `blinkDecay` → `'slider'` (nur sichtbar wenn `blink === true`)
- `enable3d` → `'toggle'`
- `extrusionDirection` → `'select'` (nur sichtbar wenn `enable3d === true`)
- `extrusionDepth` → `'slider'` 2–30 (nur sichtbar wenn `enable3d === true`)
- `extrusionStyle` → `'select'` Labels "Glatt (Plain)" / "Fels (Rock)"
  (nur sichtbar wenn `enable3d === true`)

Falls `'text-input'` als Inspector-Control-Typ noch nicht existiert:
in `components/Inspector/controls/` hinzufügen. Analoges Pattern wie
der existierende `'color'`-Control.

**Dissolve FX + Sunray FX:**
- `direction` → `'select'` Control mit allen 9 FXDirection-Werten
  (Labels: "Oben", "Unten", "Links", "Rechts", "Oben-Links", etc.)
- Alle numerischen Params → `'slider'`

---

## File Map

| Datei | Aktion |
|---|---|
| `lib/fx/direction.ts` | Create — `FXDirection` Union + `directionToOrigin()` + `directionToAngle()` |
| `tests/unit/fx/direction.test.ts` | Create — ≥ 5 Tests für Origin- und Angle-Berechnung |
| `lib/fx/text.ts` | Create — Text FX Plugin |
| `tests/unit/fx/text.test.ts` | Create — ≥ 5 Tests |
| `lib/fx/dissolve.ts` | Create — Dissolve FX Plugin |
| `tests/unit/fx/dissolve.test.ts` | Create — ≥ 4 Tests |
| `lib/fx/sunray.ts` | Create — Sunray FX Plugin |
| `tests/unit/fx/sunray.test.ts` | Create — ≥ 4 Tests |
| `lib/fx/index.ts` | Modify — alle 3 Plugins registrieren |
| `components/Inspector/controls/TextInputControl.tsx` | Create (falls nicht vorhanden) |
| `KNOWN_LIMITATIONS.md` | Modify — neue FX dokumentieren |

---

## Technische Hinweise

### `hexToRgba` Helper

Falls noch nicht vorhanden: pure Funktionen in `lib/utils/color.ts`:
```ts
export function hexToRgba(hex: string, alpha: number): string
export function darken(hex: string, factor: number): string  // für 3D-Extrusion
```

Wird von Sunray FX benötigt. Mit Tests.

### `globalCompositeOperation` in Dissolve

Der `'destination-out'`-Modus in Dissolve muss zwingend mit
`ctx.save()` / `ctx.restore()` eingeklammert werden. Ohne das würden
alle nachfolgenden FX auf demselben Frame unsichtbar werden.

### SSR-Safety

Alle drei Plugins greifen nur auf `CanvasRenderingContext2D` zu —
kein `window`, kein `document`. SSR-safe by default.

### `'text-input'` Control Typ

Der bestehende Inspector-Control-Typ-Union muss um `'text-input'`
erweitert werden. Prüfe `components/Inspector/types.ts` oder äquivalent.
Einzeiliges `<input type="text">` mit denselben Design-Tokens wie
die Slider-Controls.

---

## Verification Gate Zielwert

Baseline: aktueller HEAD (nach Plan 6-R, ca. 445 Tests).
Plan 5.8 soll mindestens **≥ 470 Tests** erreichen.

```
npm test -- fx/direction        # ≥ 5
npm test -- fx/text             # ≥ 5
npm test -- fx/dissolve         # ≥ 4
npm test -- fx/sunray           # ≥ 4
npm test -- utils/color         # ≥ 2 (falls hexToRgba neu)
npm test                        # full suite ≥ 470
npm run typecheck
npm run lint
npm run build
```

**Smoke Gate:**
```
npm run dev
# Text FX auf Timeline, Inspector öffnen:
#   - Text editieren → live im Canvas sichtbar
#   - Gradient-Farben ändern → sofort sichtbar
#   - Start/End Position animiert während Playback
#   - Blink auf Beat aktiv
# Dissolve FX: auf Beat beginnt Sweep von der gewählten Richtung
# Sunray FX: Strahlen blitzen auf dem Beat von der gewählten Richtung
# Flow Mode ON: alle drei FX laufen smooth, kein Beat-Flash
# Export: alle drei FX sind im exportierten MP4 sichtbar
```

---

## Commit-Struktur

```
feat(fx): FXDirection type + directionToOrigin/Angle helpers
feat(fx): Text FX plugin — gradient text, animated position, blink
feat(fx): Dissolve FX plugin — directional image sweep on beat
feat(fx): Sunray FX plugin — directional light rays on beat
feat(inspector): text-input control type for Text FX
feat(fx): register Text, Dissolve, Sunray in fx/index.ts
test: direction helpers + Text/Dissolve/Sunray FX coverage
```

---

## Abgabe

Dateiname: `2026-05-21-vibegrid-plan-5_8-text-dissolve-sunray.md`
