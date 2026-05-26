# VibeGrid Plan 5.8b — Inspector Conditional Visibility

> **For agentic workers:** Plan execution policy (overrides skill defaults):
> direct-on-main, sequential, one commit per task. NO subagent ceremony.
> Backfill-Patch zu Plan 5.8a — kein neuer Feature-Sprint.

---

## Context

Baseline: post-Plan-5.10 HEAD (`340c05f`+). **675 Tests**, Store v6, typecheck/lint/build clean. Plan 5.10 (Responsive Mobile Layout) + die zwei nachgelagerten Hotfixes (Workspace asides hide on Mobile, DPR double-scale fix) sind alle gemerged und gepusht.

Plan 5.8a hatte drei neue FX-Plugins eingeführt (Text, Dissolve, Sunray). Im Text FX existieren zwei Param-Cluster die nur bedingt relevant sind (`extrusion*` wenn `enable3d`, `blinkDecay` wenn `blink`), aber der Inspector zeigt sie immer — verwirrend für User. Plan 5.8b liefert die generische Lösung dafür.

---

## Goal

`visibleWhen` als optionales Schema-Feld einführen. Der Inspector blendet Params (und ihren `AutomateButton`) komplett aus wenn die Bedingung nicht erfüllt ist. Param-Werte und Automation-Curves bleiben im Store erhalten — bei Toggle zurück erscheint alles unverändert.

## Out of Scope

- `disabledWhen` (Param sichtbar aber grayed-out) — bewusste Entscheidung gegen v0.1, `visibleWhen` reicht.
- AutomationLane Conditional Visibility — separates Concern, v0.2.
- Auto-Preset system_prompt Update — entfällt, das Prompt ist schema-driven (`lib/ai/anthropic.ts:50`) und funktioniert für alle registrierten FX-Kinds automatisch.

---

## Architecture insights

### 1. Wo `visibleWhen` im Type-System hin gehört

`lib/renderer/types.ts:5-12` definiert:

```ts
export type ParamType =
  | { kind: 'slider'; min: number; max: number; step: number; default: number; unit?: string }
  | { kind: 'color'; default: string; palette?: string[] }
  | { kind: 'select'; options: { value: string; label: string }[]; default: string }
  | { kind: 'toggle'; default: boolean }
  | { kind: 'text'; default: string; maxLength?: number };

export type ParamSchema = Record<string, ParamType & { label: string }>;
```

`label` wohnt bereits als Intersection am Record-Value, nicht in der `ParamType`-Union selbst. `visibleWhen` folgt diesem Pattern:

```ts
export type ParamSchema = Record<string, ParamType & {
  label: string;
  visibleWhen?: (params: Record<string, unknown>) => boolean;
}>;
```

Vorteile: minimal-invasive Type-Erweiterung, kein Touch an der diskriminierten Union, sichtbar nur wo Schemas konsumiert werden (Inspector, optional AutoPreset-Wrapper).

### 2. Inspector-Filter ist ONE return null

`components/Workspace/Inspector/index.tsx:55-86` rendert pro Param ein `<label>`-Block, der den `AutomateButton` und das eigentliche Input enthält. Ein einzelnes `return null` für den Map-Callback blendet Param + Button + Label gleichzeitig aus — keine separaten Filter nötig.

### 3. Automation-Curves bleiben unangetastet

`visibleWhen` ist rein UI-side im Inspector. `resolveParam` (`lib/automation/resolve.ts`) kennt es nicht — Curves werden weiterhin per-frame aufgelöst, auch für versteckte Params. Das ist by-design: würde der Renderer mid-clip einen Param "deaktivieren" weil er versteckt ist, würde das einen sichtbaren Sprung erzeugen wenn der zugehörige Toggle automatisiert flippt. Versteckte Params behalten ihre Wirkung im Render, sie werden nur im Inspector ausgeblendet.

### 4. AutoPreset-Wechselwirkung

Claude's Vision-Endpunkt schlägt Werte für ALLE Schema-Keys vor, auch für versteckte. Nach einem Auto-Preset kann ein User einen Toggle aktivieren und plötzlich erscheinen vorbelegte Werte für vorher-versteckte Params. Das ist Feature, nicht Bug — der User hat dann sofort sinnvolle Werte. Dokumentiert in KNOWN_LIMITATIONS.

---

## File map

| File | Action | Purpose |
|---|---|---|
| `lib/renderer/types.ts` | modify | `visibleWhen?` an `ParamSchema`-Intersection |
| `lib/fx/text.ts` | modify | `visibleWhen` an `extrusionDirection`/`extrusionDepth`/`extrusionStyle` (wenn `enable3d`) + `blinkDecay` (wenn `blink`) |
| `lib/fx/contour/index.ts` | modify | `visibleWhen` an `sweepSpeed` (wenn `sweepDirection !== 'all'`) |
| `components/Workspace/Inspector/index.tsx` | modify | `visibleWhen`-Check vor dem `<label>`-Return |
| `tests/unit/fx/conditional-visibility.test.ts` | **CREATE** | Schema-Fixture-Tests pro Plugin (≥5) |
| `tests/unit/components/Inspector/conditional-params.test.tsx` | **CREATE** | Inspector-Integration + Roundtrip (≥4) |
| `docs/KNOWN_LIMITATIONS.md` | modify | Plan 5.8b Section (Store-Persistierung + Auto-Preset-Note) |

Nicht angefasst: Sweep, Pulse, Particles, ZoomPulse, Dissolve, Sunray — Pre-Survey ergab keine sinnvollen Candidates.

---

## Tasks

### Task 0 — Baseline check

- [ ] Verifiziere `git status` clean (oder nur ignorierbare untracked files), `npm test -- --run` zeigt 675 passing, `npm run typecheck` + `lint` + `build` grün.

### Task 1 — `visibleWhen` an `ParamSchema`

Files: `lib/renderer/types.ts`

- [ ] Erweitere die `ParamSchema`-Intersection um `visibleWhen?: (params: Record<string, unknown>) => boolean`. Lass `ParamType` unverändert (Intersection auf Record-Value-Ebene, nicht in der Union).
- [ ] `npm run typecheck` muss clean bleiben — alle 8 bestehenden Plugins compilieren weiter weil das Feld optional ist.

Commit: `feat(types): visibleWhen optional field on ParamSchema intersection`

### Task 2 — Inspector-Filter

Files: `components/Workspace/Inspector/index.tsx`

- [ ] Im `Object.entries(plugin.paramSchema).map(...)` Callback (Zeile 55ff): vor dem Return des `<label>` prüfen `if (schema.visibleWhen && !schema.visibleWhen(clip.params)) return null;`.
- [ ] Visuell: ausgeblendete Params sind WEG, kein Platzhalter, kein Grau, kein Spacing-Leak.

Commit: `feat(inspector): hide params + their AutomateButton via visibleWhen`

### Task 3 — Text FX visibleWhen

Files: `lib/fx/text.ts`

- [ ] An `extrusionDirection` (Zeile 177ff), `extrusionDepth` (Zeile 188ff), `extrusionStyle` (Zeile 197ff) je `visibleWhen: (p) => p.enable3d === true` ergänzen.
- [ ] An `blinkDecay` (Zeile 168ff) `visibleWhen: (p) => p.blink === true` ergänzen.

Commit: `feat(fx): visibleWhen on Text FX extrusion params + blinkDecay`

### Task 4 — Contour FX visibleWhen

Files: `lib/fx/contour/index.ts`

- [ ] An `sweepSpeed` (Zeile 148ff) `visibleWhen: (p) => p.sweepDirection !== 'all'` ergänzen. Begründung: `sweepDirection='all'` zeichnet die Contour ohne Sweep-Animation, sweepSpeed hat keinen Effekt.

Commit: `feat(fx): visibleWhen on Contour FX sweepSpeed`

### Task 5 — Tests

Files:
- `tests/unit/fx/conditional-visibility.test.ts` (CREATE)
- `tests/unit/components/Inspector/conditional-params.test.tsx` (CREATE)

**conditional-visibility.test.ts** — 5 Cases:
- [ ] `visibleWhen` returns `true` → Inspector renders param (smoke via direct schema call)
- [ ] `visibleWhen` returns `false` → render is null
- [ ] Schema ohne `visibleWhen` → param immer sichtbar
- [ ] Text FX: `extrusionDepth.visibleWhen({ enable3d: false, ... })` returns `false`; `extrusionDepth.visibleWhen({ enable3d: true, ... })` returns `true`
- [ ] Contour FX: `sweepSpeed.visibleWhen({ sweepDirection: 'all', ... })` returns `false`; `sweepSpeed.visibleWhen({ sweepDirection: 'lr', ... })` returns `true`

**conditional-params.test.tsx** — 4 Cases:
- [ ] Inspector rendert `extrusionDepth`-Slider wenn `enable3d=true` im Clip-Params
- [ ] Inspector rendert `extrusionDepth`-Slider NICHT wenn `enable3d=false`
- [ ] AutomateButton ist im Inspector NICHT renderbar (queryByRole) wenn der Param via visibleWhen ausgeblendet ist
- [ ] Roundtrip-Test: setze `extrusionDepth=16` im Store → toggle `enable3d=false` (Param verschwindet aus Inspector) → toggle `enable3d=true` → `extrusionDepth` ist immer noch `16` im Store

Commit: `test(inspector): conditional-visibility unit + roundtrip integration`

### Task 6 — KNOWN_LIMITATIONS update

Files: `docs/KNOWN_LIMITATIONS.md`

- [ ] Neue Section am Ende (vor "Manual verification checklist"):

```markdown
## Plan 5.8b — Inspector Conditional Visibility

- `visibleWhen` ist rein UI — versteckte Params behalten ihre Store-Werte.
  Wenn ein Toggle den Param wieder sichtbar macht, sind vorherige Werte
  und Automation-Curves erhalten.
- AutomationCurve eines versteckten Params bleibt aktiv im Renderer
  (`resolveParam` kennt visibleWhen nicht — beabsichtigt, damit
  automatisierte Toggle-Flips keine sichtbaren Sprünge erzeugen).
- Auto-Preset schlägt alle Schema-Keys vor, auch für aktuell versteckte
  Params. Nach einem Preset können Werte für versteckte Params
  vorbelegt sein — sie werden aktiv sobald der zugehörige Toggle an ist.
```

Commit: `docs(limitations): Plan 5.8b conditional visibility — store + auto-preset semantics`

### Task 7 — Verify + push

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `npm test -- --run` ≥ 684 tests passing (Baseline 675 + 9)
- [ ] `npm run build` succeeds
- [ ] Manual smoke test (DevTools Mobile + Desktop):
  - Text FX: toggle `enable3d` → extrusion-Cluster erscheint/verschwindet
  - Text FX: toggle `blink` → blinkDecay erscheint/verschwindet
  - Text FX: Roundtrip — Wert in extrusionDepth setzen, enable3d toggle, Wert erhalten
  - Contour: `sweepDirection` auf 'all' → sweepSpeed verschwindet; auf 'lr' → erscheint
  - AutomateButton folgt der visibleWhen-Sichtbarkeit
- [ ] Granulare Commits pro Task (siehe oben)
- [ ] `git push origin main`

---

## Verification gate

```powershell
npm test -- --run    # ≥ 684 passing
npm run typecheck    # clean
npm run lint         # clean
npm run build        # clean, no bundle delta of significance
```

Bundle-Delta-Erwartung: **minimal** (eine optionale Type-Erweiterung + 5 Param-Definitionen + UI-Filter + 9 Tests). Kein neuer Code-Pfad im Renderer, keine neuen Dependencies.
