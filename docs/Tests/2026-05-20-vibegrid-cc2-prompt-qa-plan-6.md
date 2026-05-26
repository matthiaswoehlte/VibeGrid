# CC #2 Prompt — QA Report: Plan 6 Export Pipeline

## Deine Rolle

Du bist **QA Engineer** für VibeGrid. Du führst Verifikationen durch und
schreibst einen Report. Du schreibst **keinen Feature-Code** und reparierst
**keine Bugs**. Wenn du Bugs findest, dokumentierst du sie und meldest sie.

Alle Befehle in **PowerShell** (kein Bash).

---

## Was zu verifizieren ist

Plan 6 (Export Pipeline) wurde implementiert auf Basis von Commit `4f7dcf1`
(Plan 6 v2 mit Architekt-Fixes).

**Was Plan 6 gebracht hat:**

- `lib/export/types.ts` — `ExportState`, `ExportStatus`, `ExportErrorCode`,
  `ExportOptions`, `ExportWarning`
- `lib/export/codec.ts` — `pickCodec()` mit VP9→VP8→WebM Fallback-Kette
- `lib/export/filename.ts` — `makeFilename()` mit ISO-Timestamp
- `lib/export/state-machine.ts` — `EXPORT_INITIAL_STATE` +
  `reduceExportState()` (idle-Reset löscht derived fields)
- `lib/audio/engine.ts` — neue public Methoden `getAudioStream()` und
  `getAudioElement()`
- `lib/export/recorder.ts` — `createVideoExporter()` Factory mit Pre-Checks,
  Dual-Stop-Trigger, Blob-Assembly, Download, URL.revoke nach 10s
- `lib/hooks/useVideoExporter.ts` — Hook mit Elapsed-Tick, Codec-Toast,
  Tab-Visibility-Warning, FPS-Monitor
- `lib/store/` — `exportState: ExportState` in UIState, `setExportState`
  Patch-Action
- `components/TopBar/ExportButton.tsx` — Rewrite mit Pre-Check-aware Disabled
- `components/TopBar/RecIndicator.tsx` — Rewrite mit MM:SS Timecode + Cancel
- `vitest.setup.ts` — jsdom-Stubs migriert + MockMediaRecorder global
- `KNOWN_LIMITATIONS.md` — Export-Sektion ausgefüllt

**Erwartete Baseline nach Plan 6:** ≥ 385 Tests grün

---

## Schritt 1 — Verification Gate

```powershell
npm test -- --run
```
Erwartung: **≥ 385 Tests**, 0 failing. Notiere exakte Zahl.

```powershell
npm run typecheck
```
Erwartung: keine Errors, keine Warnings.

```powershell
npm run lint
```
Erwartung: sauber.

```powershell
npm run build
```
Erwartung: Build erfolgreich. Studio-Page First Load JS innerhalb ~5% von
131 kB (Plan 5.7-R Baseline). Notiere den exakten Wert.

---

## Schritt 2 — Git Log

```powershell
git log --oneline origin/main..HEAD
```

Notiere Anzahl Commits seit main und ob die Plan-6-Commits dem Format
`type(scope): description` folgen. Erwartete Scopes: `chore`, `audio`,
`export`, `store`, `topbar`, `docs`, `tests`.

```powershell
git diff origin/main --stat
```

Notiere ob alle erwarteten neuen Dateien vorhanden sind (siehe File-Map oben).

---

## Schritt 3 — Code Review Checkboxen

### `lib/export/recorder.ts`

- [ ] `createVideoExporter` gibt `null` zurück wenn `!isClient()` — SSR-safe
- [ ] `getAudioMediaRef()` wird als Getter-Function in `deps` übergeben
  (nicht als gecapterter Wert) — Architekt Bug-1-Fix
- [ ] `start()` ruft `deps.getAudioMediaRef()` frisch auf bei jedem Start
- [ ] Pre-Check 1: `!deps.getAudioMediaRef()` → `status: 'error', errorCode: 'no-audio'`
- [ ] Pre-Check 2: `activeImageClips(deps.getTimeline(), 0).length === 0` →
  `status: 'error', errorCode: 'no-image'`
- [ ] Pre-Check 3: `!audioStream` (von `getAudioStream()`) → Error + Bail
- [ ] `mediaRecorder.start(500)` — mit Timeslice-Argument (nie ohne)
- [ ] `recorder.onstop = null` wird VOR `recorder.stop()` in `cancel()` gesetzt
  (verhindert Blob-Assembly-Path nach Cancel)
- [ ] Safety-Interval und 'ended'-Listener werden in `onstop()` UND `cancel()`
  beide aufgeräumt (kein double-stop)
- [ ] `URL.revokeObjectURL(url)` via `setTimeout(..., 10_000)` — nicht sofort
- [ ] `videoBitsPerSecond: 6_000_000` und `audioBitsPerSecond: 128_000` gesetzt
- [ ] `_resetExporterTestsForVitest()` export vorhanden (test-helper)

### `lib/hooks/useVideoExporter.ts`

- [ ] Kein totes `unsub`-Pattern (Architekt A1-Fix) — nur eine aktive
  Subscription für den Elapsed-Tick
- [ ] `progress` wird im Interval-Tick berechnet:
  `progress: totalSeconds > 0 ? next / totalSeconds : 0` (Architekt A4-Fix)
- [ ] Canvas-Ref-Singleton (`lib/renderer/canvas-ref.ts`) wird NICHT verwendet —
  stattdessen Prop-Drilling von Workspace → TopBar (Architekt A3-Fix)
- [ ] Tab-Visibility-Warning dismisst den Toast wenn Tab wieder aktiv wird
- [ ] FPS-Monitor warnt nur einmal pro Export-Session
- [ ] `codecToastedRef` wird bei `status === 'idle'` zurückgesetzt

### `lib/audio/engine.ts`

- [ ] `getAudioStream(): MediaStream | null` vorhanden, gibt
  `streamDest?.stream ?? null` zurück
- [ ] `getAudioElement(): HTMLAudioElement | null` vorhanden
- [ ] Beide Methoden neben `getAnalyser()` platziert (Symmetrie)

### `lib/store/index.ts`

- [ ] `exportState: EXPORT_INITIAL_STATE` in der UI-Initial-State-Literal
- [ ] `exportState` steht **nicht** in der `partialize`-Funktion
- [ ] `setExportState` nutzt `reduceExportState` (nicht manuelles spread)

### `vitest.setup.ts`

- [ ] `URL.createObjectURL` und `URL.revokeObjectURL` Stubs global vorhanden
- [ ] `File.prototype.arrayBuffer` Polyfill vorhanden
- [ ] `MockMediaRecorder` als `globalThis.MediaRecorder` gesetzt
- [ ] `MockMediaRecorder.stop()` wirft `InvalidStateError` wenn nicht
  `'recording'` (wichtig für cancel-Tests)

### `KNOWN_LIMITATIONS.md`

- [ ] Export-Sektion nicht mehr `_To be filled in by Plan 6_`
- [ ] Mindestens diese 4 Punkte enthalten: Echtzeit-Constraint, Tab-Focus,
  WebM/iOS-Inkompatibilität, Codec-Browser-Varianz

---

## Schritt 4 — Test Coverage Spot-Check

Öffne folgende Test-Dateien und verifiziere die genannten Cases:

### `tests/unit/export/VideoExporter.test.ts`

- [ ] Test "start with all pre-checks satisfied → status=recording" vorhanden
- [ ] Test mit `getAudioMediaRef: () => null` für no-audio (nicht `audioMediaRef: null`)
  — Architekt Bug-1-Fix verifiziert
- [ ] Test für no-image-clip vorhanden
- [ ] Test "stop via safety interval" nutzt `vi.useFakeTimers()` mit try/finally
- [ ] Test "URL.revokeObjectURL scheduled with 10s delay" nutzt `vi.useFakeTimers()`
- [ ] Test "cancel removes 'ended' listener" — spurious second stop getestet

### `tests/unit/export/codec.test.ts`

- [ ] Alle 3 Fallback-Pfade getestet (vp9 → vp8 → default)
- [ ] `pickCodec` akzeptiert injected `isSupported` Funktion (pure, testbar)

### `tests/unit/export/state-machine.test.ts`

- [ ] Test "reset to idle clears warning AND progress AND elapsedSeconds"
- [ ] Test "warning can be set without changing status"

### `tests/unit/store/export-state.test.ts`

- [ ] Test "partialize excludes exportState (only zoom persists)" vorhanden
- [ ] Test prüft `localStorage` direkt

### `tests/unit/components/TopBar/ExportButton.test.tsx`

- [ ] 4 disabled-Pfade getestet (kein Audio, kein Image-Clip, status≠idle,
  plus einer enabled-Pfad mit click-Test)

### `tests/unit/storage/media-meta.test.ts`

- [ ] Inline-Stubs für `URL.createObjectURL` / `File.arrayBuffer` ENTFERNT
  (sie leben jetzt global in vitest.setup.ts)
- [ ] Tests laufen weiterhin grün (kein Verhalten geändert)

---

## Schritt 5 — Playwright E2E

```powershell
npx playwright test
```

Notiere: passed / failed / skipped. Bei Failures: vollständige
Fehlermeldung. Erwartung: mindestens die 5 bestehenden Smoke-Tests grün.

**Hinweis:** Falls neue E2E-Tests für Export existieren, diese ebenfalls
notieren.

---

## Schritt 6 — Kritische Laufzeit-Checks (manuell)

Diese Checks können nicht durch Unit-Tests abgedeckt werden und müssen
manuell verifiziert werden:

```powershell
npm run dev
```

- [ ] Export-Button ist **disabled** wenn kein Audio hochgeladen ist
- [ ] Export-Button ist **disabled** wenn kein Image-Clip auf Beat 0 liegt
- [ ] Export-Button ist **enabled** wenn Audio + Image-Clip vorhanden
- [ ] Klick auf Export → REC-Indicator erscheint in TopBar (roter Dot)
- [ ] Timecode zählt hoch (`0:00 / X:XX` Format)
- [ ] Codec-Toast erscheint einmal ("VP9 + Opus" oder "VP8 + Opus (Fallback)")
- [ ] Tab wechseln während Export → persistenter Warning-Toast
- [ ] Tab zurück → Toast verschwindet
- [ ] Cancel (✕) → REC-Indicator weg, kein Download
- [ ] Export bis Ende → Download-Dialog öffnet sich automatisch
- [ ] Dateiname im Download: `vibegrid_export_YYYY-MM-DDTHH-MM-SS.webm`
  (kein `undefined`, kein Doppelpunkt)
- [ ] **Heruntergeladene Datei in VLC öffnen** → Audio + Video spielen
  synchron, kein schwarzer Opening-Frame
- [ ] **Heruntergeladene Datei in Chrome öffnen** → gleiche Prüfung

---

## Dein Report-Format

```markdown
# QA Report — Plan 6: Export Pipeline
Datum: YYYY-MM-DD
Commit: [HEAD hash]

## Verification Gate
- npm test:      [X] Tests, [0] failing  ✅ / ❌
- typecheck:     ✅ / ❌
- lint:          ✅ / ❌
- build:         ✅ / ❌  (Bundle: X kB First Load JS)

## Git Log
[Anzahl Plan-6-Commits, Format korrekt: ja/nein]
[Neue Dateien vorhanden: ja/nein, fehlende falls nein]

## Code Review Findings
[Checkboxen Schritt 3 — ✅ oder ❌ mit Zeilen-Fundstelle]

## Test Coverage Spot-Check
[Checkboxen Schritt 4 — ✅ oder ❌]

## Playwright
[passed / failed / skipped]

## Manuelle Laufzeit-Checks
[Checkboxen Schritt 6 — ✅ oder ❌]
[VLC-Test: ✅ spielt sauber / ❌ Problem: ...]
[Chrome-Test: ✅ / ❌]

## Offene Punkte
[Liste aller ❌-Findings mit Datei + Zeile]

## Gesamturteil
✅ Freigegeben für Plan 5.8
❌ Fixes nötig: [Liste]
```

**Gib den Report als einzelne `.md`-Datei zurück.**
Dateiname: `2026-05-20-vibegrid-qa-plan-6.md`
