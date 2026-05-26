# CC #1 Prompt — Schreibe Plan 5.8b: Inspector Conditional Visibility

## Kontext

Du arbeitest an **VibeGrid** (`C:\_Dev\VibeGrid`).

Baseline: aktueller HEAD post-5.10 (**675 Tests**, Store v6).

Plan-Nummer 5.8b ist bewusst — dieser Plan ist ein Backfill-Patch
für 5.8a (FX-Plugins). Er ist kein neuer Feature-Sprint.

Schreibe nur den **Plan** — noch keinen Code.

---

## Was Plan 5.8b leistet

**Inspector Conditional Visibility:** Params im Inspector können
ausgeblendet werden wenn eine Bedingung nicht erfüllt ist.

Beispiel: Die drei `extrusion*`-Params im Text FX erscheinen nur wenn
`enable3d === true`. `blinkDecay` erscheint nur wenn `blink === true`.

Feature 2 (Auto-Preset system_prompt Update) **entfällt** — das
Auto-Preset ist schema-driven (`lib/ai/anthropic.ts`) und funktioniert
für Text/Dissolve/Sunray bereits seit Plan 5.8a ohne Code-Änderung.

---

## Technische Umsetzung

### Type-Erweiterung

`visibleWhen` wird als optionales Feld zur bestehenden `ParamType`-Union
in `lib/renderer/types.ts` hinzugefügt. Die echte Struktur dort ist eine
diskriminierte Union mit `kind: 'slider' | 'color' | 'select' | 'toggle' | 'text'`.

Die Erweiterung erfolgt als Intersection — jeder Variant bekommt das
optionale Feld ohne die Discriminant-Struktur zu brechen:

```ts
// lib/renderer/types.ts — Prinzip (CC #1 passt auf echte Struktur an):
type ParamTypeBase = { visibleWhen?: (params: Record<string, unknown>) => boolean };
// Jeder Variant wird mit ParamTypeBase intersected
```

`visibleWhen` ist eine pure Funktion — kein Store-Zugriff, kein Side-Effect.

### Inspector-Filter

```ts
// components/Workspace/Inspector/index.tsx
// Vor dem Rendern jedes Params:
const isVisible = !def.visibleWhen || def.visibleWhen(clip.params);
if (!isVisible) return null;
```

Ausgeblendete Params werden nicht gerendert — kein Grau, kein Disabled.

### AutomationCurve-Interaktion

Wenn ein Param durch `visibleWhen` ausgeblendet ist:
- **AutomateButton**: ebenfalls ausblenden (kein ⚡-Button für unsichtbaren Param)
- **Curve-Daten im Store**: erhalten — kein Reset, kein Löschen
- **AutomationLane**: Curve bleibt in der Lane (Lane ist vom Inspector unabhängig)
- **Render**: Curve wird weiterhin aufgelöst — `resolveParam` kennt `visibleWhen` nicht

Wenn der User `enable3d` wieder auf `true` setzt: Param erscheint wieder,
AutomateButton erscheint wieder, Curve-Daten sind noch da.

### Anwendung in Text FX

CC #1 liest `lib/fx/text.ts` und trägt `visibleWhen` bei den korrekten
Param-Namen ein. Laut Code (lib/fx/text.ts:177-205) sind die 3D-bezogenen
Params `extrusionDirection`, `extrusionDepth`, `extrusionStyle` —
alle drei bekommen `visibleWhen: p => p.enable3d === true`.

`blinkDecay` bekommt `visibleWhen: p => p.blink === true`.

**Andere Plugins (Contour, Sweep, Particles, ZoomPulse, Dissolve, Sunray):**
CC #1 prüft beim Coderead ob sinnvolle `visibleWhen`-Candidates existieren
und dokumentiert die Entscheidung im Plan (entweder: "Param X bekommt
visibleWhen weil Y" oder "Keine Candidates gefunden").

---

## File Map

| Datei | Aktion |
|---|---|
| `lib/renderer/types.ts` | Modify — `visibleWhen` zu `ParamType` |
| `lib/fx/text.ts` | Modify — `visibleWhen` für extrusion*-Params + blinkDecay |
| `components/Workspace/Inspector/index.tsx` | Modify — `visibleWhen`-Filter + AutomateButton ausblenden |
| `docs/KNOWN_LIMITATIONS.md` | Modify — neuer Eintrag (siehe unten) |

Weitere Plugin-Files nur wenn CC #1 beim Coderead Candidates findet.

---

## KNOWN_LIMITATIONS Eintrag

```markdown
## Plan 5.8b — Inspector Conditional Visibility

- `visibleWhen` ist rein UI — versteckte Params behalten ihre Store-Werte.
  Wenn ein Param durch Toggle wieder sichtbar wird, sind vorherige Werte
  und Automation-Curves erhalten.
- Auto-Preset schlägt alle Schema-Keys vor, auch für aktuell versteckte
  Params. Nach einem Auto-Preset können Werte für versteckte Params
  vorbelegt sein — sie werden aktiv sobald der zugehörige Toggle aktiviert wird.
```

---

## Tests

**`tests/unit/fx/conditional-visibility.test.ts`** — ≥ 5:
- `visibleWhen` → true: Param sichtbar
- `visibleWhen` → false: Param ausgeblendet
- Kein `visibleWhen`: Param immer sichtbar
- Text FX: `extrusionDepth` ausgeblendet wenn `enable3d = false`
- Text FX: `blinkDecay` ausgeblendet wenn `blink = false`

**`tests/unit/components/Inspector/conditional-params.test.tsx`** — ≥ 4:
- Param gerendert wenn `visibleWhen` → true
- Param NICHT gerendert wenn `visibleWhen` → false
- AutomateButton NICHT gerendert wenn `visibleWhen` → false
- Roundtrip: `extrusionDepth = 16` setzen → `enable3d = false` → wieder true → Wert noch 16

Mindest: **≥ 9 neue Tests**

---

## Verification Gate

Baseline: **675 Tests** (post-5.10 HEAD).
Ziel: **≥ 684 Tests**, 0 failing.

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Pflicht: Manuelle Smoke-Tests:**
```
npm run dev
# Text FX selektieren → Inspector öffnen
# enable3d = false → extrusion*-Params verschwinden sofort, kein Jump
# enable3d = true → extrusion*-Params erscheinen wieder
# blink = false → blinkDecay verschwindet
# Wert in extrusionDepth setzen → enable3d toggle → Wert erhalten ✓
# AutomateButton: nur sichtbar wenn Param sichtbar
```

---

## Commit-Struktur

```
feat(types): visibleWhen optional field on ParamType
feat(inspector): filter params + AutomateButton by visibleWhen
feat(fx): visibleWhen on Text FX extrusion-params + blinkDecay
docs: KNOWN_LIMITATIONS — Plan 5.8b conditional visibility
test: conditional-visibility unit + Inspector roundtrip
```

---

## Out of Scope

- `disabledWhen` (Param sichtbar aber grayed-out): bewusste Entscheidung
  gegen v0.1 — `visibleWhen` reicht für alle aktuellen Use-Cases.
  Wenn AutomationCurve-Badge-Sichtbarkeit ein Problem wird: separater Plan.
- AutomationLane Conditional Visibility (v0.2)
- Param-Groups / Sections im Inspector (v0.2)
- Auto-Preset system_prompt: kein Update nötig (schema-driven, funktioniert bereits)

Abgabe: `2026-05-22-vibegrid-plan-5_8b-conditional-visibility.md`
