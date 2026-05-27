# Undo / Redo — Aktueller Stand

> Stand: post-Plan-9b (2026-05-27)

## TL;DR

**Es gibt keinen Undo-Stack.** Weder Ctrl+Z noch Ctrl+Y sind verkabelt,
weder im Store noch in der UI. Was im Code unter "Undo/Redo" referenziert
wird, sind **Vorsichtsmaßnahmen** — Stellen, an denen Plan-Autoren bewusst
designt haben damit ein zukünftiges Undo-System sauber funktionieren wird,
sobald es eingeführt wird.

Dieses Dokument ist die Bestandsaufnahme — was steht, was fehlt, was die
nächste Iteration einbauen müsste.

---

## Was im Code steht (Bestandsaufnahme)

### `lib/store/timeline-slice.ts:361`

```
// PRESERVED (only startBeat + lengthBeats mutate) — Undo/Redo,
```

Im Kontext von `replaceMainVideoClips`: bei einer BPM-Änderung werden
Main-Video-Clip-Positionen rekalkuliert, aber **clip.id bleibt stabil**.
Reason: falls später ein Undo-Stack existiert, der pro Aktion die geänderten
Clip-IDs vermerkt, könnte er die "vor"-Position aus dem History-Entry
zurückspielen. Mit instabilen IDs wäre Undo nicht möglich.

### `lib/store/types.ts:95`

```ts
/** ... clip.id stays stable so Undo/Redo + FX bindings + JSONB persistence
 *  survive. */
```

Im Kontext von `replaceMainVideoClips`-Typ — gleiche Begründung.

### `lib/presets/apply-pack.ts:18`

```
* manually; full Undo-History stays intact.
```

Im Kontext von Preset-Pack-Apply: die Operation ist eine einzige Store-
Mutation, damit ein zukünftiges Undo den Apply als **ein** Schritt
rückgängig macht (nicht als N Mikro-Mutations).

### `lib/store/index.ts:146`

```
// a future undo/redo layer collapses the whole group action to one
```

Im Kontext von Plan-9b's `moveSelectedClips` / `resizeSelectedClips` /
`duplicateSelectedClips` / `deleteSelectedClips`: jede Group-Aktion ist
**eine atomare `set()`-Mutation**. Architekt-Decision B5: Ctrl+Z auf einem
Group-Move muss 1 Undo sein, nicht N.

### `components/Workspace/Timeline/SyncAudioDropZone.tsx:20`

```
* replaceMainVideoClips (clip.ids preserved for Undo/Redo safety).
```

Gleiches Pattern wie oben — Stable-ID-Garantie für `replaceMainVideoClips`.

---

## Was die Vorbereitung ermöglicht (Architekturelle Garantien)

Diese Eigenschaften sind im aktuellen Code **bereits eingehalten** und
würden Undo direkt unterstützen, sobald der Stack eingeführt wird:

1. **Stable Clip-IDs**
   - Plan 8d's `replaceMainVideoClips` ändert nur `startBeat` + `lengthBeats`,
     nie die `id`.
   - Plan 9b's `duplicateSelectedClips` generiert frische IDs für Kopien,
     mutiert nie bestehende.
   - FX-Bindings (`clip.fxId`), Automation-Kurven (per `clipId`-key) und
     R2-MediaRef-Bindings bleiben über Mutationen stabil.

2. **Atomare Store-Mutationen für Multi-Item-Ops**
   - Plan-9a `applyPack` → ein `set()`.
   - Plan-9b `moveSelectedClips` / `resizeSelectedClips` /
     `duplicateSelectedClips` / `deleteSelectedClips` → je ein `set()`.
   - Plan-9b `clearAllTracks` → ein `set()`.
   - Bedeutet: 1 User-Action == 1 zustand-State-Transition == 1
     potentieller Undo-Schritt.

3. **Pure Functions in `lib/timeline/operations.ts`**
   - `addClip`, `moveClip`, `resizeClip`, `removeClip`, `setClipParams`,
     `setPlayhead`, `setMuted` sind alle reine `(state, args) => newState`.
   - Kein I/O, kein UUID, kein Side-Effect.
   - Bedeutet: ein Undo-System könnte den vorherigen `TimelineState`
     direkt einsetzen, ohne dass Operations "rückgängig" gemacht werden
     müssen — nur State-Snapshots austauschen.

4. **JSONB-Persistierung via `toPersistedShape`**
   - `lib/store/persist-shape.ts` definiert eine flache Snapshot-Shape.
   - Ein zukünftiges Undo-System könnte dieselben Snapshots in einem
     Stack speichern.

5. **Transient UI-Selection (Plan 9b)**
   - `ui.selectedClipIds` ist **nicht** persistiert.
   - Wenn ein Undo-Stack auch Selektions-State sichern soll, ist das
     bewusste Entscheidung — kein Auto-Restore beim Reload.

---

## Was fehlt (für eine echte Undo-Implementation)

Ein Plan-NN müsste folgendes einführen:

### 1. History-Slice im Store

```ts
interface HistoryEntry {
  timeline: TimelineState;
  // Optional: UI-Selection-Snapshot
  selectedClipIds: string[];
  // Optional: Label für UI-Tooltip ("Undo Move", "Undo Duplicate")
  label?: string;
  timestamp: number;
}

interface HistoryState {
  past: HistoryEntry[];   // Vor der jetzigen Aktion
  future: HistoryEntry[]; // Nach Undo, vor Redo
}
```

### 2. History-Recording bei jeder mutierenden Action

Pattern A — Wrapper:
```ts
function recordingSet(label: string, mutator: (s: AppState) => Partial<AppState>) {
  set((s) => {
    const entry: HistoryEntry = {
      timeline: s.timeline,
      selectedClipIds: s.ui.selectedClipIds,
      label,
      timestamp: Date.now()
    };
    const next = mutator(s);
    return {
      ...next,
      history: {
        past: [...s.history.past, entry].slice(-MAX_HISTORY),
        future: []
      }
    };
  });
}
```

Pattern B — Middleware:
- zustand `subscribeWithSelector` o.ä. hooked auf `timeline`-Änderungen
- Push automatisch auf history.past
- Skip wenn die Änderung selbst aus Undo/Redo kommt (flag)

Pattern A ist explicit (Caller wählt welche Aktionen recorded werden),
Pattern B ist automatisch (alle timeline-Mutations).

### 3. Undo / Redo Actions

```ts
undo(): void
// → past.pop() → setze State, push aktueller State auf future
redo(): void
// → future.pop() → setze State, push aktueller State auf past
```

### 4. Keyboard-Wiring

In Plan-9b's existing Keyboard-Handler (`Tracks.tsx:118`):
```ts
if (cmd && (e.key === 'z' || e.key === 'Z')) {
  if (e.shiftKey) state.redo();
  else            state.undo();
  e.preventDefault();
  return;
}
if (cmd && (e.key === 'y' || e.key === 'Y')) {  // Windows-Convention
  state.redo();
  e.preventDefault();
  return;
}
```

### 5. UI-Affordance (optional)

- Tooltip im WorkspaceHeader: "Undo: Move 4 clips" / "Redo: Duplicate"
- Disabled-State wenn `past.length === 0` / `future.length === 0`
- Plan 9b's Out-of-Scope erwähnte schon "Undo-History-Panel" — wäre
  dieser Schritt.

### 6. Bounded History

Memory-Schutz: max 50–100 Einträge im `past`. Älteste werden
ausgeworfen (Slice oben).

Pro Entry kostet ein Snapshot ~5–20 KB für 50–100 Clips. 100 Entries × 20 KB
= 2 MB — akzeptabel im RAM, nicht persistiert.

### 7. Out-of-Scope-Entscheidungen

- **Audio-Engine-State**: nicht im Undo (lebt außerhalb von zustand,
  Plays/Pauses sind transient).
- **WebGL-Quality-Pin**: nicht im Undo (localStorage-Preference, kein
  Workflow-Schritt).
- **MediaLibrary-Refs**: nicht im Undo (Upload-Operationen sind
  externe-Side-Effects gegen R2; rückgängig machen ist nicht sinnvoll).
- **Snap-Picker-Wert**: nicht im Undo (UI-Preference).

Empfehlung: Undo-Scope ist **`timeline` + optional `ui.selectedClipIds`**.
Alles andere bleibt unangetastet.

---

## Wann Plan-NN sinnvoll wäre

- **Niedrige Priorität**: aktuelle UX kommt ohne Undo aus, weil Mutationen
  klein sind (Drag/Resize/Click) und Fehler über erneute Drag-Aktionen
  korrigierbar sind.
- **Steigende Priorität** bei:
  - Multi-Select-Operationen (Plan 9b shipped) — Group-Delete von 20
    Clips ohne Undo ist riskant.
  - Preset-Pack-Apply (Plan 9a) — überschreibt mehrere FX-Tracks.
  - Future Bulk-Imports / Bulk-Operations.

Wenn User-Feedback "ich habe versehentlich gelöscht und keinen Undo" ein
wiederkehrendes Muster wird → Plan-NN mit voller Implementation.

---

## Was Plan-9b's Architekt-Decision B5 garantiert

> "moveSelectedClips, resizeSelectedClips und duplicateSelectedClips sind
> je eine atomare Store-Mutation — alle Clips in einem einzigen
> Immer-Produce-Call, ein History-Entry."

→ Genau diese Garantie ist **eingehalten**. Sobald Undo eingeführt wird,
sind diese 4 Aktionen je 1 Undo-Schritt, nicht N. Der Schmerz ist
vermieden bevor der Stack steht.

---

## Verwandte Docs

- `docs/architecture/export-pipeline.md` — andere Architektur-Bestandsaufnahme.
- `docs/KNOWN_LIMITATIONS.md` — enthält Plan-9b-Eintrag mit Verweis auf
  atomare Mutationen.
- `docs/superpowers/plans/Plan 9/2026-05-27-vibegrid-architekt-entscheidung-9b.md` —
  Architekt-Decision B5 (Original-Begründung).
