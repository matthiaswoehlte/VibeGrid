# Architekt-Review — Plan 5.9d: Multi-Audio + Volume + Video-Audio

✅ **Freigegeben zur Implementierung**

Baseline: 617 Tests, Commit `a3f978d`. Keine Blocker.

---

## Anmerkungen für CC #1 (kein Blocker, aber vor dem jeweiligen Task lesen)

### A1 — `getContextTime()` fehlt im AudioEngine-Interface (Task 1 → Task 4)

Task 4 Step 2 fügt `getAudioContextTime?: () => number` zu `RendererDeps`
hinzu. Task 4 Step 4 verkabelt das mit `engine.getContextTime`. Aber
`getContextTime(): number` existiert NICHT im `AudioEngine`-Interface
aus Task 1.

CC #1 muss in Task 1 Step 3 diese Methode zum Interface ergänzen:

```ts
export interface AudioEngine {
  // ... alle anderen Methoden ...
  /** Returns audioCtx.currentTime. Used by the renderer to compute
   *  rampClipVolume target times without accessing the context directly. */
  getContextTime(): number;
}
```

Und in der Implementierung:
```ts
getContextTime(): number {
  return audioCtx?.currentTime ?? 0;
}
```

TypeCheck nach Task 1 Step 4 wird es aufdecken wenn's fehlt —
aber besser proaktiv.

---

### A2 — `MediaClipInspector.tsx` fehlt im File Map

Task 6 Step 3 erstellt `components/Workspace/Inspector/MediaClipInspector.tsx`
als neue Komponente, aber die File Map am Plan-Anfang listet sie nicht.

CC #1 soll sie beim Task-6-Commit mit in `git add` aufnehmen und
die File Map nachträglich ergänzen (oder einfach committen — kein
harter Fehler, nur Inventar-Lücke).

---

### A3 — `seekAllClips(timeSec, bpm)` — `bpm`-Parameter ist im Body ungenutzt

Die Implementierung von `seekAllClips` in Task 1 Step 3 stoppt alle
Sources und gibt die Kontrolle an den Reconciler zurück. Der `bpm`-
Parameter wird im Body nicht verwendet.

Das ist kein Bug — `bpm` könnte für spätere Erweiterungen nützlich
sein. Aber CC #1 soll entweder:
- `bpm` aus der Signatur entfernen (dann auch in `useAudioEngine`
  anpassen), ODER
- einen `// bpm reserved for future per-clip restart logic` Kommentar
  hinzufügen damit Lint nicht warnt

---

## Was besonders gut ist ✅

- **Context-Block Punkt 6** (commit `6265582` als Vorbild) — exakt der
  richtige Anti-Drift-Mechanismus für den Strict-Mode-Bug. Wer das
  beim Lesen überspringt, wird es im Smoke-Gate bezahlen.
- **Architecture Insight 7** (Offline-render signature break) ist
  seltene aber richtige Vorgehensweise: harter Bruch + simultanes
  Test-Update statt leaky shim. Sauber.
- **`mixAudioOffline` als eigenständige Datei** (`lib/export/mix-audio-offline.ts`)
  statt eingebettet in `offline-render.ts` — testbar in Isolation,
  kein OfflineAudioContext-Mock der den ganzen renderOffline-Test
  kontaminiert.
- **Execution Notes** — der Hinweis "Smoke Gate step 6 persönlich
  machen" für die Volume-Ramp ist richtig: das ist genau der Test
  den kein Unit-Test ersetzen kann.
- **Risk Table** ist vollständig — besonders der letzte Eintrag
  (offline-render-test signature break) zeigt dass CC #1 den
  Ripple-Effect durchdacht hat.
- **6 Tests in `offline-audio-mix.test.ts`** obwohl File Map ≥ 5
  sagt — der sechste (peak-normalisation) ist genau der Grenzfall
  der sonst immer vergessen wird.

---

## Verification Gate

```powershell
npm run typecheck   # clean
npm run lint        # clean
npm test -- --run   # ≥ 637 Tests (617 + 20), 0 failing
npm run build       # Bundle ≤ Baseline + 5%
```
