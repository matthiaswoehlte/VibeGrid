# CC #2 — QA Report: Plan 5 (UI Components, Claude Auto-Preset, Automation Datamodel)

Du bist CC #2 — QA Engineer für VibeGrid.
Du schreibst KEINEN Feature-Code und reparierst KEINE Bugs.
Du verifizierst, dokumentierst und reportest ausschließlich.

**Verzeichnis:** `C:\_Dev\VibeGrid`

---

## Schritt 1: Verification Gate

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Erwartung:
- typecheck: clean
- lint: clean
- test: 237 Tests grün (+68 gegenüber Plan-4-Baseline 169)
- build: Studio-Page ~122 kB First Load, alle 4 API-Routes 0 B Client-Bundle

---

## Schritt 2: Git-Diff Review

```bash
git log --oneline origin/main..HEAD
git diff origin/main..HEAD
```

Prüfe:
- 28 Plan-5-Commits vorhanden (plus 2 Plan-Doc = 30 gesamt, 43 ahead)?
- Commit-Messages: `type(scope): description` Format?
- Granularität: ein Modul/eine Komponente pro Commit?

---

## Schritt 3: Code-Review Checkliste

**Security & Server-Only**
- [ ] `lib/ai/env.ts` Zeile 1: `import 'server-only'`
- [ ] `lib/ai/anthropic.ts` Zeile 1: `import 'server-only'`
- [ ] Build: Anthropic SDK + AWS SDK in keinem Client-Chunk
- [ ] `app/api/analyze-image/route.ts`: `export const runtime = 'nodejs'`

**Automation Datamodel**
- [ ] `lib/automation/types.ts`: `StaticOrAuto<T>`, `AutomationCurve<T>`, `isAutomationCurve` vorhanden
- [ ] `lib/automation/resolve.ts`: `resolveParam` + `resolveClipParams` pure, kein React/I/O
- [ ] `lib/renderer/loop.ts`: nutzt `resolveClipParams(rawParams, beats)` statt direktem `clip.params`

**Store**
- [ ] `UIState` hat nur `{ zoom, selectedClipId }` — kein `inspectorOpen`
- [ ] `partialize`: `selectedClipId` ist NICHT enthalten (nur `zoom`)
- [ ] `addMediaRefMeta` und `setClipParam` in `MediaActions`/`TimelineActions`

**useAudioEngine (Architekt-Fix)**
- [ ] Kein Action-Patching — `source`-Guard stattdessen:
  `if (grid.source === 'detected') return;` im Store-Subscriber
- [ ] Engine-Detection → `setDetectedGrid` mit `source: 'detected'`
- [ ] `engine.destroy()` wird bei Unmount aufgerufen

**image-cache Race Guard**
- [ ] `createImageBitmapCache`: `inflight`-Map mit `cancelled`-Flag vorhanden
- [ ] `evict()` setzt `entry.cancelled = true` für laufende Loads
- [ ] Cancelled Bitmap wird `.close()` aufgerufen und nicht gecacht

**Claude Auto-Preset**
- [ ] Route validiert Image-MIME vor Claude-Call (nur jpeg/png/webp)
- [ ] `imageMime` korrekt als `'image/jpeg' | 'image/png' | 'image/webp'` gecastet
- [ ] `schema-validator.ts` hat KEIN `import 'server-only'` (muss client-importierbar sein)
- [ ] `fetchAutoPreset` macht defensive Re-Validierung client-seitig

**Komponenten**
- [ ] `inspectorOpen`: lokaler `useState` in `Workspace` — nicht im Store
- [ ] `useAudioEngine` wird auf Page-Level (`app/(studio)/page.tsx`) aufgerufen, nicht in Workspace
- [ ] `engine` wird als Prop weitergegeben (TopBar + Workspace)
- [ ] ErrorBoundary um Stage UND Timeline
- [ ] Alle interaktiven Surfaces: `onPointerDown/Move/Up` (keine Mouse-Events)

---

## Schritt 4: Playwright E2E (ab Plan 5 Pflicht)

```bash
npx playwright test
```

Falls noch keine Tests existieren — anlegen:

```
tests/e2e/studio.spec.ts
```

Mindest-Szenarien:
- [ ] Seite lädt, kein JS-Fehler in der Console
- [ ] TopBar mit Play/Pause-Button sichtbar
- [ ] LeftPanel mit Media/FX/Layers Tabs sichtbar
- [ ] Inspector zeigt "Wähle einen Clip oder Effekt aus." initial

---

## Schritt 5: Bekannte Abweichungen verifizieren

CC #1 hat 6 Abweichungen gemeldet — jede verifizieren:

1. Task-Reihenfolge 16→19→15 — build war zu keinem Zeitpunkt dauerhaft broken?
2. Workspace direkt mit engine-prop (Task 23 vorgezogen) — kein doppelter `useAudioEngine`-Call?
3. Renderer-Loop TypeScript-Casts — `npm run typecheck` clean?
4. `vitest.setup.ts` globaler Cleanup — alle Component-Tests isoliert?
5. jsdom-Stubs für `URL.createObjectURL` + `File.arrayBuffer` — media-meta-Tests grün?
6. `useRenderer` Lint-Warning gefixt — `npm run lint` clean?

---

## Schritt 6: Watchlist-Bestätigung

Plan-6-Watchlist — verifiziere dass diese Punkte OFFEN sind (nicht versehentlich implementiert):

- Export Pipeline (`VideoExporter`, `MediaRecorder`) — noch nicht vorhanden?
- `ExportButton` ist Stub (disabled) in TopBar?
- `RecIndicator` ist statischer Stub?

---

## Report-Format

```markdown
# QA Report — Plan 5: UI Components, Claude Auto-Preset, Automation Datamodel

✅ Freigegeben / ❌ Fixes needed

## Verification Gate
## Test-Count (Vorher / Nachher / Delta)
## Commit-Log (git log --oneline)
## Code-Review Ergebnis (jeder Punkt ✅/❌)
## Playwright E2E
## Abweichungen vom Plan (alle 6 verifiziert)
## Watchlist-Bestätigung (Plan 6 Scope noch offen)
## Offene Punkte (alles ❌ ohne Fix-Vorschlag)
```
