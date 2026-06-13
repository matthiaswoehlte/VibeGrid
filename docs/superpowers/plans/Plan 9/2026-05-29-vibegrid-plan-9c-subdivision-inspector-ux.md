# CC #1 Prompt — Plan 9c: Trigger-Subdivision + Inspector UX (Rev. 2)

**Drei Inspector-Verbesserungen in einem Plan:**
1. Trigger-Subdivision-Picker pro FX-Clip (`1×` bis `32×`)
2. Aktuellen Wert neben jedem numerischen Slider anzeigen
3. Beat-Sync via generisches `kind: 'toggle'`-Param-Rendering

Baseline: HEAD post-Plan-8.7b (Test-Zahl + Store-Version in Schritt 0
bestätigen — erwartet v6, wird durch diesen Plan auf v7 erhöht).

> Rev. 2 — alle 14 Architekt-Entscheidungen aus
> `2026-05-29-vibegrid-architekt-entscheidung-9c.md` eingearbeitet.
> A: Naming `1×–32×` + Object-Map. B: `kind: 'toggle'` + Store-
> Migration v6→v7. C: trigger × subdivision orthogonal mit
> Wirkungstabelle. Plus 11 Pflicht-Korrekturen.
>
> **Schritt-0-Ergebnis (User-Entscheidung Option B, 2026-05-29):**
> Auswahl-Kriterium konsequent angewendet, Original-Plan-Liste
> erweitert.
>
> **`supportsSubdivision: true` — 12 FX** (alle nutzen `rc.beatPhase`
> für envelope-shape):
> BeatFlash, ZoomPunch, ScreenShake, GlitchSlice, RGBSplit,
> ColorGradeShift, FilmGrainBurst, EdgeGlow, **Pulse** (hardcoded
> `*4`-decay), **ContourGL**, **LensFlareBurst**, **RetroVHS**
> (zusätzlich Shader-Uniform `u_beat_phase` muss `subdividedBeatPhase`
> empfangen).
>
> **`beatSync` schema `kind: 'slider' → kind: 'toggle'` — 11 FX**
> (alle obigen außer Pulse, der keinen `beatSync`-Param hat):
> BeatFlash, ZoomPunch, ScreenShake, GlitchSlice, RGBSplit,
> ColorGradeShift, FilmGrainBurst, EdgeGlow, ContourGL,
> LensFlareBurst, RetroVHS.
>
> **Regression-Tests:** 12 (eine pro Subdivision-FX), heruntergebrochen
> auf Subdivision-Skalierungstest pro FX.
>
> **Baseline-Test-Zahl bestätigt:** 1478 / 218 Test-Files.
> **Ziel:** ≥ 1478 + 20 Haupttest + 12 Regression = ≥ 1510.

---

## Schritt 0 — Codebase lesen (PFLICHT)

1. `lib/timeline/types.ts` — `Clip`-Shape, `TriggerMode`,
   `TrackFxKind`-Re-Export. `triggerSubdivision?` wird ein neues
   optionales Feld auf `Clip` (nicht auf einem nicht-existenten
   `FxClip`-Subtyp — VibeGrid hat eine einzige `Clip`-Interface,
   `kind` ist Diskriminator).

2. `lib/renderer/types.ts` — `RenderContext`-Shape vollständig.
   Bestätigen: `ParamType` enthält schon `{ kind: 'toggle'; default: boolean }`
   (Z. 9) und `ParamType.slider` hat schon `unit?: string` (Z. 6).
   **Keine** Schritt-0-Frage mehr ob diese existieren — beides
   architektonisch bestätigt.

3. `lib/renderer/loop.ts` — `beatPhase`-Berechnung
   (Z. ~280) + FX-Dispatch-Loop (Z. ~430). Wo wird `rc` konstruiert?
   Subdivision-Berechnung kommt dort hin.

4. `lib/automation/resolve.ts` — `resolveClipParams`-Signatur,
   um zu verstehen wie der Inspector zwischen statischem Wert und
   `AutomationCurve` unterscheidet (relevant für Wert-Anzeige).

5. `lib/store/index.ts` — Zustand-`persist`-Konfiguration mit
   `migrate`-Hook. **Hier lebt die v5→v6-Migration**, nicht in einer
   separaten `migrations.ts`. v6→v7 für `beatSync` reiht sich hier ein.
   Plus `lib/store/persist-shape.ts` für die Versions-Konstante.

6. `components/Workspace/Inspector/index.tsx` — Container-Komponente
   (nicht `Inspector.tsx`). Wo sind die Slider gerendert (inline oder
   geteilt)? Wie wird `AutomateButton` heute platziert? Wo kommt der
   Clip-Header?

7. `components/Workspace/Inspector/AutomateButton.tsx` — Layout-Pattern
   um den Slider, plus wie unterscheidet er statischen Wert von
   `AutomationCurve`?

8. **8 FX-Plugins als Subdivision-Kandidaten verifizieren** —
   die Liste nach Architekt-Kriterium *„FX die `rc.beatPhase` direkt
   für envelope-shape (`env = 1 - rc.beatPhase / decay` etc.) nutzen"*:

   - BeatFlash, ZoomPunch, ScreenShake, GlitchSlice, RGBSplit,
     ColorGradeShift, FilmGrainBurst, EdgeGlow — **erwartet ja**
   - **Pulse** (`lib/fx/pulse.ts`) — grep zeigt `rc.beatPhase`-Nutzung,
     verifizieren ob envelope-shape oder nur `isOnBeat`-gated
   - **ContourGL** (`lib/fx/contour-gl.ts`) — grep zeigt `rc.beatPhase`,
     verifizieren ob envelope oder nur sweep-animation
   - **VignetteBreathe, RetroVHS, LetterboxSqueeze** — explizit nein
     (persistente Effekte ohne discrete envelope), aber CC #1
     bestätigt mit Code-Check

   CC #1 dokumentiert die finale Liste im Plan-Header der
   Implementation.

9. Aktuelle Test-Zahl + Store-Version notieren:
   `npm test -- --run 2>&1 | grep -E "Tests|passed" | tail -3`

---

## Feature 1 — Trigger-Subdivision

### Neuer Typ (A)

```ts
// lib/timeline/types.ts MODIFY (nicht lib/types.ts — Architekt-B1)
export type TriggerSubdivision =
  | '1×' | '2×' | '4×' | '8×' | '16×' | '32×';

export const TRIGGER_SUBDIVISIONS: readonly TriggerSubdivision[] = [
  '1×', '2×', '4×', '8×', '16×', '32×'
] as const;

// Object-Map statt Array-Index — lesbarer, V8-Perf identisch (Architekt-A)
export const SUBDIVISION_MULTIPLIERS: Record<TriggerSubdivision, number> = {
  '1×': 1, '2×': 2, '4×': 4, '8×': 8, '16×': 16, '32×': 32
};
```

`1×` = 1 Trigger pro Beat (Standard).
`4×` = 4 Triggers pro Beat (= 16stel-Noten in 4/4-Time).
`32×` = 32 Triggers pro Beat (sehr feine Subdivision für Stutter-Effekte).

### Clip-Erweiterung

```ts
// lib/timeline/types.ts — Clip MODIFY:
export interface Clip {
  // ... bestehend ...
  triggerSubdivision?: TriggerSubdivision;  // Default: undefined = '1×'
}
```

`undefined` = identisches Verhalten wie heute (multiplier 1).
Nur FX-Clips mit `plugin.supportsSubdivision === true` zeigen den
Picker; alle anderen Clips ignorieren das Feld.

### FxPlugin-Interface

```ts
// lib/renderer/types.ts — FxPlugin MODIFY:
export interface FxPlugin<Params = Record<string, unknown>> {
  // ... bestehend ...
  readonly supportsSubdivision?: boolean;  // Default: false
}
```

### RenderContext-Erweiterung

```ts
// lib/renderer/types.ts — RenderContext MODIFY:
export interface RenderContext {
  // ... bestehend ...
  /** Subdivision-multiplizierte Phase: 0–1 innerhalb der Subdivision.
   *  Wenn FX-Plugin `supportsSubdivision === true` setzt, sollte er
   *  `subdividedBeatPhase` statt `beatPhase` für envelope-shape nutzen.
   *  Für Plugins ohne supportsSubdivision: gleicher Wert wie `beatPhase`. */
  subdividedBeatPhase: number;
  /** Aktive Subdivision aus `clip.triggerSubdivision ?? '1×'`. Nutzen
   *  Plugins selten direkt; primär für Tests + Debug-Tools. */
  subdivision: TriggerSubdivision;
}
```

### Berechnung in `lib/renderer/loop.ts`

```ts
// Architekt-W7: % 1 statt Bitwise-Trick — klarer Intent.
const subdivision = clip.triggerSubdivision ?? '1×';
const multiplier = SUBDIVISION_MULTIPLIERS[subdivision];
const subdividedBeatPhase = (phase.phase * multiplier) % 1;

const rc: RenderContext = {
  // ... bestehende Felder ...
  beatPhase: phase.phase,
  subdividedBeatPhase,           // NEU
  subdivision,                   // NEU
};
```

### FX-Plugins — `beatPhase` → `subdividedBeatPhase`

Pro qualifiziertem FX (siehe Schritt 0 Punkt 8): in `render()` jeden
Lese-Zugriff auf `rc.beatPhase` ersetzen durch `rc.subdividedBeatPhase`,
**und** `supportsSubdivision: true` auf dem Plugin-Objekt setzen.

Beispiel — `lib/fx/rgb-split.ts`:
```ts
export const rgbSplitPlugin: FxPlugin<RGBSplitParams> = {
  id: 'rgb-split',
  // ...
  supportsSubdivision: true,    // NEU
  render(rc, params) {
    // vorher: 1 - rc.beatPhase / params.decay
    // nachher:
    const synced = params.beatSync;  // nach B-Migration: boolean
    const env = synced
      ? Math.max(0, 1 - rc.subdividedBeatPhase / params.decay)
      : 1.0;
    // ...
  }
};
```

FX **ohne** `supportsSubdivision` nutzen weiterhin `rc.beatPhase` —
keine Breaking Changes.

### Wirkungstabelle: `trigger` × `triggerSubdivision` (Architekt-C)

Beide Dimensionen sind **orthogonal**. `trigger` armiert den FX
(steuert via Loop ob `render()` aufgerufen wird), `triggerSubdivision`
bestimmt die Geschwindigkeit der Phase innerhalb eines Beats.

| `trigger` | `triggerSubdivision` | Verhalten |
|---|---|---|
| `'beat'` | `'1×'` | Standard — 1 envelope pro Beat |
| `'beat'` | `'4×'` | 4 envelopes pro Beat (16stel) |
| `'bar'` | `'4×'` | FX armed nur auf Bar-Downbeat, dann 4 envelopes innerhalb des einen Beats |
| `'half-bar'` | `'2×'` | 2 envelopes pro Beat, nur in der ersten Half-Bar |
| `'two-bar'` | `'1×'` | 1 envelope pro Beat, nur jeden zweiten Bar-Downbeat |

`subdividedBeatPhase` basiert immer auf `rc.beatPhase` (0–1 pro Beat).
Kein Konflikt mit `trigger` — der wird im Loop für den Render-Gate
genutzt, nicht in der Phase-Berechnung.

### `flowMode`-Verhalten (Architekt-W8)

Subdivision ist **beat-mode-only**. FX mit `if (rc.flowMode) return`
(Standard für alle 8 Kandidaten) skippen unverändert —
`subdividedBeatPhase` ist im flowMode irrelevant, wird trotzdem
berechnet (für Test-Konsistenz) aber nie gelesen.

### SubdivisionPicker-Komponente (Architekt-W9)

```
// components/Workspace/Inspector/SubdivisionPicker.tsx (NEU)

┌── Inspector ───────────────┐
│  Clip-Header               │  ← bestehend
│  [Plugin-Name, Trigger]    │
│  ─────────────────────────│
│  Trigger Speed  ┌─────────┐│  ← NEU: Subdivision-Picker
│  [1×][2×][●4×][8×][16×][32×]│     hier eingefügt
│  ─────────────────────────│
│  Intensity  ████░░ 0.80   │  ← bestehende paramSchema-Slider
│  Decay      ███░░░ 0.30   │
│  ...                       │
└────────────────────────────┘
```

- Aktiver Button: `--a1` (`#a86bff`) Highlight
- Label links: *„Trigger Speed"* in `--text-dim`
- **Nur sichtbar wenn `plugin.supportsSubdivision === true`**
- Click setzt `clip.triggerSubdivision` sofort via `setClipParam`
  (Architekt-D16: kein coalesce — Button-Click, kein Drag)
- `'1×'`-Click und `undefined` sind semantisch identisch; Picker
  zeigt `'1×'` als aktiv wenn `clip.triggerSubdivision === undefined`

Inspector-Platzierung im Markup-Baum:
```
<Inspector>
  <ClipHeader />              ← bestehend
  {plugin.supportsSubdivision && (
    <SubdivisionPicker
      value={clip.triggerSubdivision ?? '1×'}
      onChange={(s) => setClipParam(clipId, 'triggerSubdivision', s)}
    />
  )}
  <ParamSchemaList />         ← bestehend, iteriert paramSchema
</Inspector>
```

---

## Feature 2 — Slider-Wert-Anzeige

Jeder Slider zeigt den aktuellen Wert rechts:

```
Intensity  ████████░░  0.80
Decay      ███░░░░░░░  0.30
Threshold  ██░░░░░░░░  0.10
Ray Count  █████░░░░░  8
```

### Layout-Integration mit AutomateButton

Aktuelles Slider-Layout (aus `components/Workspace/Inspector/index.tsx`
bzw. AutomateButton-Sibling, CC #1 sieht das in Schritt 0):

```
<row>
  <label />
  <slider />
  <AutomateButton />
</row>
```

Neues Layout:
```
<row>
  <label />
  <slider />
  <ValueDisplay />         ← NEU
  <AutomateButton />
</row>
```

`ValueDisplay` ist `w-10` fixed-width, rechts-aligned, `tabular-nums`
für stabiles Layout während Drag-Updates.

### Verhalten bei Automation-Kurve (Architekt-W10)

| Param-State | Anzeige |
|---|---|
| Statischer Wert (`number` direkt im params) | formatierter Wert (`0.80`) |
| `AutomationCurve` aktiv | *„auto"* in `--text-muted` |

CC #1 nutzt `isAutomationCurve()` aus `lib/automation/resolve.ts`:
```tsx
import { isAutomationCurve } from '@/lib/automation/resolve';

function ValueDisplay({ rawValue, schema }) {
  if (isAutomationCurve(rawValue)) {
    return <span className="text-xs text-[--text-muted] w-10 text-right">auto</span>;
  }
  return <span className="text-xs text-[--text-dim] w-10 text-right tabular-nums">
    {formatParamValue(rawValue as number, schema)}
  </span>;
}
```

### Formatierung

```ts
// lib/fx/format-param-value.ts (NEU)
import type { ParamSchema } from '@/lib/renderer/types';

type SliderSchema = Extract<ParamSchema[string], { kind: 'slider' }>;

export function formatParamValue(value: number, schema: SliderSchema): string {
  if (schema.unit) return `${value.toFixed(1)} ${schema.unit}`;
  if (schema.step >= 1) return `${Math.round(value)}`;
  if (Math.abs(value) < 0.01) return value.toFixed(3);
  if (Math.abs(value) < 1) return value.toFixed(2);
  return value.toFixed(1);
}
```

`schema.unit` ist bereits in `ParamType.slider` als `unit?: string`
deklariert (`lib/renderer/types.ts:6`, Architekt-W5 bestätigt).
Heute nutzt es noch kein FX, aber `decay`-Felder mit `unit: 'beats'`
sind ein klarer Folge-Use-Case.

---

## Feature 3 — Generisches `kind: 'toggle'` für Beat Sync (Architekt-B)

### Schema-Migration

```ts
// Beispiel rgb-split.ts paramSchema MODIFY:
beatSync: { kind: 'toggle', default: true, label: 'Beat Sync' }
// vorher: { kind: 'slider', min: 0, max: 1, step: 1, default: 1, label: 'Beat Sync' }
```

Betrifft alle 8 FX die heute `beatSync` führen (post-Plan-8g): RGBSplit,
GlitchSlice, FilmGrainBurst plus die Plan-8.x-Erweiterungen die später
hinzukamen (CC #1 verifiziert die volle Liste via grep in Schritt 0).

### Render-Anpassung

```ts
// Alle 8 FX render()-Bodies MODIFY:
const synced = params.beatSync;       // boolean nach Migration
// vorher: const synced = params.beatSync >= 0.5;
```

### `ToggleParam`-Komponente (generisch, **kein** FX-spezifisches BeatSyncToggle)

```tsx
// components/Workspace/Inspector/ToggleParam.tsx (NEU)

interface ToggleParamProps {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

export function ToggleParam({ label, value, onChange }: ToggleParamProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[--text-dim] flex-1">{label}</span>
      <div className="flex rounded overflow-hidden border border-[--border]">
        <button
          onPointerDown={() => onChange(false)}
          className={`px-3 py-1 text-xs ${
            !value ? 'bg-[--a1] text-white' : 'bg-[--surface-2] text-[--text-dim]'
          }`}
        >Off</button>
        <button
          onPointerDown={() => onChange(true)}
          className={`px-3 py-1 text-xs ${
            value ? 'bg-[--a1] text-white' : 'bg-[--surface-2] text-[--text-dim]'
          }`}
        >On</button>
      </div>
    </div>
  );
}
```

- `onPointerDown` (CLAUDE.md Regel 3), keine Mouse-Events
- Generisch über `kind: 'toggle'` — nutzbar für künftige Toggle-Params
  (mute, locked, visible etc.) ohne neue Komponente
- Inspector-Dispatch: in der paramSchema-Iteration ein neuer Case
  `case 'toggle': return <ToggleParam ... />;`

---

## Store-Migration v6 → v7 (Architekt-B, D15)

`beatSync` ändert sich von `number` (0/1) auf `boolean`. Bestandsdaten
in `localStorage` müssen konvertiert werden.

### Wo die Migration lebt

`lib/store/index.ts` — Zustand-Persist-`migrate`-Hook. Bestehende
v5→v6-Migration (siehe Plan-5.9c-Kommentar in `lib/timeline/types.ts:38-44`)
ist das Vorbild. Plus `lib/store/persist-shape.ts` für die `VERSION`-Konstante
von 6 → 7 erhöhen.

### Migration-Logik

```ts
// lib/store/index.ts (innerhalb des migrate-Hooks)
import { TRACK_FX_KINDS } from '@/lib/timeline/plugin-mapping';

const FX_KIND_SET = new Set<string>(TRACK_FX_KINDS);

function migrateV6toV7(state: any): any {
  return {
    ...state,
    version: 7,
    timeline: {
      ...state.timeline,
      clips: state.timeline.clips.map((clip: any) => {
        // Diskriminator: clip.kind ist ein FX-Kind (lowercase, in TRACK_FX_KINDS)
        if (!FX_KIND_SET.has(clip.kind)) return clip;
        if (!clip.params || clip.params.beatSync === undefined) return clip;

        // number → boolean
        const rawBeatSync = clip.params.beatSync;
        const newBeatSync = typeof rawBeatSync === 'boolean'
          ? rawBeatSync
          : Number(rawBeatSync) >= 0.5;

        return {
          ...clip,
          params: { ...clip.params, beatSync: newBeatSync }
        };
      })
    }
  };
}
```

**Wichtig:** Architekt-Snippet (Z. 56-72 in `2026-05-29-vibegrid-architekt-entscheidung-9c.md`)
hatte zwei Bugs die hier korrigiert sind:
- (a) `clip.type === 'fx'` ist falsch — VibeGrid hat `kind`, kein `type`,
  und kein `'fx'`-Literal auf clip-level (das ist track-level). FX-Clips
  haben `kind ∈ TRACK_FX_KINDS`.
- (b) Architekt zeigte `state.tracks.map(t => ({...t, clips: ...}))` —
  die echte Shape ist `state.timeline.clips` als flacher Array,
  nicht pro-Track verschachtelt.

### `setClipParam` für Subdivision

Subdivision-Picker triggert `setClipParam(clipId, 'triggerSubdivision', value)`.
`setClipParam` ist Plan-10-`recordingSet` mit `coalesce` für Slider-Drags.
Architekt-D16: für Button-Clicks **kein coalesce nötig** — der Picker
kann den default-Coalesce-Pfad nutzen (Button-Click ist nicht „rapid",
default-coalesce hat ohnehin keinen Effekt).

---

## Undo-Behaviour

| Action | Behandlung |
|---|---|
| Subdivision-Picker-Click | `setClipParam` → `record` (default, kein coalesce-Effekt) |
| Beat-Sync-Toggle On/Off | `setClipParam` → `record` |
| Slider-Drag | bestehend (`coalesce`-flag innerhalb derselben Drag-Session) |
| Slider-Wert-Anzeige | rein UI, kein Store |

---

## Dateien

| Datei | Aktion |
|---|---|
| `lib/timeline/types.ts` | MODIFY — `TriggerSubdivision`, `TRIGGER_SUBDIVISIONS`, `SUBDIVISION_MULTIPLIERS`, `Clip.triggerSubdivision?` |
| `lib/renderer/types.ts` | MODIFY — `FxPlugin.supportsSubdivision?`, `RenderContext.subdividedBeatPhase`, `RenderContext.subdivision` |
| `lib/renderer/loop.ts` | MODIFY — subdivision-Berechnung im `rc`-Konstruktor |
| `lib/store/index.ts` | MODIFY — `migrateV6toV7` in Persist-Migrate-Hook |
| `lib/store/persist-shape.ts` | MODIFY — `VERSION` 6 → 7 |
| `lib/fx/format-param-value.ts` | CREATE — `formatParamValue` |
| `components/Workspace/Inspector/SubdivisionPicker.tsx` | CREATE |
| `components/Workspace/Inspector/ToggleParam.tsx` | CREATE — generisch für `kind: 'toggle'` |
| `components/Workspace/Inspector/index.tsx` | MODIFY — alle drei Features einbinden (Picker, ValueDisplay, ToggleParam-Dispatch) |
| Qualifizierte FX-Plugins (Schritt 0 Punkt 8 bestätigte Liste) | MODIFY — `supportsSubdivision: true`, `rc.beatPhase` → `rc.subdividedBeatPhase`, `beatSync >= 0.5` → `beatSync` (truthy), schema `kind: 'slider'` → `kind: 'toggle'` |

---

## Tests (Architekt-Erhöhung +14 → +20)

```
tests/unit/timeline/trigger-subdivision.test.ts          (NEU)
tests/unit/renderer/subdivided-beat-phase.test.ts        (NEU)
tests/unit/store/migrate-v6-to-v7.test.ts                (NEU)
tests/unit/inspector/subdivision-picker.test.tsx         (NEU)
tests/unit/inspector/toggle-param.test.tsx               (NEU)
tests/unit/fx/format-param-value.test.ts                 (NEU)
tests/unit/fx/[per qualifiziertem FX] subdivision.test.ts (REGRESSION pro FX)
```

**Type/Renderer/Migration:**
1. `SUBDIVISION_MULTIPLIERS`: `'1×'→1, '2×'→2, '4×'→4, '8×'→8, '16×'→16, '32×'→32`
2. `subdividedBeatPhase` bei `beatPhase=0.0`, `subdivision='4×'` → `0.0`
3. `subdividedBeatPhase` bei `beatPhase=0.125`, `subdivision='4×'` → `0.5`
4. `subdividedBeatPhase` bei `beatPhase=0.25`, `subdivision='4×'` → `0.0`
5. `subdividedBeatPhase` bei `beatPhase=0.9999`, `subdivision='32×'` → ~0.997
6. `triggerSubdivision=undefined` → multiplier 1, `subdividedBeatPhase === beatPhase`
7. flowMode-Skip: `subdividedBeatPhase` wird berechnet aber FX rendert nicht (Mock-Check)
8. v6→v7-Migration: `params.beatSync = 1` (number) → `true` (boolean)
9. v6→v7-Migration: `params.beatSync = 0` (number) → `false` (boolean)
10. v6→v7-Migration: bereits boolean `params.beatSync = true` → unverändert
11. v6→v7-Migration: clip ohne `params.beatSync` bleibt unverändert
12. v6→v7-Migration: non-FX-clip (z.B. `kind: 'audio'`) bleibt unverändert

**Inspector-UI:**
13. `SubdivisionPicker`: nur sichtbar wenn `plugin.supportsSubdivision === true`
14. `SubdivisionPicker`: aktiver Button matched `clip.triggerSubdivision ?? '1×'`
15. `SubdivisionPicker`: Click setzt `setClipParam` mit korrektem Wert
16. `ToggleParam`: Off-Click → `onChange(false)`, On-Click → `onChange(true)`
17. `ToggleParam`: aktiver Button reflektiert Boolean-Value
18. `ValueDisplay`: statischer Wert → formatierter String
19. `ValueDisplay`: `AutomationCurve` → *„auto"*
20. `formatParamValue`: `unit` (z.B. `'beats'`), `step >= 1` (integer), kleine
    Werte (`<0.01`), Default — vier Format-Pfade

**Regression pro qualifiziertem FX** (eine je, gegen die finale Liste
aus Schritt 0 Punkt 8):
- FX X mit `subdivision='4×'`, `beatPhase=0.125`, `decay=0.5` →
  `env = 1 - 0.5/0.5 = 0` (subdividedBeatPhase=0.5) — kein Draw-Call
- FX X mit `subdivision='1×'`, `beatPhase=0` → identisches Verhalten
  zur post-8.7b-Baseline

Mindest: **+20 neue Tests** + ~8 Regression (eine pro qualifiziertem FX).

---

## Commits

```
feat(timeline): TriggerSubdivision type + Clip.triggerSubdivision field
feat(renderer): subdividedBeatPhase + subdivision in RenderContext + loop
feat(store): migrate v6→v7 — beatSync number→boolean
feat(types): FxPlugin.supportsSubdivision flag + ParamSchema toggle uses
feat(fx): supportsSubdivision + subdividedBeatPhase on qualified FX
feat(fx): beatSync schema kind:'slider' → kind:'toggle' across qualified FX
feat(inspector): SubdivisionPicker component
feat(inspector): ToggleParam generic component (replaces magic-string beatSync)
feat(inspector): formatParamValue + ValueDisplay (with "auto" for curves)
feat(inspector): wire all three features into Inspector container
test(9c): subdivision types + renderer + migration + inspector + format + regressions
```

11 Commits.

---

## Nicht im Scope

- Subdivision für Automation-Kurven (eigener Folge-Plan — Subdivision
  würde die `AutomationCurve`-beat-Achse skalieren, andere Komplexität)
- Per-FX-Kategorie-Default für `triggerSubdivision` (heute überall
  `1×` Default; künftig könnten z.B. GlitchSlice `4×` als Default haben)
- Slider-Wert manuell als Zahl eingeben (nur Drag heute, künftig
  Click-to-Edit auf der Value-Display)
- Toggle-Param-Animation/Transition (instant heute)

---

## Architekt-Checkliste — Status

- [x] A: Naming `'1×'–'32×'` + Object-Map
- [x] B: `kind: 'toggle'` + Store-Migration v6→v7 + generisches `ToggleParam.tsx`
- [x] C: Trigger × Subdivision orthogonal + Wirkungstabelle + flowMode-Note
- [x] B1-Pfad: `lib/timeline/types.ts` (nicht `lib/types.ts`)
- [x] W5: `unit?: string` als bereits-existent dokumentiert
- [x] W6: Performance-Claim gestrichen, Object-Map als „lesbarer, V8-Perf identisch" begründet
- [x] W7: `% 1` statt Bitwise-Floor
- [x] W8: flowMode-Aussage explizit
- [x] W9: Inspector-Platzierungs-Skizze (Markup-Baum)
- [x] W10: *„auto"* bei `AutomationCurve`, `isAutomationCurve()`-Check
- [x] W13: Auswahl-Kriterium „rc.beatPhase für envelope-shape", Pulse + ContourGL in Schritt 0 Punkt 8 zu prüfen
- [x] D14: `Inspector/index.tsx` statt `Inspector.tsx`
- [x] D15: v6→v7-Migration im Plan-Body, korrigierte Snippet-Bugs (`kind` statt `type`, flacher `clips`-Array)
- [x] D16: sofortiger `setClipParam`-Call ohne coalesce — Button-Click, kein Drag

---

Rev. 2 — alle 14 Architekt-Entscheidungen eingearbeitet. Bereit für
CC #1 Implementation.
