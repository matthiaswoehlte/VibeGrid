# CC Feedback — Design Sektion 8: Testing & Verification

✅ Freigegeben — solide Strategie. Drei Lücken die geschlossen werden müssen:

## Bug: Web Worker in Vitest braucht explizite Konfiguration

`beat-detector.ts` läuft in einem Web Worker (Sektion 3 Entscheidung).
Vitest unterstützt Workers nicht out-of-the-box in jsdom-Umgebung.

```typescript
// vitest.config.ts — explizit konfigurieren:
export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        resources: 'usable',
      },
    },
    // Worker-Tests in separatem Pool:
    poolOptions: {
      threads: {
        singleThread: true, // Worker-Tests nicht parallel (jsdom-Konflikt)
      },
    },
  },
});

// beat-detector.test.ts — Worker NICHT direkt instanziieren.
// Stattdessen: detectBPM-Logik als pure Funktion aus Worker extrahieren
// und separat testen. Worker-Wrapping ist Glue-Code, nicht Unit-testbar.
//
// lib/audio/beat-detector.ts  → pure Funktion (testbar)
// lib/audio/beat-detector.worker.ts → Worker-Wrapper (nicht unit-testen)
```

## Lücke: Zustand Store + Persist-Middleware fehlt in Tests

Store-Tests fehlen komplett. Der Persist-Layer ist ein häufiger
Fehlerquelle bei State-Shape-Änderungen.

```typescript
// tests/unit/store/persist.test.ts — hinzufügen:

// 1. State-Serialisierung: Blobs landen NICHT in localStorage
test('audio/image blobs are excluded from persistence', () => {
  // Store mit Audio-Blob befüllen
  // localStorage-Snapshot prüfen → kein Blob-Objekt drin
  // nur URL-String (MediaRef.url) darf persistiert werden
});

// 2. State-Rehydration: nach Reload ist Timeline intakt
test('timeline state survives store rehydration', () => {
  // State setzen, Store serialisieren, neu initialisieren
  // TimelineState muss identisch sein
});

// 3. Partial-State: fehlende Keys (ältere Version) crashen nicht
test('missing keys in persisted state use defaults', () => {
  // Alten State ohne neue Keys in localStorage schreiben
  // Store initialisieren → kein Crash, Default-Werte greifen
});
```

## Lücke: Beat-Detection Synthetic Audio Buffer

"synthetic click track at known BPM" — wie wird der Buffer erzeugt?
Das muss explizit definiert werden sonst bleibt der Test vage:

```typescript
// tests/unit/audio/beat-detector.test.ts:

function createSyntheticClickTrack(bpm: number, bars: number): AudioBuffer {
  const sampleRate = 44100;
  const beatInterval = (60 / bpm) * sampleRate;
  const totalSamples = Math.ceil(beatInterval * bars * 4);
  const buffer = new AudioBuffer({
    numberOfChannels: 1,
    length: totalSamples,
    sampleRate,
  });
  const data = buffer.getChannelData(0);
  // Click (impulse) auf jeden Beat-Position setzen:
  for (let beat = 0; beat < bars * 4; beat++) {
    const pos = Math.round(beat * beatInterval);
    if (pos < totalSamples) data[pos] = 1.0;
  }
  return buffer;
}

// Test-Cases:
// - 120 BPM → detected ±2 BPM Toleranz
// - 128 BPM → detected ±2 BPM Toleranz
// - 90 BPM → detected ±2 BPM Toleranz
// Bewusst KEINE 100% Genauigkeit fordern — Energy-Based ist heuristisch
```

## Ergänzung: isOnBeat Beat-Window Test

Aus Sektion 3 haben wir BEAT_WINDOW_MS = 40ms eingeführt.
Das muss getestet werden — sonst ist es de facto undokumentiert:

```typescript
// tests/unit/audio/grid.test.ts — ergänzen:

test('isOnBeat true within ±40ms window', () => {
  const grid = { bpm: 120, offsetMs: 0, beatsPerBar: 4 };
  // Beat bei t=0.500s (Beat 1 bei 120BPM)
  expect(beatPhase(0.500, grid).isOnBeat).toBe(true);   // exact
  expect(beatPhase(0.520, grid).isOnBeat).toBe(true);   // +20ms
  expect(beatPhase(0.480, grid).isOnBeat).toBe(true);   // -20ms
  expect(beatPhase(0.545, grid).isOnBeat).toBe(false);  // +45ms → außerhalb
});

test('same beat does not fire twice within window', () => {
  // lastFiredBeatIndex verhindert Doppel-Trigger
  // zwei aufeinanderfolgende Frames im selben Beat-Window
  // → isOnBeat nur beim ersten Frame true
});
```

## Ergänzung: Manuelle Verifikationsliste erweitern

Zwei fehlende Checks aus unseren Korrekturen in Sektion 6 + 7:

```markdown
# KNOWN_LIMITATIONS.md — Manual Verification ergänzen:

- [ ] Retina Display: Canvas-Output ist scharf (kein DPR-Bug)
- [ ] Tab-Switch während Recording: Warning-Toast erscheint
- [ ] Export-Filename enthält korrekten Timestamp (kein "undefined")
- [ ] Nach Export: Memory nicht permanent erhöht (URL.createObjectURL revoked)
```

## Bestätigung: Was explizit gut ist ✅

- Vitest statt Jest — richtige Wahl für ESM + Next.js
- Plugin-Contract-Generator-Test — elegant, skaliert automatisch
- "Kein Snapshot-Spam" bei Komponententests — professionelle Haltung
- E2E nur Smoke in v0.1 — richtige Priorität
- Visuelle FX-Korrektheit bewusst ausgespart — realistisch
- KNOWN_LIMITATIONS.md als Artefakt committen — gut
