# CC Feedback — Plan 2: Audio Engine

✅ Freigegeben mit einem kritischen Bug und Antworten auf alle 5 Open Questions.

---

## KRITISCHER BUG: Worker-Instantiierung in Next.js 14 (nicht Vite)

Open Question 2 aus dem Plan ist ein echter Bug.

`new Worker(new URL('./beat-detector.worker.ts', import.meta.url), { type: 'module' })`
ist das **Vite-Pattern**. Next.js 14 App Router nutzt **Webpack**, nicht Vite.
Unter Webpack scheitert `import.meta.url` in Workers anders als unter Vite.

**Fix — Next.js-kompatibles Worker-Pattern:**

```ts
// lib/audio/engine.ts — detectBPM Worker-Erstellung ersetzen:

// STATT:
new Worker(new URL('./beat-detector.worker.ts', import.meta.url), { type: 'module' })

// SO (Next.js Webpack-kompatibel):
new Worker(
  new URL('../../lib/audio/beat-detector.worker.ts', import.meta.url)
)
// KEIN { type: 'module' } — Next.js Webpack bundelt Workers als Classic Script
// Der relative Pfad muss von der aufrufenden Datei aus stimmen
```

Gleiches gilt für `waveform-worker.ts`.

**Wichtig:** Nach dieser Änderung `npm run build` ausführen und prüfen ob
Workers im Build-Output als separate Chunks erscheinen.
Falls der Build weiterhin scheitert: Worker-Instantiierung in eine
`lib/audio/worker-factory.ts` auslagern mit `/* webpackChunkName */` Hint:

```ts
// lib/audio/worker-factory.ts
export function createBeatWorker(): Worker {
  return new Worker(
    new URL('./beat-detector.worker.ts', import.meta.url)
  );
}

export function createWaveformWorker(): Worker {
  return new Worker(
    new URL('./waveform-worker.ts', import.meta.url)
  );
}
```

Engine-Tests injizieren dann Mock-Worker via `deps.createBeatWorker` —
das Interface ist bereits im Plan vorgesehen. ✅

---

## Bug: `detectBPM` transferiert `channelData.buffer` aber der Buffer
## könnte bereits transferiert worden sein

```ts
worker.postMessage(
  { type: 'detect', data: channelData, sampleRate: decoded.sampleRate },
  [channelData.buffer]  // ← Transferable
);
```

Nach dem Transfer ist `channelData.buffer` detached — falls `detectBPM`
zweimal aufgerufen wird (User klickt "Detect" zweimal schnell),
wirft der zweite Aufruf einen `DataCloneError`.

**Fix:**

```ts
// Vor postMessage: AbortController des vorherigen Calls cancellen
// In engine.ts — State für laufende Detection hinzufügen:
let activeDetectionAbortController: AbortController | null = null;

// In detectBPM():
if (activeDetectionAbortController) {
  activeDetectionAbortController.abort(); // terminiert laufenden Worker
}
activeDetectionAbortController = new AbortController();
// ... dann mit neuem Worker fortfahren
```

---

## Antworten auf die 5 Open Questions

**1. Detector heuristics — `ENERGY_THRESHOLD = 1.3`:**
Default beibehalten. Wenn ein Test um ±1-2 BPM scheitert:
zuerst Algorithmus tunen (Threshold auf 1.2 oder Window auf 1.5s),
NICHT die Test-Toleranz erhöhen.

**2. Worker creation → siehe kritischer Bug oben.**
Webpack-Pattern verwenden, kein `{ type: 'module' }`.

**3. `detectBPM` re-fetcht Audio → ÄNDERN: AudioBuffer im Memory behalten**

```ts
// lib/audio/engine.ts — decoded AudioBuffer cachen:
let cachedAudioBuffer: AudioBuffer | null = null;

// In load():
// Nach decodeAudioData:
cachedAudioBuffer = await ctx.decodeAudioData(arrayBuffer);

// In detectBPM():
// STATT re-fetch:
if (!cachedAudioBuffer) throw new Error('Audio buffer not available');
const channelData = cachedAudioBuffer.getChannelData(0).slice();

// In destroy():
cachedAudioBuffer = null;
```

Begründung: Für Songs ≤5 Min (typischer VibeGrid Use-Case) ist der
Memory-Overhead (~25MB bei Stereo 44.1kHz) akzeptabel. Ein Re-fetch
kostet bei schlechter Verbindung 1-3 Sekunden — inakzeptable UX.

**4. `currentTime` NICHT im Store → BESTÄTIGT**
`useSyncExternalStore` Hook in Plan 5 liest direkt aus `engine.getState()`.
Kein Zustand-Store für transiente Engine-Werte. Korrekt.

**5. `setDetectedGrid` forces `source: 'detected'` → BESTÄTIGT**
Slice bleibt opinionated. Caller kann source nicht überschreiben.
Verhindert versehentliche falsche Source-Labels.

---

## Kleinigkeit: `nearestBeatIndex` in `lastFiredBeatGuard`

Die Funktion nimmt `nearestBeatIndex` — aber `beatPhase()` gibt nur
`beatIndex` (Math.floor) zurück. Der Renderer in Plan 3 muss den
"nächsten" Beat-Index selbst berechnen:

```ts
// Renderer (Plan 3) — explizit dokumentieren:
const { beatIndex, phase, isOnBeat } = beatPhase(currentTime, grid);
// nearestBeatIndex = phase > 0.5 ? beatIndex + 1 : beatIndex
const nearestBeatIndex = phase > 0.5 ? beatIndex + 1 : beatIndex;
const { shouldFire, nextLastFired } = lastFiredBeatGuard(nearestBeatIndex, lastFired);
```

Bitte diesen Kommentar in `clip-utils.ts` als JSDoc ergänzen damit
Plan 3 keinen stillen Bug einbaut.

---

## Bestätigung: Was explizit gut ist ✅

- `deps.createBeatWorker` Injection für Tests — elegant
- `channelData.buffer` als Transferable — korrekte Performance-Entscheidung
- `onStateChange` als Set mit Cleanup-Funktion — kein Memory Leak
- `crossOrigin = 'anonymous'` auf Audio Element — notwendig für R2-URLs
- `destroy()` nullt alle Referenzen — kein Memory Leak nach Unload
- `DEFAULT_BEAT_GRID` als exportierte Konstante — konsistent zwischen Engine und Store
- `decayingClickTrack` Helper für robustere Detektor-Tests — sehr gut
