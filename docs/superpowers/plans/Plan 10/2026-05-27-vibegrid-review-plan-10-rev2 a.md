# CC Feedback — Plan 10: Undo / Redo (Rev. 2)

✅ Fast freigegeben — 1 Blocker, 2 Wackler. Kleiner Fix, dann go.

Rev. 2 ist ein großer Schritt gegenüber Rev. 1. Alle 4 Blocker,
alle Wackler und alle Addendum-Punkte sind korrekt adressiert.
Die Coalesce-Fix-Implementierung ist exakt richtig. Migrations-Tabelle
ist vollständig. Gut.

---

## Kritische Bugs (MUSS gefixt werden)

### Bug 1 — `clearHistory` in `index.ts` triggert ESLint-Rule

Modul 8, Spezial-Abschnitt `deserialize.ts`:

```ts
// index.ts:
clearHistory: () => set((s) => { s.history = { past: [], future: [] } })
```

`index.ts` liegt in `lib/store/` und ist **nicht** in der ESLint-Whitelist
(`recording-set.ts` + `history-actions.ts`). Dieser `set()`-Call würde
beim ersten `npm run lint` sofort einen Error erzeugen.

**Fix:** `clearHistory` gehört in `history-actions.ts` (wo es konzeptionell
hingehört — es ist eine History-Operation):

```ts
// lib/store/history-actions.ts MODIFY:
export function makeHistoryActions(set: ZustandImmerSet) {
  return {
    undo: () => set((state) => { /* ... */ }),
    redo: () => set((state) => { /* ... */ }),
    clearHistory: () => set((state) => {   // NEU
      state.history = { past: [], future: [] }
    }),
  }
}
```

`history-actions.ts` ist bereits in der ESLint-Whitelist — kein Rule-Treffer.
`deserialize.ts` ruft dann `useAppStore.getState().clearHistory()` wie
vom Plan bereits vorgesehen.

---

## Wackler (sollte adressiert werden)

### W1 — ESLint-Rule trifft `useAppStore.setState` in Test-beforeEach

`tests/unit/store/undo-redo.test.ts` Z. 723:

```ts
beforeEach(() => {
  useAppStore.setState((s) => {  // ← Rule-Treffer
    s.history = { past: [], future: [] }
  })
})
```

Die ESLint-Rule matcht `useAppStore.setState` anywhere im Projekt.
Test-Dateien müssen ausgenommen werden:

```json
// .eslintrc.json — overrides hinzufügen:
{
  "overrides": [
    {
      "files": ["tests/**/*.ts", "tests/**/*.tsx", "**/*.test.ts", "**/*.test.tsx"],
      "rules": {
        "local-rules/no-direct-set-in-store": "off"
      }
    }
  ]
}
```

Alternativ: Test-Setup über `useAppStore.getState().clearHistory()` +
direkte Immer-Draft-Mutation via Store-Init-Funktion — aber ESLint-Override
ist sauberer für Tests.

### W2 — moveClip always coalesce → Cross-Drag-Coalesce

```ts
moveClip: (id, newStart) =>
  recordingSet('Move Clip', ..., { coalesce: true }),
```

Wenn User Clip A dragt, loslässt, dann Clip B dragt (ohne zwischendurch
eine andere Action zu machen), coalesced Clip-B-Move in den Clip-A-Eintrag
— beide gehen bei Ctrl+Z zurück. Das ist technisch korrekt (Label-Match
greift) aber für den User unerwartet.

Ist **akzeptiertes DAW-Verhalten** (Ableton macht dasselbe), aber sollte
als Kommentar im Code dokumentiert sein:

```ts
// coalesce: true — consecutive moves of ANY clip fold into one undo step
// if no other action is performed between drags. This is standard DAW
// behavior (Ableton, Logic). A user who moves clip A then immediately
// moves clip B will undo both in one Ctrl+Z.
moveClip: (id, newStart) =>
  recordingSet('Move Clip', ..., { coalesce: true }),
```

Kein Code-Change — nur Kommentar.

---

## Was sehr gut ist ✅

- **Coalesce-Bug-Fix (B1)** — exakt korrekt implementiert:
  bei `coalesce: true` KEIN neuer Snapshot, nur mutieren.
  Pre-Drag-Snapshot bleibt in `past[last]` erhalten.

- **Label-Match-Coalesce (W8)** — sauber. Verhindert Cross-Action-Merge.

- **Playhead-Exclude (D3)** — `Omit<TimelineState, 'playhead'>` +
  Restore-Pattern mit `currentPlayhead` ist korrekt und elegant.

- **Persist-Merge** — `history: { past: [], future: [] }` im Merge
  verhindert Stack-Übernahme aus altem LocalStorage. Wichtig.

- **Migrations-Tabelle** — vollständig, alle 31+ Calls kategorisiert.
  `setPlayhead → skip` mit 60×/s-Begründung, `setDetectedGrid → skip`
  (Engine-Output). Korrekt.

- **`structuredClone` Begründung** — Kommentar mit Vergleich zu
  JSON.parse/stringify ist gute Doku für zukünftige Leser.

- **Smoke-Tests** — 11 Manual-Tests decken alle Edge-Cases ab
  (Input-Guard, Tooltip, disabled-State, Page-Reload, Bounded-History).

- **`clearHistory` Konzept** — die Idee eine Top-Level-Action zu
  exponieren statt `useAppStore.setState` direkt ist richtig.
  Nur der Ort (index.ts statt history-actions.ts) ist falsch.

---

## Checkliste Rev. 3 (oder direkter Fix)

- [ ] Bug 1: `clearHistory` nach `history-actions.ts` verschieben
- [ ] W1: ESLint-Override für Test-Dateien in `.eslintrc.json`
- [ ] W2: Kommentar zum Cross-Drag-Coalesce-Verhalten bei `moveClip`

Das sind 3 chirurgische Eingriffe — kein Architektur-Umbau.
CC #1 kann das in 15 Minuten adressieren.

---

Rev. 2 Review — 2026-05-27
