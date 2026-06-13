# Architekt-Entscheidung — Plan 9b.5: Undo / Redo
### Nach CC #1 Pre-Review (post-9b, 1248 Tests, Store v6)

❌ Nicht freigegeben — Rev. 2 erforderlich.

Alle 4 Blocker von CC #1 sind bestätigt. Zusätzlich treffe ich hier alle
offenen Mikro-Entscheidungen damit CC #1 Rev. 2 in einem Zug schreiben kann.

---

## Bestätigte Blocker

**B1 — Coalesce-Bug:** Bestätigt. Die Tabellen-Analyse ist korrekt —
bei `coalesce: true` darf kein neuer Snapshot gemacht werden, nur mutiert.
Fix exakt wie CC #1 vorschlägt:

```ts
if (options.coalesce) {
  mutator(state)  // kein history.past-Eintrag
} else {
  const entry = { timeline: structuredClone(state.timeline), ... }
  state.history.past.push(entry)
  if (past.length > MAX_HISTORY) past.shift()
  state.history.future = []
  mutator(state)
}
```

**B2 — Immer-Middleware:** Entscheidung → **Immer einführen (Option A).**

Begründung: Die Mutator-Syntax `(state) => { state.x = y }` ist klarer
als Spread-Style `(state) => ({ ...state, x: y })` bei tief verschachtelten
Strukturen wie `timeline.clips[i].params`. Immer ist der Standard für
Zustand-Stores dieser Größe.

```ts
// npm i immer
// lib/store/index.ts:
import { immer } from 'zustand/middleware/immer'
const useAppStore = create<AppState>()(immer((...) => ({ ... })))
```

Die 31 bestehenden Spread-Style-Calls bleiben kompatibel — Immer-Middleware
akzeptiert sowohl Mutator- als auch Return-Style. Kein Big-Bang-Refactor nötig.

**B3 — External setState:** Entscheidung → **Option B.**

`recordingSet` wird als globale Action via `useAppStore.getState().recordingSet`
exponiert. Die 4 externen Caller werden umgestellt:

- `NewProjectButton.tsx` → `recordingSet('New Project', ..., { skip: true })`
  *(Projekt-Reset ist nicht undobar — skip mit Kommentar)*
- `Transport.tsx` → `recordingSet('', ..., { skip: true })`
  *(Playback-State ist transient)*
- `Toolbar.tsx` → je nach Action: record oder skip (CC #1 entscheidet in Schritt 0)
- `deserialize.ts` → `recordingSet('Load Project', ..., { skip: true })`
  *(Projekt-Load ist nicht undobar)*

ESLint-Rule wird erweitert auf `useAppStore.setState`-Calls (MemberExpression)
im gesamten Projekt, nicht nur in `lib/store/`.

**B4 — set-API Konsistenz:** Wird durch B2 (Immer) gelöst. Alle Code-Snippets
in Rev. 2 nutzen Immer-Mutator-Style ohne Return.

---

## Entscheidungen zu Wacklern

**W3 — AutomationCurves-Scope:**
CC #1 bestätigt: Kurven leben in `clip.params` → automatisch in
`structuredClone(state.timeline)` enthalten. Kein eigener Slice.
Plan-Kommentar `// automation: AutomationState` entfernen — er
verwirrte mehr als er half.

**W6 — Migrations-Tabelle:**
Plan-Pflicht in Rev. 2. Kategorien wie von CC #1 vorgeschlagen:

| Kategorie | Behandlung |
|---|---|
| `setPlayhead` | `skip` — 60×/s, kein Undo |
| `selectClips`, `clearSelection`, `addToSelection` | `skip` — Selection ist transient |
| `setZoom`, `setAppMode`, `setMobileUI*` | `skip` — UI-Preferences |
| `setExportState` | `skip` — Export-State ist transient |
| `addMediaRef`, `removeMediaRef`, `purgeSceneflowMediaRefs` | `skip` — R2-gebunden, nicht rückgängig machbar |
| `setVideoLoadProgress` | `skip` — transient |
| `moveClip`, `resizeClip`, `addClip`, `removeClip` | `record` |
| `moveSelectedClips`, `resizeSelectedClips`, `duplicateSelectedClips`, `deleteSelectedClips` | `record` |
| `setClipParams`, `setClipParam` | `record` + `coalesce` für Slider-Drag |
| `convertParamToAutomation`, Automation-Punkt-Aktionen | `record` |
| `addTrack`, `removeTrack`, `setTrackLabel`, `reorderTracks` | `record` |
| `setMuted` | `record` |
| `clearAllTracks`, `replaceMainVideoClips` | `record` |
| `setBPM`, `setDetectedGrid`, `resetGrid` | `record` |

Jede `skip`-Mutation bekommt einen Inline-Kommentar: `// Undo: transient — skip`.

**W8 — Coalesce Label-Matching:**
Entscheidung → Coalesce nur wenn `lastEntry.label === currentLabel`.
Verhindert unerwartetes Überschreiben wenn zwei verschiedene Actions
schnell hintereinander kommen.

```ts
if (options.coalesce &&
    past.length > 0 &&
    past[past.length - 1].label === label) {
  // kein neuer Entry — nur mutieren
} else {
  // normaler Record-Pfad
}
```

**D3 — Playhead im Undo-Scope:**
Entscheidung → **Playhead ist excluded.**

`state.timeline` wird geclont, aber `HistoryEntry` speichert explizit
`timeline-without-playhead`:

```ts
const entry: HistoryEntry = {
  timeline: structuredClone({
    ...state.timeline,
    playhead: undefined,  // excluded
  }),
  ...
}
```

Beim Restore wird der aktuelle Playhead beibehalten:

```ts
state.timeline = { ...prev.timeline, playhead: state.timeline.playhead }
```

Begründung: Undo während Playback soll die Clip-Struktur zurücksetzen,
nicht die Abspielposition. DAW-Standard (Ableton, Logic).

**D2 — WorkspaceHeader Position:**
Undo/Redo-Buttons links im Header, als erste Element-Gruppe vor dem Logo —
klassische DAW-Position (links = globale Transport/History-Controls).
Zwei Icon-Buttons (↩ ↪), disabled-State wenn Stack leer, Tooltip mit Label.

---

## Bestätigte Prozess-Entscheidung (W7)

**Plan-Template-Erweiterung ist hiermit offiziell durch den Architekt bestätigt:**

Ab Plan 9b.5 gilt für jeden zukünftigen Plan:
- Pflicht-Abschnitt `## Undo-Behaviour` mit Tabelle
- Pläne ohne diesen Abschnitt werden nicht freigegeben
- CC #2 prüft neue `set()`/`useAppStore.setState`-Calls im gesamten Projekt

Das ist eine permanente Architektur-Entscheidung, nicht nur ein Plan-9b.5-Scope.

---

## Quick-Wins für Rev. 2

- W1: Baseline auf **1248 Tests / Store v6** korrigieren
- W5: `history: { past: [], future: [] }` im Initial-State zeigen
- D1: Test-Pfad auf `tests/unit/store/` korrigieren
- D5: ESLint-Plugin-Setup via `eslint-plugin-local-rules` als devDependency spezifizieren
- D6: Public-Type `RecordingSet` in `lib/store/types.ts` deklarieren

---

## Checkliste Rev. 2

**Blocker:**
- [ ] B1 Coalesce-Fix: kein Snapshot bei `coalesce: true`, nur mutieren
- [ ] B2 Immer-Middleware einführen, alle Snippets auf Mutator-Style
- [ ] B3 ESLint-Rule auf gesamtes Projekt, 4 externe Caller umstellen
- [ ] B4 set()-Snippets konsistent (durch B2 gelöst)

**Soll:**
- [ ] W6 Migrations-Tabelle alle 31 Calls (record / skip / coalesce)
- [ ] W3 AutomationCurves-Scope explizit festgestellt, Kommentar entfernt
- [ ] W8 Coalesce nur bei Label-Match
- [ ] D3 Playhead excluded aus HistoryEntry + Restore-Pattern

**Quick-Wins:**
- [ ] W1 Baseline korrigiert
- [ ] W5 Initial-State gezeigt
- [ ] D1 Test-Pfad korrigiert
- [ ] D2 WorkspaceHeader-Position spezifiziert
- [ ] D5 ESLint-Plugin-Setup-Pfad
- [ ] D6 RecordingSet Public-Type

---

Architekt-Entscheidung — 2026-05-27
