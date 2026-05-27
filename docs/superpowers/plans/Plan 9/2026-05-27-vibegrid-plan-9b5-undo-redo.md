# CC #1 Prompt — Plan 9b.5: Undo / Redo

**Globale Undo/Redo-Infrastruktur mit ESLint-Enforcement.**
Ab diesem Plan kann keine neue Funktion mehr ohne Undo gebaut werden —
der Build bricht wenn jemand es versucht.

Baseline: HEAD post-Plan-9b (1217 Tests, Store v7).

Schreibe nur den **Plan** — noch keinen Code.

---

## Schritt 0 — Codebase lesen (PFLICHT)

1. `lib/store/timeline-slice.ts` — alle direkten `set()`-Calls auflisten:
   - Wie viele gibt es aktuell?
   - Welche sind mutierende Actions (müssen auf `recordingSet` migriert werden)?
   - Welche sind transient/UI (bleiben als `set()`)?

2. `lib/store/types.ts` — Slice-Struktur:
   - Ist `AutomationCurve`-State in `TimelineState` enthalten oder in
     einem eigenen Slice?
   - Exakte Namen aller State-Slices die bei einem Undo wiederhergestellt
     werden müssen

3. `lib/store/index.ts` — Store-Setup:
   - Wie ist `set` aktuell typisiert?
   - Gibt es bereits eine Middleware-Chain?

4. `components/Workspace/Timeline/index.tsx` (oder Tracks.tsx) —
   Keyboard-Handler:
   - Wo sind aktuell Ctrl+Z / Ctrl+Y / Escape registriert (falls vorhanden)?

5. Aktuelle Test-Zahl notieren.

---

## Architektur-Übersicht

```
┌─────────────────────────────────────────────────┐
│  User-Action (Drag, Delete, Apply Preset, ...)   │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
          recordingSet(label, mutator, options?)
                     │
          ┌──────────┴──────────┐
          │  Snapshot aktueller  │  →  history.past.push(entry)
          │  TimelineState +     │      history.future = []
          │  AutomationState     │
          └──────────┬──────────┘
                     │
                     ▼
               Store-Mutation
                     │
                     ▼
          React Re-Render (wie heute)

  Ctrl+Z  →  undo(): past.pop() → State restore → future.push()
  Ctrl+Y  →  redo(): future.pop() → State restore → past.push()
```

---

## Datenmodell

### HistoryEntry

```ts
// lib/store/history-types.ts  (NEU)

interface HistoryEntry {
  // Scope: exakt die Slices die Undo wiederherstellt
  // CC #1 füllt die echten Slice-Namen nach Schritt-0-Fund aus
  timeline: TimelineState
  automation: AutomationState     // falls eigener Slice — sonst weglassen
  label: string                   // "Move 4 Clips", "Delete", "Apply Preset"
  timestamp: number
}

interface HistoryState {
  past: HistoryEntry[]    // Index 0 = älteste, last = jüngste
  future: HistoryEntry[]  // Index 0 = nächstes Redo-Target
}

const MAX_HISTORY = 100
```

### recordingSet — der einzige Mutationspfad

```ts
// lib/store/recording-set.ts  (NEU)

interface RecordingOptions {
  /**
   * coalesce: true → überschreibt den letzten History-Entry statt einen
   * neuen zu erzeugen. Für Drag-Interactions (Slider, Automation-Punkt).
   * Der Caller ruft coalesce: false bei PointerDown (Snapshot vor Drag)
   * und coalesce: true bei jedem PointerMove auf.
   */
  coalesce?: boolean

  /**
   * skip: true → keine History-Aufzeichnung (für transiente UI-Mutations
   * die bewusst nicht undobar sein sollen).
   * Muss explizit begründet werden — nicht als Lazy-Opt-out verwenden.
   */
  skip?: boolean
}

function makeRecordingSet(set: ZustandSet<AppState>) {
  return function recordingSet(
    label: string,
    mutator: (draft: AppState) => void,
    options: RecordingOptions = {}
  ): void {
    set((state) => {
      // Skip: transient UI, kein History-Eintrag
      if (options.skip) {
        mutator(state)
        return
      }

      const entry: HistoryEntry = {
        timeline: structuredClone(state.timeline),
        // automation: structuredClone(state.automation),  // falls eigener Slice
        label,
        timestamp: Date.now(),
      }

      mutator(state)

      if (options.coalesce && state.history.past.length > 0) {
        // Letzten Entry überschreiben — kein neuer Stack-Eintrag
        state.history.past[state.history.past.length - 1] = entry
      } else {
        state.history.past.push(entry)
        if (state.history.past.length > MAX_HISTORY) {
          state.history.past.shift()
        }
      }

      state.history.future = []
    })
  }
}
```

### undo / redo Actions

```ts
// lib/store/history-actions.ts  (NEU)

undo(): void {
  set((state) => {
    if (state.history.past.length === 0) return

    const current: HistoryEntry = {
      timeline: structuredClone(state.timeline),
      // automation: structuredClone(state.automation),
      label: 'current',
      timestamp: Date.now(),
    }

    const prev = state.history.past.pop()!
    state.history.future.unshift(current)

    state.timeline = prev.timeline
    // state.automation = prev.automation
  })
}

redo(): void {
  set((state) => {
    if (state.history.future.length === 0) return

    const current: HistoryEntry = {
      timeline: structuredClone(state.timeline),
      // automation: structuredClone(state.automation),
      label: 'current',
      timestamp: Date.now(),
    }

    const next = state.history.future.shift()!
    state.history.past.push(current)

    state.timeline = next.timeline
    // state.automation = next.automation
  })
}
```

---

## ESLint-Enforcement — kein direktes set() in timeline-slice

Das ist der wichtigste Teil dieses Plans. **Ab Plan 9b.5 ist es technisch
unmöglich, eine neue Store-Mutation ohne Undo zu bauen** — der Build bricht.

### Custom ESLint-Rule

```ts
// eslint-rules/no-direct-set-in-store.js  (NEU)

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Direct set() calls in timeline-slice are forbidden. ' +
        'Use recordingSet() to ensure Undo/Redo support. ' +
        'For transient UI mutations, use recordingSet(label, fn, { skip: true }).',
    },
    messages: {
      noDirectSet:
        'Direct set() call detected in Store-Slice. ' +
        'Use recordingSet() instead. ' +
        'See docs/architecture/undo-redo.md',
    },
  },
  create(context) {
    const filename = context.getFilename()
    // Nur in Store-Slices enforced
    if (!filename.includes('lib/store/')) return {}

    return {
      CallExpression(node) {
        if (
          node.callee.name === 'set' &&
          // recordingSet selbst ist erlaubt (enthält set intern)
          !filename.includes('recording-set.ts') &&
          // history-actions.ts darf set() für undo/redo direkt nutzen
          !filename.includes('history-actions.ts')
        ) {
          context.report({ node, messageId: 'noDirectSet' })
        }
      },
    }
  },
}
```

### .eslintrc Einbindung

```json
{
  "plugins": ["local-rules"],
  "rules": {
    "local-rules/no-direct-set-in-store": "error"
  }
}
```

### Migration bestehender set()-Calls

Schritt 0 liefert die vollständige Liste. Jeder bestehende `set()`-Call
in `timeline-slice.ts` wird auf `recordingSet` migriert:

```ts
// Vorher:
set((state) => { state.timeline.clips.push(newClip) })

// Nachher:
recordingSet('Add Clip', (state) => { state.timeline.clips.push(newClip) })

// Für transiente UI-Mutations (z.B. Playhead-Position):
recordingSet('', (state) => { state.timeline.playhead = beat }, { skip: true })
```

**Wichtig:** `skip: true` braucht einen Kommentar im Code warum diese
Mutation bewusst nicht undobar ist.

---

## Keyboard-Wiring

In bestehendem Keyboard-Handler (Tracks.tsx oder Timeline/index.tsx):

```ts
if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
  if (document.activeElement?.tagName === 'INPUT' ||
      document.activeElement?.tagName === 'TEXTAREA') return
  e.preventDefault()
  if (e.shiftKey) state.redo()
  else            state.undo()
  return
}
if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
  if (document.activeElement?.tagName === 'INPUT' ||
      document.activeElement?.tagName === 'TEXTAREA') return
  e.preventDefault()
  state.redo()
  return
}
```

---

## Coalescing — Drag-Interactions

Alle bestehenden Drag-Interactions (Slider im Inspector,
Automation-Punkt-Drag, Clip-Move, Clip-Resize) werden auf
Coalescing umgestellt:

```ts
// PointerDown → normaler recordingSet (Snapshot vor Drag):
recordingSet('Move Clip', (state) => { /* Preview-Start */ })

// PointerMove → coalesce: true (kein neuer Stack-Eintrag):
recordingSet('Move Clip', (state) => { /* aktuelle Position */ }, { coalesce: true })

// PointerUp → letzter coalesce: true (finaler State):
recordingSet('Move Clip', (state) => { /* Snap-gerundete Position */ }, { coalesce: true })
```

Ergebnis: Ein Clip-Drag = 1 Undo-Eintrag, egal wie lange der Drag dauert.

---

## Undo-Label-Konventionen

| Action | Label |
|---|---|
| Clip verschieben (1) | `"Move Clip"` |
| Clips verschieben (N) | `"Move {N} Clips"` |
| Clip löschen | `"Delete Clip"` |
| Clips löschen (N) | `"Delete {N} Clips"` |
| Clip duplizieren | `"Duplicate {N} Clips"` |
| Clip hinzufügen | `"Add {FxKind}"` |
| Preset-Pack anwenden | `"Apply Pack: {name}"` |
| Clip-Param ändern | `"{ParamName}"` (z.B. `"Intensity"`) |
| Automation-Punkt | `"Edit Automation"` |
| Clip resizen | `"Resize Clip"` / `"Resize {N} Clips"` |

---

## WorkspaceHeader — Undo/Redo Buttons (optional, Plan-NN-UI)

Minimal-UI im WorkspaceHeader:

```tsx
// Undo-Button disabled wenn history.past.length === 0
// Redo-Button disabled wenn history.future.length === 0
// Tooltip: "Undo: {last entry label}" / "Redo: {next entry label}"
```

Visuell: zwei Icon-Buttons (↩ ↪), kein Panel.
Das ist in-scope für diesen Plan — keine eigene Session nötig.

---

## Plan-Template-Erweiterung (ab Plan 9b.5 gilt für ALLE zukünftigen Pläne)

Jeder zukünftige Plan bekommt einen Pflicht-Abschnitt:

```markdown
## Undo-Behaviour

| Action | recordingSet label | coalesce | skip |
|---|---|---|---|
| [Action A] | "[Label]" | nein | nein |
| [Action B] | "[Label]" | ja (Drag) | nein |
| [UI-Mutation X] | — | — | ja — [Begründung] |
```

Pläne ohne diesen Abschnitt werden vom Architekt nicht freigegeben.

---

## Verification Gate — Erweiterung (ab Plan 9b.5)

CC #2 ergänzt bei jedem QA-Report:

```powershell
# Kein direktes set() in Store-Slices (außer erlaubte Dateien)
git diff main --name-only | Where-Object { $_ -match "lib/store/" } |
  ForEach-Object { Select-String -Path $_ -Pattern "\bset\(" }
# → Ergebnis muss leer sein (außer recording-set.ts + history-actions.ts)
```

Wenn dieser Check Treffer liefert: Plan nicht freigegeben, unabhängig von
allen anderen Gates.

---

## Dateien

| Datei | Art |
|---|---|
| `lib/store/history-types.ts` | NEU — HistoryEntry, HistoryState, MAX_HISTORY |
| `lib/store/recording-set.ts` | NEU — makeRecordingSet, RecordingOptions |
| `lib/store/history-actions.ts` | NEU — undo(), redo() |
| `lib/store/timeline-slice.ts` | MODIFY — alle set()-Calls → recordingSet migrieren |
| `lib/store/index.ts` | MODIFY — HistoryState einbinden, recordingSet initialisieren |
| `eslint-rules/no-direct-set-in-store.js` | NEU — Custom ESLint-Rule |
| `.eslintrc` (o.ä.) | MODIFY — Rule einbinden |
| `components/Workspace/Timeline/index.tsx` | MODIFY — Ctrl+Z/Y Keyboard-Wiring |
| `components/WorkspaceHeader/UndoRedoButtons.tsx` | NEU — Icon-Buttons |
| `docs/architecture/undo-redo.md` | NEU — Architektur-Doku + Konventionen |

---

## Tests

### Unit-Tests `__tests__/unit/store/undo-redo.test.ts` — ≥ 12

- `recordingSet`: erzeugt History-Entry in `past`
- `recordingSet`: leert `future` nach jeder Mutation
- `recordingSet` mit `coalesce: true`: kein neuer Entry, letzter wird überschrieben
- `recordingSet` mit `skip: true`: kein History-Entry
- `undo()`: stellt vorherigen State wieder her
- `undo()`: verschiebt aktuellen State in `future`
- `undo()` auf leerem Stack: kein Fehler, State unverändert
- `redo()`: stellt nächsten State wieder her
- `redo()` auf leerem future: kein Fehler
- Sequenz: Mutation → Undo → State identisch mit vor Mutation
- Sequenz: Mutation A → Mutation B → Undo → Undo → State = Ausgangszustand
- Sequenz: Mutation → Undo → neue Mutation → `future` ist leer
- Bounded History: > MAX_HISTORY Einträge → ältester wird verworfen

### Unit-Tests `__tests__/unit/eslint/no-direct-set.test.ts` — ≥ 3

- Direktes `set(` in `lib/store/timeline-slice.ts` → ESLint-Error
- `recordingSet(` in `lib/store/timeline-slice.ts` → kein Error
- `set(` in `lib/store/recording-set.ts` → kein Error (Whitelist)

### Integration-Tests — ≥ 3

- Clip-Move via `moveClip` → Undo → Clip zurück auf Ausgangsposition
- Group-Delete → Undo → alle Clips wiederhergestellt
- Slider-Drag (coalesce) → 1 Undo-Eintrag statt N

Mindest: **≥ 18 neue Tests**

---

## Commit-Struktur

```
feat(store): history-types — HistoryEntry + HistoryState + MAX_HISTORY
feat(store): recording-set — makeRecordingSet mit coalesce + skip support
feat(store): history-actions — undo() + redo()
feat(store): migrate all set() calls to recordingSet in timeline-slice
feat(store): wire HistoryState into store root + recordingSet init
feat(eslint): no-direct-set-in-store custom rule + .eslintrc integration
feat(keyboard): Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z wiring
feat(ui): UndoRedoButtons in WorkspaceHeader
docs: undo-redo architecture + label conventions
test: undo-redo unit + eslint + integration
```

10 Commits. Jeder Commit: ein Concern.

---

## Nicht vergessen

- `structuredClone` ist in Node 17+ und allen modernen Browsern verfügbar —
  kein Polyfill nötig
- `skip: true` Mutations brauchen **immer** einen Kommentar warum
- Die ESLint-Rule muss in `npm run lint` laufen — CC #2 prüft das im Gate
- Automation-Kurven Scope: CC #1 klärt in Schritt 0 ob eigener Slice →
  `HistoryEntry` entsprechend anpassen
- Store-Version bleibt v7 — `HistoryState` ist transient, nicht persistiert
  (kein Undo über Page-Reload hinweg)

---

## Ab jetzt gilt: kein neues Feature ohne Undo-Behaviour-Abschnitt im Plan

Der Architekt gibt keinen Plan frei der keinen `## Undo-Behaviour`-Abschnitt
hat. CC #2 prüft bei jedem QA ob neue `set()`-Calls existieren.
Das ist nicht optional.

---

Rev. 1 — bereit für Architekt-Review
