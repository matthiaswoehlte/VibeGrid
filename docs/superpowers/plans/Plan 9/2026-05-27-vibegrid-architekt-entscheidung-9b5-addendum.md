# Addendum — Architekt-Entscheidung Plan 10 (ehem. 9b.5)
### 4 offene Mikro-Entscheidungen (nach CC #1 Meta-Review)

Ergänzt zur Hauptentscheidung vom 2026-05-27. Alle 4 Punkte sind jetzt
festgeschrieben — CC #1 kann Rev. 2 ohne Rückfragen schreiben.

---

### L1 — B2: Immer-Middleware → **Immer einführen**

```ts
// npm i immer
// lib/store/index.ts:
import { immer } from 'zustand/middleware/immer'
const useAppStore = create<AppState>()(immer((...) => ({ ... })))
```

Die 31 bestehenden Spread-Style-Calls bleiben kompatibel —
Immer-Middleware akzeptiert sowohl Mutator- als auch Return-Style.
Kein Big-Bang-Refactor nötig.

---

### L2 — B3: External setState → **Option B**

`recordingSet` wird als globale Action via `useAppStore.getState().recordingSet`
exponiert. Die 4 externen Caller werden umgestellt:

- `NewProjectButton.tsx` → `recordingSet('New Project', ..., { skip: true })`
- `Transport.tsx` → `recordingSet('', ..., { skip: true })`
- `Toolbar.tsx` → je nach Action: record oder skip (CC #1 entscheidet in Schritt 0)
- `deserialize.ts` → `recordingSet('Load Project', ..., { skip: true })`

ESLint-Rule wird erweitert auf `useAppStore.setState`-Calls (MemberExpression)
im gesamten Projekt, nicht nur in `lib/store/`.

---

### L3 — W8: Coalesce Label-Matching

Coalesce nur wenn `lastEntry.label === currentLabel`:

```ts
if (options.coalesce &&
    past.length > 0 &&
    past[past.length - 1].label === label) {
  // kein neuer Entry — nur mutieren
} else {
  // normaler Record-Pfad
}
```

---

### L4 — D3: Playhead excluded aus HistoryEntry

```ts
const entry: HistoryEntry = {
  timeline: structuredClone({
    ...state.timeline,
    playhead: undefined,  // excluded
  }),
  ...
}
// Beim Restore:
state.timeline = { ...prev.timeline, playhead: state.timeline.playhead }
```

Undo stellt Clip-Struktur wieder her, nicht die Abspielposition.
DAW-Standard (Ableton, Logic).

---

### L5 — D2: WorkspaceHeader Position

Undo/Redo-Buttons links im Header, als erste Element-Gruppe vor dem Logo.
Zwei Icon-Buttons (↩ ↪), disabled wenn Stack leer, Tooltip mit Label.

---

Entscheidung komplett. CC #1 kann Rev. 2 schreiben.

Addendum — 2026-05-27
