# CC Feedback — Plan 5: UI Components, Claude Auto-Preset, Automation Data Model

✅ **Freigegeben mit 2 Pflicht-Fixes vor Implementierungsstart**

Der interne Architekt-Agent hat sauber gearbeitet — die 5 blocking issues im
Changelog sind korrekt adressiert. Mein unabhängiger Review ergibt 2 weitere
Punkte die vor dem ersten `git commit` erledigt sein müssen, plus Antworten auf
alle 10 Open Questions.

---

## Pflicht-Fixes (vor Implementierungsstart)

### Fix 1 — OQ10: `selectedClipId` aus `partialize` rausziehen

**Datei:** `lib/store/index.ts` — `partialize`-Funktion

**Problem:** `UIState` hat jetzt `{ zoom, selectedClipId }`. `partialize`
schreibt `ui: state.ui` — damit überlebt `selectedClipId` den Browser-Reload.
Nach einem Reload zeigt der Inspector statt "Wähle einen Clip aus" entweder den
leeren State (wenn der Clip nicht mehr existiert) oder springt überraschend zu
einem Clip der der User nicht selektiert hat. Das ist verwirrende UX.

**Fix — 1 Zeile in partialize:**
```ts
// lib/store/index.ts — partialize
ui: { zoom: state.ui.zoom },   // selectedClipId ist transient — nie persistieren
```

`selectedClipId: null` ist der korrekte Default bei jedem frischen Load.

---

### Fix 2 — OQ7: `useAudioEngine` auf expliziten Channel umstellen

**Datei:** `lib/hooks/useAudioEngine.ts` + `lib/store/types.ts`

**Problem:** Der Action-Patching-Ansatz (Task 7) wraps `setDetectedGrid` zur
Laufzeit. Das funktioniert für den Single-Instance-Fall — aber in React
StrictMode (Next.js dev) mountet jeder Effect doppelt. Sequence:

```
1. Effect A runs → originalA = setDetectedGrid_orig, patches to patchedA
2. Effect A cleanup → restores to originalA ✅ (korrekt)
3. Effect A re-runs → originalB = setDetectedGrid_orig, patches to patchedB ✅
```

StrictMode ist OK. Aber: wenn in v0.2 irgendeine Komponente versehentlich
`useAudioEngine()` ein zweites Mal aufruft, entsteht ein doppelter Wrapper der
beim Cleanup der zweiten Instanz die ERSTE Instanz mitreißt. Dieser Bug ist
schwer zu debuggen.

Da der Hook gerade neu geschrieben wird, ist jetzt der richtige Moment das
sauber zu lösen. Aufwand: ~20 Minuten.

**Fix — expliziter Channel:**

In `lib/store/types.ts`:
```ts
export interface AudioActions {
  // ...existing...
  setDetectedGrid(grid: BeatGrid): void;       // user-facing (triggers engine sync)
  setDetectedGridFromEngine(grid: BeatGrid): void;  // engine-facing (skips engine sync)
}
```

In `lib/store/audio-slice.ts`:
```ts
setDetectedGrid: (grid) => set((s) => ({ audio: { ...s.audio, grid } })),
setDetectedGridFromEngine: (grid) => set((s) => ({ audio: { ...s.audio, grid } })),
// Identische Implementierung — der Unterschied liegt im Namen, nicht im Body.
```

In `lib/hooks/useAudioEngine.ts` — das dritte useEffect (Action-Patching) komplett
ersetzen durch einen `onStateChange`-Callback aus der Engine:

```ts
useEffect(() => {
  if (!engine) return;
  // Engine meldet neue Grid-Daten → expliziten Channel nutzen, nie Loop
  engine.onDetectedGrid((grid) => {
    useAppStore.getState().audioActions.setDetectedGridFromEngine(grid);
  });
  return () => engine.offDetectedGrid();
}, [engine]);
```

Und im Store-Subscriber (das zweite useEffect) nur auf `setDetectedGrid`
reagieren:
```ts
const unsub = useAppStore.subscribe((state) => {
  const bpm = state.audio.grid.bpm;
  if (bpm === lastSeenBpmRef.current) return;
  lastSeenBpmRef.current = bpm;
  // setDetectedGridFromEngine schreibt auch die BPM — würde hier feuern.
  // Source-Differenzierung: source === 'detected' → skip
  if (state.audio.grid.source === 'detected') return;
  engine.setBPM(bpm);
});
```

Falls `AudioEngine` kein `onDetectedGrid`-Callback hat (Plan 2 nicht geprüft):
Alternativ den `source`-Guard im Subscribe nutzen — das ist bereits in der
`BeatGrid` Struktur vorhanden (`source: 'manual' | 'detected'`):

```ts
useAppStore.subscribe((state) => {
  const grid = state.audio.grid;
  if (grid.bpm === lastSeenBpmRef.current) return;
  lastSeenBpmRef.current = grid.bpm;
  if (grid.source === 'detected') return; // Kam von der Engine → kein Loop
  engine.setBPM(grid.bpm);
});
```

Das ist sogar einfacher als das Patching und braucht keinen zweiten
AudioActions-Eintrag. Der `source`-Guard macht den Channel explizit und
dokumentiert sich selbst.

**Empfehlung:** `source`-Guard-Variante — kleinste Änderung, kein neuer
Action-Name, keine Engine-API-Erweiterung.

Test-Update für den neuen Guard (ersetzt den Patching-Test in Task 7):
```ts
it('engine-detected grid does not re-trigger engine.setBPM', () => {
  const { result } = renderHook(() => useAudioEngine());
  const setBpmSpy = vi.spyOn(result.current.engine!, 'setBPM');
  act(() => {
    useAppStore.getState().audioActions.setDetectedGrid({
      bpm: 128, offsetMs: 12, source: 'detected'   // ← source guard
    });
  });
  expect(setBpmSpy).not.toHaveBeenCalled();
  expect(useAppStore.getState().audio.grid.bpm).toBe(128);
});
```

---

## Anmerkungen (kein Blocker)

### A1 — `imageMime` TypeScript-Narrowing für Anthropic SDK

In `app/api/analyze-image/route.ts` prüft `ALLOWED_IMAGE_MIMES.has(rawMime)`
den Wert, aber TypeScript narrowt `rawMime` (Typ `string`) nicht auf die SDK-
erwartete Union `'image/jpeg' | 'image/png' | 'image/webp'`. Das ergibt einen
TS-Fehler wenn die Anthropic SDK `media_type` strikt typisiert.

Fix — nach dem Check:
```ts
imageMime = rawMime as 'image/jpeg' | 'image/png' | 'image/webp';
```

Der typecheck-Schritt in Task 18 fängt das auf — kein Blocker, aber direkt zu
fixieren wenn der Fehler erscheint.

---

### A2 — `schema-validator.ts` im `lib/ai/`-Verzeichnis ist client-importierbar

`lib/ai/schema-validator.ts` hat kein `import 'server-only'` und wird von
`lib/storage/auto-preset-adapter.ts` (Client-Code) importiert. Das ist korrekt
und gewollt — aber die Platzierung im `lib/ai/`-Verzeichnis suggeriert
Server-only. Zukünftige Entwickler könnten `server-only` hinzufügen und den
Client-Import brechen.

Empfehlung: Entweder in `lib/utils/schema-validator.ts` oder
`lib/ai/schema-validator.ts` mit einem Kommentar:
```ts
// Pure validation — no server-only; intentionally importable from client.
```

---

### A3 — `createRenderer` API: `rafCallback`/`cancelRafCallback` prüfen

`useRenderer.ts` (Task 8) ruft `createRenderer(...)` ohne `rafCallback` und
`cancelRafCallback`. Der loop-automation-Test in Task 2 übergibt sie explizit.
Falls Plan-3-API diese als Required hat → TS-Fehler beim typecheck in Task 8.

Kein Blocker — Task 8 hat `npm run typecheck` als Step 3, der das sofort
aufdeckt. Aber CC #1 soll darauf vorbereitet sein.

---

## Antworten auf alle 10 Open Questions

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Single-select für v0.1 | ✅ Bestätigt. Multi-select ist v0.2. |
| 2 | SDK-Bundle ~1.4 MB server-side | ✅ Akzeptabel. Server-only, kein Client-Chunk. Defer to v0.2 if cold-start becomes issue. |
| 3 | Claude Sonnet 4.6 vs Haiku 4.5 | ✅ **Sonnet 4.6** — bereits entschieden, im Plan korrekt. |
| 4 | System-Prompt Sprache | ✅ **Englisch** — Model gibt numerische Werte zurück, sprachunabhängig. Nicht splitten. |
| 5 | R2 public URL Annahme | ✅ Akzeptiert für v0.1. In KNOWN_LIMITATIONS.md dokumentieren. |
| 6 | Rate-Limiting Auto-Preset | ✅ v0.1 ohne Limit OK. 2s debounce als v0.2-Watchlist-Item. |
| 7 | `useAudioEngine` Patching vs. Channel | ❌ **Expliziter `source`-Guard** — siehe Pflicht-Fix 2. |
| 8 | Interpolation-Modi nur `'linear'` in v0.1 | ✅ Bestätigt. Plan 5.5 erweitert den Union-Typ. |
| 9 | Waveform-Worker Placeholder | ✅ Placeholder reicht für v0.1 Smoke-Test. Worker kommt in Plan 5.5 oder 6. |
| 10 | `selectedClipId` in `partialize` | ❌ **Rausziehen** — siehe Pflicht-Fix 1. |

---

## Was gut ist ✅

- **Changelog aus dem internen Architect-Review** ist klar und vollständig —
  alle 5 Blocker korrekt adressiert, insbesondere Blocking 2 (Effect-deps
  Churn) und Blocking 3 (Cache-Priming nach Rehydrate). Das war nicht trivial.
- **Automation-Datamodel** sauber als Breaking-Change-freie Migration angelegt.
  `resolveClipParams` ist der einzige Erweiterungspunkt — Plan 5.5 braucht
  buchstäblich nur die UI-Komponente.
- **Defensive double-validation** in `auto-preset-adapter.ts` (Server
  validiert, Client re-validiert) ist exakt richtig — ein Server-Bug kann den
  Store nicht vergiften.
- **`imageMime` MIME-Parameter stripping** (Non-blocking fix aus dem internen
  Review) ist korrekt und wichtig — R2 liefert manchmal `; charset=binary`.
- **Plugin-registry contamination guard** (`_resetBuiltInPluginsForTests` in
  beforeEach) in allen relevanten Tests — Blocking 4 sauber gelöst.
- **Engine-lifting** (Task 23) erkennt und löst das Double-Instance-Problem
  selbst, bevor die Verification Gate läuft.
- **`vi.hoisted`-Pattern** aus Plan 4 korrekt auf den Anthropic-Mock
  übertragen (Task 18).
- **Test-Count** ≥ 46 neue Tests auf Plan-4-Baseline 169 → ≥ 215. Realistisch
  und prüfbar.
- **Smoke-Gate** als manueller Task 24 explizit — gut, dass das dokumentiert
  ist und nicht als "implizit durch Tests abgedeckt" gilt.

---

## Fix-Summary für CC #1

| Fix | Datei(en) | Aufwand |
|---|---|---|
| Fix 1: `selectedClipId` aus partialize | `lib/store/index.ts` | 1 Zeile |
| Fix 2: `source`-Guard statt Action-Patching | `lib/hooks/useAudioEngine.ts` | ~10 Zeilen ersetzen |

Nach diesen 2 Fixes direkt in die Implementierung — direkt auf main,
sequentiell, finaler Review (CC #2) am Ende wie gehabt.
