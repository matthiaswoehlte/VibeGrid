# CC #2 — QA Report: Plan 5.5 (Automation UI, Waveform Worker, Interpolation Modes, Zoom Pulse)

Du bist CC #2 — QA Engineer für VibeGrid.
Du schreibst KEINEN Feature-Code und reparierst KEINE Bugs.
Du verifizierst, dokumentierst und reportest ausschließlich.

**Verzeichnis:** `C:\_Dev\VibeGrid`

---

## Schritt 1: Verification Gate

```powershell
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Erwartung:
- typecheck: clean
- lint: clean
- test: ≥ 300 Tests grün (+65 gegenüber Plan-5-Baseline 237)
- build: Studio-Page innerhalb ~5% von Plan-5-Baseline (~122 kB),
  Waveform-Worker als separater Chunk sichtbar,
  AWS SDK + Anthropic SDK in keinem Client-Chunk

---

## Schritt 2: Worker-Chunk Verifikation

```powershell
Get-ChildItem .next\static\chunks\ | Where-Object { $_.Name -match 'waveform' }
```

Erwartung: mind. eine Datei mit "waveform" im Namen.
Falls leer → als Bug melden, nicht selbst fixen.

---

## Schritt 3: Git-Diff Review

```powershell
git log --oneline origin/main..HEAD
git diff origin/main..HEAD
```

Prüfe:
- 16 Tasks = 16 Plan-Commits + 1 Plan-Doc-Commit = 17 Commits?
- Commit-Messages: `type(scope): description` Format?
- Scopes nur: `automation`, `audio`, `store`, `hooks`,
  `inspector`, `timeline`, `tests`, `fx`

---

## Schritt 4: Code-Review Checkliste

**Interpolation Extension**
- [ ] `lib/automation/types.ts`: `Interpolation = 'linear' | 'step' | 'easeIn' | 'easeOut'`
- [ ] `lib/automation/resolve.ts`: switch-Statement mit allen 4 Branches
- [ ] `default:` im switch fällt durch zu step-Fallback (kein Throw)
- [ ] Fehlender `interpolation`-Key → step-Fallback (safe default)

**Automation Operations**
- [ ] `lib/automation/operations.ts` existiert als pure Datei (kein React, kein I/O)
- [ ] `sortPoints` sortiert nach beat aufsteigend
- [ ] `addPoint` re-sortiert nach Insert
- [ ] `toStaticValue` auf leerer Kurve wirft (kein Silent-Fail)
- [ ] Keine Mutation der Input-Arrays (immutable)

**Store**
- [ ] `UIState` hat `expandedAutomationClipId: string | null`
- [ ] `partialize` enthält NUR `zoom` — weder `selectedClipId`
  noch `expandedAutomationClipId`
- [ ] `setSelectedClipId` cleared `expandedAutomationClipId`
  wenn neue ID ≠ aktuelle expanded ID
- [ ] `removeClip` cleared `expandedAutomationClipId`
  wenn der entfernte Clip der expanded war
- [ ] Persist-Version: `version: 3` (von 2 hochgezogen)
- [ ] Migration für `version < 3` vorhanden

**patchClipParam Helper**
- [ ] Kein `Parameters<typeof createTimelineSlice>` — nur Closure über `set`
- [ ] Helper ist nicht exportiert

**Inspector**
- [ ] `AutomateButton` erscheint NUR bei `schema.kind === 'slider'`
- [ ] Klick auf statischen Wert → `convertParamToAutomation` mit playhead-Beat
- [ ] Klick auf automatierten Wert → `convertParamToStatic`
- [ ] "Edit on timeline" Link erscheint nur wenn ≥ 1 Param automated ist
- [ ] "Edit on timeline" togglet `expandedAutomationClipId`

**AutomationLane**
- [ ] Rendert nichts wenn `expandedAutomationClipId !== clip.id`
- [ ] Nur Slider-Params bekommen eine Sub-Row (Color/Toggle übersprungen)
- [ ] Interpolation-Picker dispatcht `setParamInterpolation`
- [ ] Close-Button setzt `expandedAutomationClipId = null`
- [ ] Klick auf leere Lane-Fläche → `addParamPoint`
- [ ] Lane ist INNERHALB des bestehenden `<DndContext>` — kein eigener Context

**AutomationPoint**
- [ ] Pointer-Drag verwendet Delta-Pattern (kein `getBoundingClientRect`)
- [ ] `e.stopPropagation()` + `e.preventDefault()` auf PointerDown
- [ ] Drag clampt beat auf `[0, lengthBeats]`
- [ ] Drag clampt value auf `[schema.min, schema.max]`
- [ ] Rechtsklick auf letzten Punkt → `convertParamToStatic` (kein leerer Kurven-Throw)
- [ ] Rechtsklick auf anderen Punkt → `removeParamPoint`

**AutomationCurvePath**
- [ ] Linear: M…L… Pfad
- [ ] Step: horizontale + vertikale Segmente (M…L H V…)
- [ ] EaseIn: kubische Bezier-Kontrollpunkte

**Waveform Worker Pipeline**
- [ ] `lib/audio/peaks.ts` exportiert `downsamplePeaks` als pure Funktion
- [ ] `lib/audio/waveform-worker.ts` importiert `downsamplePeaks` aus `./peaks`
  (kein inline Copy der Mathematik mehr)
- [ ] `useWaveformPeaks`: module-scoped cache Map vorhanden
- [ ] `_resetPeaksCacheForTests()` exportiert
- [ ] Hook ist SSR-safe: gibt `idle` zurück wenn `!isClient()`
- [ ] AbortController feuert bei Unmount
- [ ] CORS-Risiko dokumentiert (Kommentar im Hook oder KNOWN_LIMITATIONS.md)
- [ ] `Waveform.tsx` konsumiert Worker-Tuple-Format `[number, number][]`
  (kein `{ min: Float32Array, max: Float32Array }` mehr)

**Zoom Pulse FX**
- [ ] `lib/fx/zoom-pulse.ts` exportiert `zoomPulsePlugin`
- [ ] `id: 'zoom-pulse'`, `kind: 'ZoomPulse'`
- [ ] Parameter: `intensity` (Slider 0–1) + `decay` (Slider 0–1)
- [ ] `render()`: kein Draw wenn `!rc.imageBitmap`
- [ ] `render()`: kein Draw wenn `fade <= 0` (Performance-Guard)
- [ ] `ctx.save()` und `ctx.restore()` sind balanciert
- [ ] In `lib/fx/index.ts` registriert
- [ ] `TrackKind` enthält `'zoom-pulse'`
- [ ] `FxKind` enthält `'ZoomPulse'`
- [ ] `RENDER_ORDER` in `loop.ts` enthält ZoomPulse
- [ ] `initialTimelineState.tracks` enthält zoom-pulse Track
- [ ] `KIND_COLOR` in `Clip.tsx`: zoom-pulse hat orange `#ff9f43`
- [ ] Persist-Migration v3: zoom-pulse Track wird zu
  bestehenden Projekten hinzugefügt

---

## Schritt 5: Gezielte Test-Runs

```powershell
npm test -- automation/resolve --run
npm test -- automation/operations --run
npm test -- store/timeline-slice-automation --run
npm test -- store/ui-state-automation --run
npm test -- components/Inspector-automate --run
npm test -- Timeline/AutomationLane --run
npm test -- Timeline/AutomationPoint --run
npm test -- Timeline/AutomationCurvePath --run
npm test -- hooks/useWaveformPeaks --run
npm test -- audio/peaks --run
npm test -- fx/zoom-pulse --run
```

Für jeden Run: tatsächliche Test-Anzahl notieren und gegen Soll prüfen:

| Test-File | Soll |
|---|---|
| automation/resolve | ≥ 22 (16 + 6 neue) |
| automation/operations | ≥ 10 |
| store/timeline-slice-automation | ≥ 8 |
| store/ui-state-automation | ≥ 6 |
| components/Inspector-automate | ≥ 4 |
| Timeline/AutomationLane | ≥ 6 |
| Timeline/AutomationPoint | ≥ 5 |
| Timeline/AutomationCurvePath | ≥ 3 |
| hooks/useWaveformPeaks | ≥ 5 |
| audio/peaks | ≥ 4 |
| fx/zoom-pulse | ≥ 5 |

---

## Schritt 6: Regressions-Check Plan 5

```powershell
npm test -- components/Inspector --run
npm test -- components/AutoPresetButton --run
npm test -- Timeline/Clip --run
npm test -- storage/mime-validator --run
npm test -- renderer/image-cache --run
```

Alle müssen grün sein — keine Plan-5-Tests dürfen durch die UIState-Erweiterung
(`expandedAutomationClipId` required) gebrochen sein.

---

## Schritt 7: Playwright E2E

```powershell
npx playwright test
```

Bestehende 5 Tests aus Plan 5 müssen grün bleiben.
Neue E2E-Tests für Plan 5.5 sind CC #2 Territory — anlegen:

```
tests/e2e/automation.spec.ts
```

Mindest-Szenarien:
- [ ] Seite lädt ohne JS-Fehler
- [ ] FX-Clip auf Timeline platzierbar (Regression)
- [ ] Inspector zeigt ⚡ Button neben Intensity-Slider
- [ ] Zoom Pulse erscheint in FX-Library

---

## Schritt 8: Watchlist-Bestätigung (Plan 6 Scope offen)

- [ ] `VideoExporter` / `MediaRecorder` noch nicht vorhanden?
- [ ] `ExportButton` ist noch disabled stub?
- [ ] Responsive Layout (Spec §9.5) noch nicht implementiert?

---

## Report-Format

```markdown
# QA Report — Plan 5.5: Automation UI, Waveform Worker, Zoom Pulse

✅ Freigegeben / ❌ Fixes needed

## Verification Gate
## Worker-Chunk Verifikation
## Test-Count (Vorher / Nachher / Delta + je Test-File)
## Commit-Log
## Code-Review Ergebnis (jeder Punkt ✅/❌)
## Gezielte Test-Runs (Ist vs. Soll)
## Regressions-Check Plan 5
## Playwright E2E
## Watchlist-Bestätigung
## Offene Punkte (alles ❌, kein Fix-Vorschlag)
```
