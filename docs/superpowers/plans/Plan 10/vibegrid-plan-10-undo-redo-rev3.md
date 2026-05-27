# CC #1 Prompt — Plan 10: Undo / Redo (Rev. 3)

> **Status:** ✅ Architekt-freigegeben — Implementation-Ready.
>
> Rev. 3 adressiert alle 4 Blocker, 9 Wackler und 7 Doku-Lücken aus
> dem CC#1-Pre-Review, plus alle 4 Mikro-Entscheidungen (L1–L4) aus
> dem Architekt-Addendum 2, plus Bug 1 + W1 + W2 aus dem Rev.-2-Review,
> plus die Whitelist-Beobachtung aus dem Rev.-3-Feedback:
> `lib/store/index.ts` ist NICHT in der ESLint-Whitelist (strikte
> Default-Position — schließt ein zukünftiges Regression-Gap, falls
> jemand später direkte `set()`-Calls dort einbaut).

Baseline: HEAD post-Plan-8f + 9b + Contour-Perf-Fix (**1254 Tests, Store v6**).
Plan-Nummer: **Plan 10** (Promotion von 9b.5 — eigenständiger Architektur-Eingriff,
Plan-Template-Erweiterung gilt permanent).

---

## Schritt 0 — Codebase lesen (PFLICHT)

1. `lib/store/timeline-slice.ts` — alle direkten `set()`-Calls auflisten
   und gegen die Migrations-Tabelle (Sektion 9) prüfen. Erwartet:
   alle `record`-Aktionen werden auf `recordingSet` migriert; alle
   `skip`-Aktionen bekommen `{ skip: true }` mit Inline-Begründung.

2. `lib/store/index.ts` — wie ist `set` aktuell typisiert? Wie viele
   Top-Level-Actions gibt es (Plan 9b hat selectClips, addToSelection,
   clearSelection, moveSelectedClips, resizeSelectedClips,
   duplicateSelectedClips, deleteSelectedClips hinzugefügt — alle
   müssen migriert werden).

3. `lib/store/types.ts` — `UIState`, `TimelineState`, `AudioState`,
   `MediaState`, `AppState`-Struktur. Welche Felder dürfen NICHT im
   History-Snapshot sein? (playhead — siehe L4; transiente fields
   wie `flowMode`, `selectedClipIds`, `clipSnap` ebenfalls).

4. `components/Workspace/Timeline/Tracks.tsx` (oder Tracks/index.tsx) —
   wo ist der existierende Keyboard-Handler (Plan 9b Escape/Ctrl+A/
   Delete/Ctrl+D)? Erweitere ihn um Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
   im selben Effect (input-guard schon vorhanden).

5. `components/Workspace/WorkspaceHeader.tsx` — Layout-Struktur für
   die neuen Undo/Redo-Buttons links neben dem VibeGrid-Logo.

6. 4 externe `useAppStore.setState`-Caller bestätigen (post-Plan-9b
   nochmal grep):
   - `components/TopBar/NewProjectButton.tsx`
   - `components/TopBar/Transport.tsx`
   - `components/Workspace/Timeline/Toolbar.tsx`
   - `lib/project/deserialize.ts`

7. Aktuelle Test-Zahl: **1254** (Baseline für Rev. 2 Verification Gate).

8. `package.json` — `immer` ist NICHT installiert. Plan installiert
   es als runtime-Dependency.

---

## Architektur-Übersicht

```
┌──────────────────────────────────────────────────────────┐
│ User-Action (Drag, Delete, Apply Preset, …)              │
│                                                          │
│   - In-Store-Action:   recordingSet(label, mutator, opts)│
│   - External Caller:   useAppStore.getState()            │
│                        .recordingSet(label, mutator, opts)│
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
         recordingSet  (Architekt-B1 + W8 + L4 corrected)
                       │
        ┌──────────────┴──────────────┐
        │ if (skip)                    │
        │   → just mutate, no entry    │
        │                              │
        │ if (coalesce && lastLabel)   │
        │   → mutate, NO new entry,    │
        │     no new snapshot          │
        │                              │
        │ else                         │
        │   1. snapshot timeline       │
        │      WITHOUT playhead        │
        │   2. past.push(entry)        │
        │   3. past.shift() if > MAX   │
        │   4. future = []             │
        │   5. mutate                  │
        └──────────────┬──────────────┘
                       │
                       ▼
                 Immer-Middleware
                 (zustand 4.5.4 + immer)
                       │
                       ▼
                React Re-Render

  Ctrl+Z  →  undo(): past.pop()  → restore → future.push()
  Ctrl+Y  →  redo(): future.pop() → restore → past.push()
  Ctrl+Shift+Z = redo (Mac-Convention)
```

---

## Modul 1 — Immer-Middleware einführen [Architekt L1 / B2]

```bash
npm i immer
```

```ts
// lib/store/index.ts MODIFY
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { AppState } from './types'

export const useAppStore = create<AppState>()(
  persist(
    immer((set, get, store) => ({
      // … all existing slice creators
    })),
    {
      name: 'vibegrid-store',
      version: STORE_VERSION,
      // …
    }
  )
)
```

**Kompatibilität:** Immer akzeptiert beide Patterns:
- Mutator-Style: `set((draft) => { draft.ui.zoom = 1.5 })` (neuer Code)
- Return-Style: `set({ ui: { ...s.ui, zoom: 1.5 } })` (31 bestehende Calls)

Die existierenden Spread-Style-Calls bleiben unverändert. **Kein Big-Bang-Refactor.**

---

## Modul 2 — `lib/store/history-types.ts` (CREATE)

```ts
import type { TimelineState } from '@/lib/timeline/types'

/**
 * Plan 10 — Snapshot of the undobable slice of AppState.
 *
 * **Scope** (per Architekt-Decision D3 / L4):
 *   - `timeline` WITHOUT playhead (playhead stays at current position
 *     on undo — DAW-Standard, Ableton/Logic)
 *   - NOT included: ui, audio, media, mobileUI, appMode
 *     (transient OR R2-gebunden — see Migrations-Tabelle in Plan 10)
 */
export interface HistoryEntry {
  /** Deep-cloned `timeline` minus the `playhead` field. */
  timeline: Omit<TimelineState, 'playhead'>
  /** Human-readable label shown in the Undo/Redo button tooltip. */
  label: string
  /** ms since epoch — for UI tooltips ("3s ago") and debugging. */
  timestamp: number
}

export interface HistoryState {
  /** Index 0 = oldest, last = youngest (will be popped first). */
  past: HistoryEntry[]
  /** Index 0 = next redo-target (will be shifted off). */
  future: HistoryEntry[]
}

/**
 * Cap on stack size. At 100 entries × ~1 MB/snapshot (worst-case
 * 100-Clip-Timeline with automation curves), total RAM cost is
 * bounded ~100 MB. Accepted trade-off — see KNOWN_LIMITATIONS.md
 * "Undo Stack RAM Footprint" (Architekt L4).
 */
export const MAX_HISTORY = 100
```

---

## Modul 3 — `lib/store/recording-set.ts` (CREATE)

**[Fix B1, W8, D3, L4 alle adressiert.]**

```ts
import type { Draft } from 'immer'
import type { AppState } from './types'
import type { HistoryEntry } from './history-types'
import { MAX_HISTORY } from './history-types'

/**
 * Public type — exported from `lib/store/types.ts` (Quick-Win D6) so
 * the external Callers in NewProjectButton / Transport / Toolbar /
 * deserialize can import + invoke without coupling to the store
 * internals.
 */
export type RecordingSet = (
  label: string,
  mutator: (state: Draft<AppState>) => void,
  options?: RecordingOptions
) => void

export interface RecordingOptions {
  /**
   * `coalesce: true` — fold this mutation into the previous history
   * entry instead of creating a new one. **Only takes effect when
   * the previous entry has the SAME `label`** (Architekt W8) — avoids
   * accidental merge of two unrelated actions that happen to coalesce
   * back-to-back.
   *
   * Usage: PointerDown (non-coalesce, fresh snapshot) followed by N×
   * PointerMove (coalesce: true, mutate only) collapses to 1 undo
   * step per drag.
   */
  coalesce?: boolean

  /**
   * `skip: true` — bypass history entirely (transient UI mutations).
   * Caller MUST add an inline comment explaining why. Not a lazy
   * opt-out.
   */
  skip?: boolean
}

/**
 * Internal — used by `lib/store/index.ts` only. External Callers
 * invoke via `useAppStore.getState().recordingSet(…)`.
 */
type ZustandImmerSet = (
  recipe: (draft: Draft<AppState>) => void
) => void

export function makeRecordingSet(set: ZustandImmerSet): RecordingSet {
  return function recordingSet(label, mutator, options = {}) {
    set((state) => {
      // Skip — transient mutation, no history entry. Caller-owned
      // comment documents the intent.
      if (options.skip) {
        mutator(state)
        return
      }

      // Coalesce — fold into previous entry if the label matches.
      // CRITICAL (Architekt B1): when coalescing, DO NOT clone the
      // state. The pre-drag snapshot is already in past[last], we
      // just keep it. Each coalesce-mutation only advances the
      // current state; undo then jumps back to the pre-drag value.
      const past = state.history.past
      if (
        options.coalesce &&
        past.length > 0 &&
        past[past.length - 1].label === label
      ) {
        mutator(state)
        return
      }

      // Normal record — snapshot BEFORE mutating, then mutate.
      // `playhead` excluded per Architekt-D3 / L4 — undo restores
      // clip structure, not playback position.
      const { playhead: _excluded, ...timelineWithoutPlayhead } = state.timeline
      const entry: HistoryEntry = {
        timeline: structuredClone(timelineWithoutPlayhead),
        label,
        timestamp: Date.now()
      }
      past.push(entry)
      if (past.length > MAX_HISTORY) past.shift()
      // Any new action invalidates the redo stack.
      state.history.future = []

      mutator(state)
    })
  }
}
```

**Why structuredClone (not JSON.parse(JSON.stringify(…)))**:
- Preserves Date, RegExp, Set, Map (not used here, but future-proof)
- Built-in browser API since 2022, no polyfill
- Faster than JSON round-trip for plain data

---

## Modul 4 — `lib/store/history-actions.ts` (CREATE)

**[Fix Rev.-2-Review Bug 1]** — `clearHistory` lebt hier (NICHT in
`index.ts`), weil `history-actions.ts` in der ESLint-Whitelist ist
(`recording-set.ts` + `history-actions.ts`). `clearHistory` ist
konzeptionell auch eine History-Operation.

```ts
import type { Draft } from 'immer'
import type { AppState } from './types'

type ZustandImmerSet = (recipe: (draft: Draft<AppState>) => void) => void

export function makeHistoryActions(set: ZustandImmerSet) {
  return {
    undo: () => set((state) => {
      const past = state.history.past
      if (past.length === 0) return

      // Snapshot current state into `future` BEFORE restoring.
      const { playhead: _excluded, ...currentWithoutPlayhead } = state.timeline
      state.history.future.unshift({
        timeline: structuredClone(currentWithoutPlayhead),
        label: 'current',
        timestamp: Date.now()
      })

      // Restore from past, KEEPING current playhead (Architekt D3 / L4).
      const prev = past.pop()!
      const currentPlayhead = state.timeline.playhead
      state.timeline = {
        ...prev.timeline,
        playhead: currentPlayhead
      } as AppState['timeline']
    }),

    redo: () => set((state) => {
      const future = state.history.future
      if (future.length === 0) return

      const { playhead: _excluded, ...currentWithoutPlayhead } = state.timeline
      state.history.past.push({
        timeline: structuredClone(currentWithoutPlayhead),
        label: 'current',
        timestamp: Date.now()
      })

      const next = future.shift()!
      const currentPlayhead = state.timeline.playhead
      state.timeline = {
        ...next.timeline,
        playhead: currentPlayhead
      } as AppState['timeline']
    }),

    /**
     * [Rev.-2-Review Bug 1] — wipe the undo + redo stacks. Called by
     * `lib/project/deserialize.ts` after a successful project-load:
     * the previous project's history is irrelevant once a new project
     * is loaded, and keeping it would let Ctrl+Z silently revert
     * across project boundaries (catastrophic UX).
     *
     * Lives in this file (not in `index.ts`) because the ESLint
     * `no-direct-set-in-store` rule whitelists `history-actions.ts`
     * for raw `set()` use — `index.ts` is NOT whitelisted.
     */
    clearHistory: () => set((state) => {
      state.history = { past: [], future: [] }
    })
  }
}
```

---

## Modul 5 — `lib/store/types.ts` Erweiterung (W5, D6)

```ts
// lib/store/types.ts MODIFY
import type { HistoryState } from './history-types'
import type { RecordingSet } from './recording-set'

export type { RecordingSet }  // re-export für externe Caller

export interface AppState {
  // … bestehende slices
  history: HistoryState
  recordingSet: RecordingSet
  undo(): void
  redo(): void
  /** [Rev.-2-Review Bug 1] — wipe past + future stacks. Used by
   *  `lib/project/deserialize.ts` after a successful load. */
  clearHistory(): void
}
```

---

## Modul 6 — `lib/store/index.ts` Integration

```ts
// lib/store/index.ts MODIFY
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { makeRecordingSet } from './recording-set'
import { makeHistoryActions } from './history-actions'

export const useAppStore = create<AppState>()(
  persist(
    immer((set, get, store) => {
      const recordingSet = makeRecordingSet(set)
      const { undo, redo, clearHistory } = makeHistoryActions(set)
      return {
        // [W5] history-State im Initial-State
        history: { past: [], future: [] },
        recordingSet,
        undo,
        redo,
        clearHistory,  // [Rev.-2-Review Bug 1] from history-actions, not inline here

        // existing slices …
        ui: { /* … */ },
        timeline: { /* … */ },
        // …

        // [Migrations-Tabelle, siehe Sektion unten]
        // Beispiele:
        setZoom: (zoom) =>
          // Undo: transient — skip (UI-preference, no user-undo concern)
          recordingSet('Zoom', (s) => { s.ui.zoom = zoom }, { skip: true }),

        timelineActions: {
          addClip: (clip) =>
            recordingSet(`Add ${clip.kind}`, (s) => {
              s.timeline = ops.addClip(s.timeline, clip)
            }),
          // [Rev.-2-Review W2] coalesce: true — consecutive moves of
          // ANY clip fold into one undo step if no other action is
          // performed between drags. This is standard DAW behavior
          // (Ableton, Logic): a user who drags Clip A, releases, then
          // drags Clip B without intervening actions will undo both
          // in one Ctrl+Z. Label-Match (W8) is satisfied because the
          // label is the constant string "Move Clip" — any other
          // action (Delete, Add, Param change) breaks the chain.
          moveClip: (id, newStart) =>
            recordingSet('Move Clip', (s) => {
              s.timeline = ops.moveClip(s.timeline, id, newStart)
            }, { coalesce: true }),
          // … etc.
        }
      }
    }),
    {
      name: 'vibegrid-store',
      version: STORE_VERSION,  // bleibt v6 — history ist transient
      storage: createJSONStorage(() => localStorage),
      migrate,
      merge: (persisted, current) => ({
        ...current,
        ...persisted,
        // history NICHT aus persisted übernehmen — Stack ist transient
        history: { past: [], future: [] }
      }),
      partialize: (state) => toPersistedShape(state)  // history NICHT in persist-shape
    }
  )
)
```

**Hinweis zu Persist:** `toPersistedShape` in `lib/store/persist-shape.ts`
braucht KEINE Änderung — sie selektiert `ui`/`timeline`/`audio`/`media`
und ignoriert `history` implizit.

---

## Modul 7 — ESLint-Rule (B3 erweitert, D5)

```bash
npm i -D eslint-plugin-local-rules
```

```js
// eslint-rules/no-direct-set-in-store.js (CREATE)
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Direct set() / useAppStore.setState() calls bypass the Undo ' +
        'stack. Use recordingSet() (or recordingSet(…, { skip: true }) ' +
        'for documented transient mutations). See docs/architecture/' +
        'undo-stack.md.'
    },
    messages: {
      noDirectSet:
        'Direct {{kind}} bypasses the Undo stack. Use recordingSet() ' +
        'instead, or document why with { skip: true }.'
    }
  },
  create(context) {
    const filename = context.getFilename().replace(/\\/g, '/')
    // Whitelist: the store internals + history-actions need raw set().
    // [Rev.-3-Feedback] Whitelist nur die zwei Files die `set()`
    // wirklich brauchen. `index.ts` ist NICHT auf der Liste —
    // makeRecordingSet(set) und makeHistoryActions(set) sind keine
    // CallExpression-mit-callee-name-'set', daher triggert die Rule
    // dort von selbst nicht. Sollte später jemand direkte set()-Calls
    // in index.ts einbauen, soll die Rule das fangen.
    const isWhitelisted =
      filename.includes('lib/store/recording-set.ts') ||
      filename.includes('lib/store/history-actions.ts')
    if (isWhitelisted) return {}

    return {
      CallExpression(node) {
        // Case 1: raw `set(…)` inside any store slice.
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'set' &&
          filename.includes('lib/store/')
        ) {
          context.report({
            node,
            messageId: 'noDirectSet',
            data: { kind: 'set() call' }
          })
        }
        // Case 2: `useAppStore.setState(…)` anywhere in the project
        // (covers external Callers like NewProjectButton, Transport,
        // Toolbar, deserialize — they must use recordingSet now).
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'setState' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'useAppStore'
        ) {
          context.report({
            node,
            messageId: 'noDirectSet',
            data: { kind: 'useAppStore.setState() call' }
          })
        }
      }
    }
  }
}
```

```json
// .eslintrc.json (oder vergleichbar) MODIFY
{
  "plugins": ["local-rules"],
  "rules": {
    "local-rules/no-direct-set-in-store": "error"
  },
  "overrides": [
    {
      "//": "[Rev.-2-Review W1] Test-Files dürfen useAppStore.setState() direkt nutzen — beforeEach/Setup-Pattern braucht das. Production-Code: weiterhin geblockt.",
      "files": [
        "tests/**/*.ts",
        "tests/**/*.tsx",
        "**/*.test.ts",
        "**/*.test.tsx"
      ],
      "rules": {
        "local-rules/no-direct-set-in-store": "off"
      }
    }
  ]
}
```

**Begründung [Rev.-2-Review W1]:** Test-`beforeEach`-Setup nutzt
`useAppStore.setState((s) => { ... })` für reproduzierbare
Test-Fixtures. Ohne Override würde die ESLint-Rule jeden Test-Setup-
Aufruf als Error markieren. Production-Code (alles unter `lib/`,
`components/`, `app/`) bleibt strikt durch die Rule abgedeckt.

---

## Modul 8 — Migrations-Tabelle (W6, alle existing Calls)

**Pflichtfeld in jedem zukünftigen Plan ab Plan 10** (Architekt W7).

| Action | Behandlung | Label / Notes |
|---|---|---|
| `setZoom` | `skip` | UI-Preference |
| `setSelectedClipId` | `skip` | Selection ist transient |
| `selectClips`, `addToSelection`, `clearSelection` | `skip` | Selection ist transient |
| `setAutomationEditorClipId` | `skip` | UI-Modal-State |
| `setAutomationSnap` | `skip` | UI-Preference |
| `setClipSnap` | `skip` | UI-Preference (Plan 9b followup) |
| `setExportState` | `skip` | Export ist transient |
| `setFlowMode` | `skip` | UI-Toggle |
| `setPlayhead` | `skip` | 60×/s playback advance — explicitly NOT in scope (auch playhead-Feld selbst excluded aus Snapshot, siehe Modul 3) |
| `setAppMode`, `setMobileUI*` | `skip` | UI-Mode |
| `addMediaRef`, `removeMediaRef`, `addMediaRefMeta`, `setVideoLoadProgress`, `purgeSceneflowMediaRefs` | `skip` | R2-gebunden — Upload/Download nicht rückgängig machbar |
| **`moveClip`** | `record` + `coalesce` | `"Move Clip"` |
| **`resizeClip`** | `record` + `coalesce` | `"Resize Clip"` |
| **`addClip`** | `record` | `"Add ${clip.kind}"` |
| **`removeClip`** | `record` | `"Delete Clip"` |
| **`setClipParams`, `setClipParam`** | `record` + `coalesce` | `"${paramName}"` — Slider-Drag → 1 Undo-Step |
| **`moveSelectedClips`** | `record` + `coalesce` | `"Move ${N} Clips"` |
| **`resizeSelectedClips`** | `record` + `coalesce` | `"Resize ${N} Clips"` |
| **`duplicateSelectedClips`** | `record` | `"Duplicate ${N} Clips"` |
| **`deleteSelectedClips`** | `record` | `"Delete ${N} Clips"` |
| **`convertParamToAutomation`** | `record` | `"Enable Automation"` |
| **`convertParamToStatic`** | `record` | `"Disable Automation"` |
| **`addParamPoint`, `removeParamPoint`, `updateParamPoint`** | `record` + `coalesce` | `"Edit Automation"` |
| **`setParamInterpolation`, `setBlendInterpolation`** | `record` | param-named |
| **`updateParamPoints`** | `record` + `coalesce` | `"Edit Automation"` |
| **`addTrack`** | `record` | `"Add Track"` |
| **`removeTrack`** | `record` | `"Remove Track"` |
| **`reorderTracks`** | `record` | `"Reorder Tracks"` |
| **`setTrackLabel`** | `record` + `coalesce` | `"Rename Track"` — typing into the name field |
| **`setMuted`** | `record` + `coalesce` | `"Mute Track"` — Architekt L2: schnelles Toggling = 1 Undo |
| **`clearAllTracks`** | `record` | `"Clear All Tracks"` |
| **`replaceMainVideoClips`** | `skip` | Architekt L3: R2-konsistent. Caller (SceneFlow-Transfer) zeigt Pflicht-Toast: "SceneFlow Transfer abgeschlossen — kann nicht rückgängig gemacht werden." |
| **`setBPM`** | `record` | `"Change BPM"` — user-action; manual BPM-Eingabe |
| **`setDetectedGrid`** | `skip` | Engine-Output (`source: 'detected'`) — kein User-Undo-Konzern |
| **`resetGrid`** | `record` | `"Reset Grid"` |

**Externe `useAppStore.setState`-Caller (B3, L2):**

| File | Behandlung |
|---|---|
| `components/TopBar/NewProjectButton.tsx` | `recordingSet('New Project', mut, { skip: true })` — Projekt-Reset ist nicht undobar |
| `components/TopBar/Transport.tsx` | `recordingSet('', mut, { skip: true })` — Playback-State ist transient |
| `components/Workspace/Timeline/Toolbar.tsx` | Pro Aktion entscheiden — Snap/Zoom = skip |
| `lib/project/deserialize.ts` | `recordingSet('Load Project', mut, { skip: true })` — Load ist nicht undobar; clears history-stack explizit nach dem Load |

**Spezial — `deserialize.ts`:**

Nach erfolgreichem `applySerializedProject` muss die History gewipt
werden — sonst kann Ctrl+Z silently across project-boundaries reverten
(katastrophale UX). Die `clearHistory`-Action wird in
`history-actions.ts` definiert (siehe Modul 4 — ESLint-Whitelist) und
top-level in `index.ts` exponiert.

```ts
// lib/project/deserialize.ts MODIFY — nach erfolgreichem load:
useAppStore.getState().clearHistory()
```

**Wichtig [Rev.-2-Review Bug 1]:** `clearHistory` gehört in
`history-actions.ts`, NICHT inline in `index.ts`. `index.ts` ist nicht
in der ESLint-Whitelist; ein `set()`-Call dort würde die Rule sofort
brechen.

---

## Modul 9 — Keyboard-Wiring (D-FINAL aus Plan 9b)

Bestehender Keyboard-Handler in `components/Workspace/Timeline/Tracks.tsx`
(Plan 9b — Escape, Ctrl+A, Delete, Ctrl+D, Arrows) wird erweitert:

```ts
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    // existing input-guard (Plan 9b)
    const ae = document.activeElement as HTMLElement | null
    const tag = ae?.tagName ?? ''
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae?.isContentEditable) return

    const cmd = e.ctrlKey || e.metaKey
    const state = useAppStore.getState()

    // Plan 10 — Undo/Redo
    if (cmd && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      if (e.shiftKey) state.redo()   // Ctrl+Shift+Z (Mac convention)
      else            state.undo()   // Ctrl+Z
      return
    }
    if (cmd && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault()
      state.redo()                    // Ctrl+Y (Windows convention)
      return
    }

    // … bestehende Plan-9b-Shortcuts (Escape / Ctrl+A / Delete / Ctrl+D / Arrows)
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [/* ... */])
```

---

## Modul 10 — UI: WorkspaceHeader Undo/Redo Buttons (Architekt D2 / L5)

`components/Workspace/WorkspaceHeader.tsx` MODIFY — neue Button-Group
**links vor dem VibeGrid-Logo**:

```tsx
import { UndoRedoButtons } from './UndoRedoButtons'

return (
  <div className="h-10 shrink-0 px-3 flex items-center justify-between gap-3 border-b …">
    <div className="flex items-center gap-2">
      <UndoRedoButtons />            {/* NEU — Plan 10 */}
      <span className="font-bold tracking-tight">VibeGrid</span>
    </div>
    {/* … BPM + QualityIndicator + Preset-Packs unchanged */}
  </div>
)
```

```tsx
// components/Workspace/UndoRedoButtons.tsx (CREATE)
'use client'
import { useAppStore } from '@/lib/store'

export function UndoRedoButtons() {
  const canUndo = useAppStore((s) => s.history.past.length > 0)
  const canRedo = useAppStore((s) => s.history.future.length > 0)
  const undo = useAppStore((s) => s.undo)
  const redo = useAppStore((s) => s.redo)
  // Tooltip label = label of the entry that WOULD be acted on.
  const undoLabel = useAppStore(
    (s) => s.history.past[s.history.past.length - 1]?.label ?? null
  )
  const redoLabel = useAppStore((s) => s.history.future[0]?.label ?? null)

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={undo}
        disabled={!canUndo}
        title={canUndo ? `Undo: ${undoLabel}` : 'Nothing to undo'}
        aria-label="Undo"
        className="px-2 py-0.5 rounded text-xs bg-[var(--surface-2)] hover:bg-[var(--surface-3)] disabled:opacity-30 disabled:hover:bg-[var(--surface-2)] transition-colors"
      >
        ↩
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={!canRedo}
        title={canRedo ? `Redo: ${redoLabel}` : 'Nothing to redo'}
        aria-label="Redo"
        className="px-2 py-0.5 rounded text-xs bg-[var(--surface-2)] hover:bg-[var(--surface-3)] disabled:opacity-30 disabled:hover:bg-[var(--surface-2)] transition-colors"
      >
        ↪
      </button>
    </div>
  )
}
```

---

## Modul 11 — KNOWN_LIMITATIONS-Eintrag (Architekt L4)

```markdown
### Undo-Stack RAM Footprint (Plan 10)

The Undo stack stores up to `MAX_HISTORY = 100` snapshots of the
timeline (without playhead). For very large projects (100+ clips with
automation curves on most params), each snapshot can be ~1 MB, so the
total stack can occupy up to **~100 MB RAM**. Accepted trade-off:
Undo is critical UX, the cost is bounded, and modern desktop browsers
have ample headroom. If you hit OOM on extreme projects, reduce
`MAX_HISTORY` in `lib/store/history-types.ts`.

### Undo skips R2-bound operations (Plan 10)

The following actions are NOT in the Undo stack because they involve
side-effects against Cloudflare R2 that cannot be reverted in-app:

- Media upload (`addMediaRef`)
- Media delete (`removeMediaRef`, `purgeSceneflowMediaRefs`)
- Project load (`deserialize`)
- SceneFlow Transfer to Timeline (`replaceMainVideoClips`)

The SceneFlow Transfer-Button shows a toast on completion:
"SceneFlow Transfer abgeschlossen — kann nicht rückgängig gemacht werden."

### Undo does not restore playhead position

`undo()` / `redo()` restore the clip structure (clips, tracks,
automation curves) but keep the current playback position. This is
the DAW-Standard (Ableton, Logic): if you're playing a section and
hit Ctrl+Z to recover an accidentally-deleted clip, you don't want
the playhead jumping back to where you were 30 seconds ago. The
playhead is excluded from `HistoryEntry.timeline` and the
current-value is preserved across restore.
```

---

## Tests (≥ 18)

**Pfad** (Quick-Win D1): `tests/unit/store/`, nicht `__tests__/`.

### `tests/unit/store/undo-redo.test.ts` (CREATE) — ≥ 12

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/lib/store'

beforeEach(() => {
  useAppStore.setState((s) => {
    s.history = { past: [], future: [] }
    // ... reset to known timeline-state
  })
})

// 1. recordingSet: erzeugt History-Entry in past
// 2. recordingSet: leert future nach jeder neuen Mutation
// 3. recordingSet mit coalesce + matching label: KEIN neuer Entry, KEIN neuer Snapshot
// 4. recordingSet mit coalesce + DIFFERENT label: neuer Entry (W8)
// 5. recordingSet mit skip: kein Entry, mutation passiert trotzdem
// 6. undo: stellt vorherigen State wieder her (timeline-without-playhead)
// 7. undo: verschiebt CURRENT state in future
// 8. undo: playhead bleibt UNVERÄNDERT (Architekt D3 / L4)
// 9. undo auf leerem past: no-op, kein Throw
// 10. redo: stellt nächsten State wieder her
// 11. redo auf leerem future: no-op
// 12. Sequenz: Mutation A → Mutation B → Undo → Undo → State = Ausgangszustand
// 13. Sequenz: Mutation → Undo → neue Mutation → future ist leer
// 14. Bounded History: MAX_HISTORY+1 Entries → ältester wird shift()-evicted
// 15. Coalesce-Bug-Regression (B1): PointerDown + 5× coalesce-Move → Undo → State = vor PointerDown
// 16. Plan-9b-Group-Action Integration: deleteSelectedClips → Undo → alle Clips wiederhergestellt
// 17. Slider-Drag (coalesce) → 1 Undo-Eintrag statt N (D4)
// 18. recordingSet als globale Action zugänglich (useAppStore.getState().recordingSet)
```

### `tests/unit/eslint/no-direct-set.test.ts` (CREATE) — ≥ 3

```ts
import { RuleTester } from 'eslint'
import rule from '../../../eslint-rules/no-direct-set-in-store'

const ruleTester = new RuleTester({ /* … */ })

ruleTester.run('no-direct-set-in-store', rule, {
  valid: [
    // recording-set.ts darf set() nutzen (Whitelist)
    { code: "set((s) => { s.x = 1 })", filename: 'lib/store/recording-set.ts' },
    // recordingSet außerhalb des stores OK
    { code: "recordingSet('foo', (s) => { s.x = 1 })", filename: 'components/X.tsx' },
  ],
  invalid: [
    // Direct set() in timeline-slice → error
    {
      code: "set((s) => { s.x = 1 })",
      filename: 'lib/store/timeline-slice.ts',
      errors: [{ messageId: 'noDirectSet' }],
    },
    // useAppStore.setState() anywhere → error
    {
      code: "useAppStore.setState((s) => { s.x = 1 })",
      filename: 'components/Workspace/X.tsx',
      errors: [{ messageId: 'noDirectSet' }],
    },
  ],
})
```

### Integration-Tests — ≥ 3

```ts
// tests/integration/undo-redo-flow.test.ts (CREATE)
// 1. Drag-Move: 5× moveClip (coalesce) → 1 Undo → Clip zurück auf Start
// 2. Group-Delete: deleteSelectedClips (3 Clips) → 1 Undo → alle 3 wiederhergestellt
// 3. Slider-Drag in Inspector: 20× setClipParam (coalesce) → 1 Undo → Param zurück auf vorher
```

**Mindest**: `≥ 18 neue Tests`. Mit den 12 + 3 + 3 = 18. **+1 Sicherheitspuffer im Coalesce-Bug-Regression-Test**.

---

## Verification Gate

Baseline: **1254 Tests**.
Ziel: **≥ 1272**.

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Zusatz-Check** (D5 / W7 — vom Architekt offiziell bestätigt):

```powershell
# Kein direktes set() / setState() außerhalb der Whitelist
git diff main --name-only | Where-Object { $_ -match '\.(ts|tsx)$' } |
  ForEach-Object { Select-String -Path $_ -Pattern '\buseAppStore\.setState\(' }
# → Ergebnis muss leer sein

git diff main --name-only | Where-Object { $_ -match 'lib/store/.*\.ts$' } |
  Where-Object { $_ -notmatch '(recording-set|history-actions)\.ts$' } |
  ForEach-Object { Select-String -Path $_ -Pattern '\bset\(' }
# → Ergebnis muss leer sein
```

Wenn einer dieser Checks Treffer liefert: Plan nicht freigegeben.

**Manuelle Smoke-Tests:**
```
# Clip schieben → Ctrl+Z → Clip zurück
# Group-Delete (Rubberband-Selection + Delete) → Ctrl+Z → alle Clips zurück
# Slider-Drag (Intensity) → Ctrl+Z → Slider zurück auf vorigem Wert
# Inspector-Number-Input: Backspace → KEIN Clip-Delete (Plan-9b input-guard)
# Inspector-Number-Input: Ctrl+Z → KEIN Undo (input-guard)
# Ctrl+Shift+Z → Redo
# Ctrl+Y → Redo (Windows-Convention)
# Tooltip: hovering Undo-Button zeigt "Undo: Move Clip" o.ä.
# Disabled-State: nach Project-Load past.length === 0 → Undo-Button grau
# SceneFlow Transfer → Toast "kann nicht rückgängig gemacht werden"
# Page-Reload: history.past leer (transient, nicht persistiert)
# Bounded: 101 Mutations machen → past.length === 100 (älteste evicted)
```

---

## File Map

| Datei | Aktion |
|---|---|
| `package.json` | MODIFY — `immer` als dependency, `eslint-plugin-local-rules` als devDependency |
| `lib/store/history-types.ts` | CREATE — HistoryEntry + HistoryState + MAX_HISTORY |
| `lib/store/recording-set.ts` | CREATE — makeRecordingSet (B1 + W8 + L4 korrekt) |
| `lib/store/history-actions.ts` | CREATE — undo() + redo() (playhead exclude) |
| `lib/store/types.ts` | MODIFY — `RecordingSet` re-export + AppState.history + AppState.recordingSet + AppState.undo/redo |
| `lib/store/index.ts` | MODIFY — Immer-Middleware + History-State + recordingSet/undo/redo top-level Actions + Migrations von 31 existing set()-Calls + clearHistory()-Action für deserialize |
| `lib/store/timeline-slice.ts` | MODIFY — Migrations (Tabelle Modul 8) |
| `lib/store/persist-shape.ts` | KEINE Änderung (history schon implizit exkludiert) |
| `components/TopBar/NewProjectButton.tsx` | MODIFY — useAppStore.setState → recordingSet('New Project', …, { skip }) |
| `components/TopBar/Transport.tsx` | MODIFY — Playback-state → skip |
| `components/Workspace/Timeline/Toolbar.tsx` | MODIFY — pro Aktion entscheiden |
| `lib/project/deserialize.ts` | MODIFY — `clearHistory()` nach erfolgreichem Load |
| `components/Workspace/Timeline/Tracks.tsx` | MODIFY — Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z im existing keyboard-Effect |
| `components/Workspace/UndoRedoButtons.tsx` | CREATE — ↩ ↪ Icon-Buttons mit Tooltip |
| `components/Workspace/WorkspaceHeader.tsx` | MODIFY — UndoRedoButtons links vor dem Logo |
| `eslint-rules/no-direct-set-in-store.js` | CREATE — Custom-Rule für `set()` und `useAppStore.setState` |
| `.eslintrc.json` (o. ä.) | MODIFY — `local-rules` plugin + Rule activation |
| `docs/architecture/undo-stack.md` | MODIFY — von "kein Undo" zu "Plan 10 — implementiert" |
| `docs/KNOWN_LIMITATIONS.md` | MODIFY — 3 neue Einträge (RAM-Footprint, R2-skip, playhead) |
| `tests/unit/store/undo-redo.test.ts` | CREATE — ≥ 12 Tests |
| `tests/unit/eslint/no-direct-set.test.ts` | CREATE — ≥ 3 Tests |
| `tests/integration/undo-redo-flow.test.ts` | CREATE — ≥ 3 Tests |

---

## Commit-Struktur

```
feat(deps): immer + eslint-plugin-local-rules
feat(store): history-types — HistoryEntry + HistoryState + MAX_HISTORY
feat(store): recording-set — makeRecordingSet (coalesce-label-match + playhead-exclude)
feat(store): history-actions — undo() + redo() (preserves playhead on restore)
feat(store): wire Immer-Middleware + history + recordingSet into root + clearHistory action
feat(store): migrate all set() calls to recordingSet per Migrations-Tabelle (Plan 10 Modul 8)
feat(eslint): no-direct-set-in-store custom rule (set + useAppStore.setState anywhere)
feat(keyboard): Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z in Tracks-keyboard-effect
feat(ui): UndoRedoButtons in WorkspaceHeader (left, before logo)
feat(transfer): SceneFlow-Transfer toast "kann nicht rückgängig gemacht werden"
docs(architecture): undo-stack.md von "not implemented" zu "Plan 10 shipped"
docs(limitations): RAM footprint + R2-skip + playhead-not-restored entries
test: undo-redo unit + eslint + integration (≥ 18 new tests)
```

13 Commits. Jeder genau ein Concern.

---

## Plan-Template-Erweiterung (W7 — permanent ab Plan 10)

**Jeder zukünftige Plan bekommt eine Pflicht-Sektion `## Undo-Behaviour`**:

```markdown
## Undo-Behaviour

| Action | recordingSet label | coalesce | skip | Begründung (bei skip) |
|---|---|---|---|---|
| [Action A] | "[Label]" | nein | nein | — |
| [Action B] | "[Label]" | ja (Drag) | nein | — |
| [UI-Mutation X] | — | — | ja | [Warum nicht undobar] |
```

Pläne ohne diesen Abschnitt werden vom Architekt nicht freigegeben.
CC#2 prüft bei jedem QA neue `set()` / `useAppStore.setState`-Calls
gegen die ESLint-Rule.

---

## Architekt-Decision-Checkliste — alle adressiert

**Blocker (4/4):**
- [x] B1 Coalesce: kein Snapshot bei `coalesce: true`, nur mutieren (Modul 3)
- [x] B2 Immer-Middleware installieren + integriert (Modul 1)
- [x] B3 ESLint-Rule auf gesamtes Projekt + 4 externe Caller umgestellt (Modul 7 + 8)
- [x] B4 set()-Snippets konsistent (durch B2 gelöst, Modul 3 + 4)

**Soll-Fixes (4/4):**
- [x] W3 AutomationCurves-Scope explizit festgestellt (Modul 2 — leben in clip.params)
- [x] W6 Migrations-Tabelle alle 31+ Calls (Modul 8)
- [x] W8 Coalesce nur bei Label-Match (Modul 3)
- [x] D3 Playhead excluded aus HistoryEntry + Restore-Pattern (Modul 2 + 3 + 4)

**Addendum 2 (4/4):**
- [x] L1 Plan-Nummer Plan 10
- [x] L2 setMuted → record + coalesce mit Label "Mute Track" (Modul 8)
- [x] L3 replaceMainVideoClips → skip + Pflicht-Toast (Modul 8 + KNOWN_LIMITATIONS)
- [x] L4 structuredClone-Footprint akzeptiert, KNOWN_LIMITATIONS-Eintrag (Modul 11)

**Quick-Wins (6/6):**
- [x] W1 Baseline auf 1254 Tests / Store v6
- [x] W5 Initial-State `history: { past: [], future: [] }` (Modul 6)
- [x] D1 Test-Pfad `tests/unit/store/`
- [x] D2 WorkspaceHeader-Position links vor dem Logo (Modul 10)
- [x] D5 eslint-plugin-local-rules als devDependency (Modul 7)
- [x] D6 RecordingSet Public-Type in `lib/store/types.ts` (Modul 5)

**Process (1/1):**
- [x] W7 Plan-Template-Erweiterung offiziell bestätigt (eigene Sektion oben)

**Rev.-2-Review Fixes (3/3):**
- [x] Bug 1 `clearHistory` lebt in `history-actions.ts` (Modul 4 + 5 + 6 + 8)
- [x] W1 ESLint-Override für Test-Files in `.eslintrc.json` (Modul 7)
- [x] W2 Cross-Drag-Coalesce-Verhalten als Kommentar bei `moveClip` (Modul 6)

**Rev.-3-Feedback (1/1):**
- [x] ESLint-Whitelist: `index.ts` raus — strikte Default-Position
      (Modul 7 + Verification Gate)

---

Abgabe: `vibegrid-plan-10-undo-redo-rev3.md`

✅ **Rev. 3 — Architekt-freigegeben — Implementation-Ready.**
