# CC Feedback — Plan 7: Offline Video Render Pipeline (WebCodecs)

❌ **Nicht freigegeben** — 1 kritischer Bug, 2 Entscheidungspunkte, 2 Anmerkungen

---

## Kritischer Bug (MUSS gefixt werden)

### Bug 1 — Encoder-Error-Callback propagiert nicht zur Promise

**Datei:** `lib/export/offline-render.ts`, Task 9

**Problem:**

```ts
const videoEncoder = new VideoEncoder({
  output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
  error: (e) => { throw e; },  // ← BUG
});
```

`throw e` in einem Encoder-Error-Callback landet **nicht** im umschließenden
`try/catch` von `renderOffline()`. Der Callback läuft in einem separaten
Microtask — der `throw` wird zu einem unhandled Promise rejection ohne
sichtbaren Effekt für den User. Der Render-Loop läuft weiter, `setExportState`
bekommt keinen Error-State, UI friert nicht ein — der User sieht einfach
keinen Download und kein Feedback.

**Fix — Error-Capture via shared State:**

```ts
let videoError: Error | null = null;
let audioError: Error | null = null;

const videoEncoder = new VideoEncoder({
  output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
  error: (e) => { videoError = e; },
});

const audioEncoder = new AudioEncoder({
  output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
  error: (e) => { audioError = e; },
});

// In der Frame-Loop nach dem backpressure-check:
if (videoError) throw videoError;
// Analog in der Audio-Loop:
if (audioError) throw audioError;
```

Damit propagiert der Encoder-Error sauber zur äußeren `try/catch` in
`renderOffline()` und von dort in den Hook → `setExportState({ status: 'error',
errorCode: 'render-failed' })`.

Test-Ergänzung in `offline-render.test.ts`:
```ts
it('encoder error propagates to rejected Promise', async () => {
  // Stub VideoEncoder.error callback, fire it mid-render,
  // assert renderOffline rejects with that error.
});
```

---

## Entscheidungspunkte (Matthias entscheidet)

### E1 — Determinismus (Tasks 1 + 2) trotz expliziter Gegenentscheidung

**Situation:** In unserem Review hat Matthias explizit entschieden:
> "Das ist mir egal, man sieht das nicht, das ist keine Energie wert"

CC #1 hat Tasks 1 (PRNG Helper) und 2 (Particles deterministic) trotzdem
eingebaut — mit der Begründung: "Determinismus ist Pre-Condition für
Offline-Rendering."

**Technische Wahrheit:** CC #1's Argument ist überstark. Im Offline-Render
wird jeder Frame **genau einmal** gerendert und encodiert. `Math.random()`
produziert innerhalb dieses einen Durchlaufs konsistente Frames —
nur wenn der User zweimal exportiert bekommt er leicht verschiedene
Partikel-Positionen. Das sieht niemand.

**Konsequenz der beiden Optionen:**

| Option | Aufwand | Ergebnis |
|---|---|---|
| Tasks 1+2 behalten | ~2h, ~8 Tests | Sauber, professionell, zwei neue Dateien |
| Tasks 1+2 streichen | 0h | `Math.random()` bleibt, kein sichtbarer Unterschied |

**Empfehlung Architekt:** Entscheidung bei Matthias. Beide Optionen sind
architektonisch vertretbar. Wenn Tasks 1+2 gestrichen werden: in der
Risk-Tabelle einen Eintrag ergänzen ("Particles non-deterministic — intentional,
v0.1 scope decision").

---

### E2 — ImageBitmapCache: ungelöstes Problem in Risk #3

**Risk #3** des Plans lautet (sinngemäß): "Die Bitmap-Cache lebt in
`useRenderer`. Der offline Orchestrator läuft außerhalb. Reviewer-Feedback
erwünscht."

Das ist kein Risiko — das ist ein offenes Implementierungs-Problem das
Task 9 blockiert wenn es nicht vorher entschieden ist.

**Die Optionen:**

**Option A — Bitmap-Cache als Getter-Function in `OfflineRenderDeps`:**
```ts
// useVideoExporter.ts:
const rendererRef = /* ref to the shared ImageBitmap cache */;
renderOffline({
  ...deps,
  getImageBitmap: (mediaId) => rendererRef.current?.getBitmap(mediaId),
});
```

`useVideoExporter` und `useRenderer` teilen sich die Cache-Instanz.
Clean, kein globaler State. Braucht eine `getBitmap()`-API auf dem
Renderer — 2 Zeilen.

**Option B — Cache als Context oder Zustand-Feld:**
Den Cache aus `useRenderer` in einen React-Context heben. Overhead
nicht rechtfertigbar für v0.1.

**Option C — Re-fetch aus R2 im Offline-Render:**
Inakzeptabel — async, CORS-abhängig, langsam, zerstört den Sinn
des Caches.

**Architekt-Entscheidung: Option A.**
CC #1 soll vor Task 9 in `useRenderer` eine `getBitmap(mediaId: string):
ImageBitmap | undefined` Methode exponieren, die der Hook dann als
Getter-Function in `OfflineRenderDeps` durchreicht. Das ist der sauberste
Weg ohne globalen State.

Das ist **kein Blocker für die Freigabe** — aber CC #1 muss das explizit
in Task 9 Step 2 adressieren, bevor er den Orchestrator implementiert.

---

## Anmerkungen (kein Blocker)

### A1 — Bitrate 6 Mbps (Plan 6) vs. 8 Mbps (Plan 7) — undokumentierter Bump

`lib/export/webcodecs.ts` Task 5 setzt `bitrate: 8_000_000`. Plan 6
hatte `videoBitsPerSecond: 6_000_000`. Beides liegt über QAC-03 Minimum
(6 Mbps) — kein Fehler. Aber die Änderung sollte im Commit-Message oder
im KNOWN_LIMITATIONS-Update explizit erwähnt werden:

```
feat(export): offline render uses 8 Mbps video bitrate (up from 6 Mbps realtime)
```

Kein Code-Change nötig — nur Dokumentation.

### A2 — Plan-Naming: "Plan 7" vs. "Plan 6-R"

Das Übergabe-Dokument und unser gemeinsames Review haben diesen Plan
als **Plan 6-R (Render Pipeline Rewrite)** eingeordnet. CC #1 nennt
ihn "Plan 7". Die Datei heißt
`2026-05-21-vibegrid-plan-7-offline-render.md`.

Plan 7 war ursprünglich für **Supabase Auth + Project Save** reserviert.

Keine Code-Änderung nötig — aber Matthias soll entscheiden:
- Plan-Nummerierung beibehalten wie CC #1 es gemacht hat (Plan 7 = Render,
  Supabase wird Plan 8)?
- Oder umbenennen (Plan 6-R = Render, Supabase bleibt Plan 7)?

---

## Was gut ist ✅

- **Backpressure-Pattern** (`encodeQueueSize > 4`) ist korrekt und
  sauber begründet — besser als `flush()` per Frame.
- **`makeOfflineRenderer` Closure-Pattern** ist elegant: ein Aufruf
  baut den Renderer, `renderAt(t)` setzt nur den Zeit-Parameter um.
  Kein Refactor von `tick()` nötig.
- **Zwei separate Muxer-Libs** hinter einer gemeinsamen `OfflineMuxer`-
  Interface ist die richtige Abstraktion — der Orchestrator weiß nicht
  welcher Muxer läuft.
- **Audio vor/nach Video-Encoding** klar getrennt: erst alle Video-Frames
  durch, dann Audio in Bulk. Einfacher als interleaved.
- **`fastStart: 'in-memory'` für MP4** ist richtig für v0.1 und das
  RAM-Risiko (~300 MB bei 5 Min) ist in Risk #1 ehrlich dokumentiert.
- **Firefox/Safari Fallback** auf MediaRecorder mit explizitem Toast ist
  genau die richtige Strategie.
- **Context-Block** exzellent — Commit-Hashes, Feature-Flag-Status,
  existierende Arch-Decisions. Macht Review-Arbeit messbar leichter.

---

## Fix-Summary für CC #1

| # | Was | Aufwand |
|---|---|---|
| Bug 1 | Encoder-Error via shared Flag statt `throw` | ~15 Min + 1 Test |
| E1 | Matthias entscheidet über Tasks 1+2 | — |
| E2 | `getBitmap()` auf `useRenderer` exponieren, als Getter-Function in `OfflineRenderDeps` | ~30 Min |
| A1 | Bitrate-Bump in Commit-Message dokumentieren | 1 Zeile |
| A2 | Plan-Nummerierung mit Matthias klären | — |

Nach Bug-1-Fix + E2-Lösung direkt freigegeben.
