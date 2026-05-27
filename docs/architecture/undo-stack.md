# Undo / Redo

> Stand: post-Plan-10 (2026-05-27). Plan 10 lieferte den vollständigen
> Stack — was bis Plan 9b nur eine vorbereitete Architektur war, ist
> jetzt verkabelt und im UI sichtbar.

## TL;DR

Ctrl/Cmd+Z = Undo · Ctrl/Cmd+Y oder Ctrl/Cmd+Shift+Z = Redo. Buttons
sitzen im `WorkspaceHeader`. Stack ist auf **100 Einträge** begrenzt,
nicht persistiert (überlebt keinen Page-Reload — Architekt-Entscheidung).

Scope: **Timeline** (ohne `playhead`) + **Audio-Grid** (BPM + Source).
NICHT im Stack: `ui`, `media`, `mobileUI`, `appMode` — die sind
entweder transient oder R2-gebunden, siehe Migrations-Tabelle unten.

---

## Architektur (Übersicht)

```
   User-Action
       │
       ▼
   timelineActions.addClip(...)
       │
       ▼
   get().recordingSet('Add Clip', mutator, { coalesce?, skip? })
       │
       ▼
   immer-Middleware setzt einen Draft auf
       │
       ▼ snapshot BEFORE mutating (außer bei coalesce mit Label-Match)
   past.push({ timeline, audio, label, timestamp })
   past.length > MAX_HISTORY ? past.shift()
   future = []                ◄── jede neue Aktion invalidiert Redo
       │
       ▼ mutator(draft) — verändert state.timeline / state.audio
   immer produziert neuen State
       │
       ▼
   zustand subscribers re-rendern (incl. UndoRedoButtons)
```

Bei Undo:
1. snapshot current state → push auf `future` (mit dem Label des zu
   undoenden Eintrags — sonst zeigt das Redo-Tooltip "Redo: current"
   statt "Redo: Add contour")
2. pop `past[last]` → restore timeline + audio (playhead bleibt erhalten)

Redo läuft symmetrisch: pop `future[0]`, push current auf `past`.

---

## Module

| Datei | Rolle |
|---|---|
| `lib/store/history-types.ts` | `HistoryEntry`, `HistoryState`, `MAX_HISTORY = 100` |
| `lib/store/recording-set.ts` | `makeRecordingSet(set)` — der einzige legitime Mutator-Wrapper |
| `lib/store/history-actions.ts` | `undo`, `redo`, `clearHistory` |
| `lib/store/index.ts` | Wires immer-Middleware + initial history-state + persist-Reset |
| `lib/hooks/useUndoRedoShortcuts.ts` | Globaler Keyboard-Hook (Cmd/Ctrl+Z/Y) |
| `components/Workspace/UndoRedoButtons.tsx` | Header-Buttons mit Tooltip |
| `eslint-local-rules.js` | Guardrail: `no-direct-set-state` + `no-bare-set-in-store` |

---

## API

### `useAppStore.getState().recordingSet(label, mutator, opts?)`

Der einzige sanktionierte Weg, State zu mutieren. ESLint enforced das
via `no-direct-set-state` (ANYWHERE) und `no-bare-set-in-store`
(innerhalb `lib/store/**`).

```ts
useAppStore.getState().recordingSet(
  'Add Clip',
  (draft) => {
    draft.timeline.clips.push(newClip);
  }
);
```

#### Optionen

- `coalesce: true` — Fold in den vorherigen History-Entry, **nur wenn**
  das Label exakt matched (Architekt-W8). Drag-Beispiel:
  PointerDown → recordingSet('Move Clip', ..., { coalesce:true }).
  PointerMove × 60 → ebenfalls `'Move Clip'` mit coalesce. PointerUp
  fügt nichts hinzu. Ergebnis: **1 Undo pro Drag**, nicht 60.

  **Kritisch (Architekt-B1)**: beim coalesce mit Label-Match wird KEIN
  neuer Snapshot gemacht. Der pre-drag-Snapshot in `past[last]`
  bleibt. Undo springt auf die Position VOR dem Drag, nicht in die
  Mitte.

- `skip: true` — kein History-Entry. Für transiente State-Updates
  (Playhead, MobileTab, R2-MediaRefs, etc.) zwingend mit
  Inline-Kommentar warum.

### `useAppStore.getState().undo()` / `.redo()` / `.clearHistory()`

`clearHistory` ist Pflicht an Projekt-Grenzen: `applySerializedProject`
und `NewProjectButton` rufen es, damit Ctrl+Z nicht silently durch zwei
Projekte rollt.

---

## Migrations-Tabelle — was wird recorded, was nicht

| Action | Verhalten | Begründung |
|---|---|---|
| `addClip` | record | Label: `"Add ${clip.kind}"` (Tooltip-Info) |
| `removeClip` | record | "Delete Clip" |
| `moveClip` | record + coalesce | "Move Clip" — Drag = 1 Undo |
| `resizeClip` | record + coalesce | "Resize Clip" — Drag = 1 Undo |
| `setClipParams` / `setClipParam` | record + coalesce | "Clip Params" |
| `setPlayhead` | **skip** | 60×/s — würde Stack fluten |
| `setMuted` | record + coalesce | "Mute Track" — Architekt-L2: schnelles Toggling = 1 Undo |
| `addTrack` / `removeTrack` / `reorderTracks` | record | je eigenes Label |
| `setTrackLabel` | record + coalesce | "Rename Track" — Tippen = 1 Undo |
| `convertParamToAutomation` / `convertParamToStatic` | record | "Enable Automation" |
| `addParamPoint` / `removeParamPoint` / `updateParamPoint` | record + coalesce | "Edit Automation" |
| `updateParamPoints` (batch) | record + coalesce | "Edit Automation" |
| `setParamInterpolation` / `setBlendInterpolation` | record | "Blend Interpolation" |
| `clearAllTracks` | record | "Clear All Tracks" |
| `replaceMainVideoClips` | **skip** | Architekt-L3: R2-konsistent. Caller (SceneFlow-Transfer) wipt Stack via `clearHistory()` |
| `setBPM` | record | "Change BPM" — User-Action |
| `setDetectedGrid` | **skip** | Engine-Output (`source: 'detected'`) |
| `resetGrid` | record | "Reset Grid" |
| `addMediaRef` / `removeMediaRef` / `addMediaRefMeta` | **skip** | R2-gebunden — Undo würde R2-Blobs verwaisen |
| `setVideoLoadProgress` | **skip** | Engine-Output, transient |
| `purgeSceneflowMediaRefs` | **skip** | R2-gebunden |
| `setMobileTab` | **skip** | UI-Mode, transient |
| `setAppMode` | **skip** | Top-level Workspace-Mode, transient |

### Externe Caller (außerhalb `lib/store/**`)

| Datei | Behandlung |
|---|---|
| `components/TopBar/NewProjectButton.tsx` | `recordingSet('New Project', mut, { skip:true })` + `clearHistory()` — Projekt-Reset ist nicht undobar |
| `components/TopBar/Transport.tsx` | `recordingSet('Play'/'Pause'/'Stop', mut, { skip:true })` — Playback-State ist transient |
| `lib/project/deserialize.ts` | `recordingSet('Load Project', mut, { skip:true })` + `clearHistory()` — Load ist nicht undobar |
| `components/SceneFlow/GenerationControls.tsx` (Transfer) | nach Erfolg: `clearHistory()`. Confirm-Modal warnt explizit "kann nicht rückgängig gemacht werden" |

---

## Was NICHT im Snapshot ist (und warum)

| Feld | Grund |
|---|---|
| `timeline.playhead` | Architekt-D3/L4: DAW-Standard. Undo soll Clip-Struktur restoren, nicht die Scrub-Position. Bei Undo bleibt der aktuelle Playhead erhalten. |
| `ui.*` | UI-Selection / Zoom / Modal-State sind transient. Undo soll nicht die Auswahl resetten. |
| `media.*` | R2-Blobs werden nicht reverted. Würde verwaiste R2-Files erzeugen. |
| `mobileUI`, `appMode` | UI-Mode, nicht inhaltlich. |
| `audio.engine`-State | Lebt außerhalb von Zustand. |

---

## Bekannte Limitierungen

- **Stack überlebt keinen Reload** — `history` ist nicht in
  `partialize`. Architekt-Entscheidung: persistente Undo-Stacks blasen
  localStorage auf und schaffen mehr Edge-Cases als sie wert sind.
  Siehe `docs/KNOWN_LIMITATIONS.md`.
- **RAM-Footprint**: 100 Snapshots × ~1 MB worst-case = ~100 MB
  obergrenze. Akzeptierter Trade-off.
- **R2-Skip ist absichtlich**: ein zukünftiges `restoreMediaRef`-System
  wäre die Voraussetzung dafür media-Aktionen zu recorden.
- **Cross-Drag-Coalesce**: zwei Drags hintereinander mit gleichem Label
  (z.B. zwei aufeinanderfolgende Moves desselben Clips ohne Pause)
  würden coalescen. In der Praxis trennt PointerUp die Drags — der
  Label-Match bleibt aktiv, aber zwischen den Drags kann eine andere
  Aktion (Select) einen Label-Wechsel triggern. Wenn das ein Problem
  wird, ein PointerDown-Reset für coalesce einbauen.

---

## Tests

`tests/unit/store/undo-redo.test.ts` (19 Tests) deckt:
- record/snapshot beim ersten Mutate
- past/future-Movement
- Future-Invalidation bei neuer Aktion
- Playhead-Preservation
- `skip:true` als No-Op-für-History
- Coalesce mit Label-Match + Coalesce-Block bei Label-Mismatch
- MAX_HISTORY-Cap
- `clearHistory` 
- Empty-Stack-No-Ops
- BPM-Undo (audio-scope)
- Media/Mobile/AppMode-Skip
- Deep-Clone-Isolation
- Multi-Round-Trip
- Persist-Exclude (history fehlt im localStorage-Dump)

`tests/unit/store/eslint-no-direct-set.test.ts` (2 Tests) validiert
beide Custom-Rules positiv + negativ.

`tests/unit/components/UndoRedoButtons.test.tsx` (4 Tests) deckt
Disabled-State, Tooltip-Label, Click-Wiring beide Richtungen.

---

## ESLint-Guardrails

`eslint-local-rules.js` definiert:

- **`no-direct-set-state`** — verbietet `useAppStore.setState(...)`
  ÜBERALL außer in `tests/**`. Migration: durch
  `useAppStore.getState().recordingSet(label, mut, opts)` ersetzen.

- **`no-bare-set-in-store`** — verbietet `set(...)` innerhalb
  `lib/store/**`. Whitelist: `recording-set.ts` (baut den Wrapper)
  und `history-actions.ts` (`undo`/`redo`/`clearHistory` müssen
  bypassen). `lib/hooks/useCurrentProject.ts` ist ein eigener
  Zustand-Store außerhalb `lib/store/`, der nicht betroffen ist.

---

## Plan-Template-Erweiterung

Ab Plan 10 muss jeder zukünftige Plan eine `## Undo-Behaviour`-Sektion
führen, in der für jede neue store-mutierende Action festgelegt wird:

- `record` (mit Label) — Aktion landet im Undo-Stack
- `record + coalesce` (mit Label) — Aktion foldet bei Repeats
- `skip` — keine History-Entry; Begründung notwendig
- `clearHistory` nach Action — bei Projekt-Boundary-Operationen

Damit bleibt die Migrations-Tabelle in diesem Doc vollständig und
konsistent.
