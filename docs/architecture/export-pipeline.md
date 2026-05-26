# Video Export Pipeline — Architektur & Debug-Historie

> **Stand:** 2026-05-23 · Plan 6 abgeschlossen, Plan 6-R + 5.10+ Bytes-Cache nachgeschoben
> **Wer das liest:** Du (oder zukünftiges Ich), wenn am Export irgendwas kaputt geht — bevor irgendjemand wieder anfängt, „mal eben opacity:0.001 zu probieren". Das hier ist die Karte durch ein Minenfeld.

## TL;DR

VibeGrid exportiert MP4-Videos in zwei Phasen:

1. **Live-Preview** im Studio: `HTMLVideoElement` mit `<video src=blob:...>` spielt synchron zur AudioEngine. Niedrige Latenz, browser-nativ.
2. **Offline-Export**: `VideoDecoder` (WebCodecs) + `mp4box.js` dekodieren MP4-Bytes Frame-für-Frame in deterministischer Reihenfolge → in `OffscreenCanvas` rendern → mit `mp4-muxer` muxen → MP4-Bytes-Blob für Download.

Beide Pfade teilen sich denselben **MP4-Bytes-Cache** (`lib/video/bytes-cache.ts`), so dass jedes Video nur einmal von R2 geladen wird — egal wie oft du Export drückst.

**Heilige Regeln:**

- **Live-Preview nutzt nie WebCodecs.** Der Browser ist da besser.
- **Offline-Export nutzt nie `<video>`-Elemente.** Der Compositor frisst Frames stillschweigend (siehe Abschnitt „Warum HTMLVideoElement-Export nicht funktioniert").
- **Niemals erneut den Compositor mit Opacity-Tricks austricksen wollen.** Chromium optimiert das weg. Wir haben das in mehreren Iterationen gelernt — siehe Commits `62f6f12`, `2146aee`.

---

## Modulkarte

```
lib/video/
├── bytes-cache.ts        Shared URL→ArrayBuffer cache, streaming-fetch mit
│                         Progress + concurrent-fetch-Deduplikation
├── engine.ts             VideoEngine — Live-Preview-Pool von <video> auf
│                         blob:-URLs (Bytes aus dem Cache)
└── decoder-pool.ts       VideoDecoderPool — long-lived, mp4box.js + WebCodecs
                          VideoDecoder, Output-Queue pro Source

lib/hooks/
├── useVideoEngine.ts     Reconcile-Loop: Timeline-Clips ↔ Live-Preview-Pool
└── useVideoDecoderPool.ts Long-lived Decoder-Pool (für Export, nicht für Preview)

lib/export/
├── offline-render.ts     Frame-Schleife: Audio-Sample-genaues Seeking,
│                         pro Frame Source-relative Time-Berechnung, FX-Stack
├── exporter.ts           VideoExporter — orchestriert Render + mp4-muxer +
│                         Download
└── state-machine.ts      ExportState: idle / preparing / rendering / muxing /
                          done / error

components/Workspace/LeftPanel/
└── MediaLibrary.tsx      Zeigt unter jedem Video-Titel den Bytes-Cache-
                          Ladefortschritt (kommt aus media.videoLoadProgress)
```

---

## Lifecycle einer Export-Session

```
Page-Load                      Export-Klick                    Download
──────────                     ────────────                    ────────
                                                                  ▲
useVideoEngine mountet                                            │
   │                                                              │
   ├── reconcile(): für jeden                                     │
   │   Video-Clip: load(mediaId,url)                              │
   │                                                              │
   │   load() ruft bytes-cache.fetch(url, onProgress)             │
   │   ├── HTTP-Streaming (ReadableStream)                        │
   │   ├── onProgress → media.videoLoadProgress                   │
   │   │   → MediaLibrary zeigt Balken                            │
   │   └── ArrayBuffer landet im Cache (Map<url,buf>)             │
   │                                                              │
   │   Blob aus ArrayBuffer → blob:-URL → <video>.src             │
   │                                                              │
   └── Live-Preview spielbar                                      │
                                                                  │
                              useVideoExporter triggert:          │
                                                                  │
                              Für jeden Video-Clip:               │
                              decoder-pool.load(mediaId,url)      │
                              ├── bytes-cache.fetch(url) ←────────┤
                              │   ⚡ Cache-Hit — KEIN zweiter      │
                              │   Download (vorher 286 MB →       │
                              │   jetzt 143 MB pro Session)       │
                              ├── mp4box.demux → AVC-Samples      │
                              └── VideoDecoder konfiguriert       │
                                                                  │
                              offline-render Frame-Loop:          │
                              ├── globalTime → pro Clip:          │
                              │   sourceTime = globalTime         │
                              │     - clipStartSec                │
                              │     + sourceInPointSec            │
                              ├── decoder.getFrameAt(sourceTime)  │
                              ├── alle Layers in OffscreenCanvas  │
                              │   komponieren                     │
                              ├── new VideoFrame(canvas) →        │
                              │   videoEncoder.encode(frame)      │
                              └── alle 1024 Frames flush(),       │
                                  mp4-muxer akkumuliert           │
                                                                  │
                              Am Ende: muxer.finalize() →         │
                              MP4-Blob → triggerDownload() ──────►│
```

---

## Warum HTMLVideoElement-Export NICHT funktioniert

**Die Lehrgeschichte aus 8 fehlgeschlagenen Commits** (`d95425b`, `64a5d4c`, `a8d0e7b`, `2146aee`, `62f6f12`, später überholt):

Naiv klingt der Offline-Export einfach:

```ts
video.currentTime = sourceTime;
await new Promise(r => video.addEventListener('seeked', r, { once: true }));
ctx.drawImage(video, 0, 0);  // ← müsste den neuen Frame zeichnen
```

**Tut es aber nicht.** In modernem Chromium gilt:

1. `seeked` feuert, wenn der Decoder _angefangen_ hat, den Frame zu liefern — nicht wenn der Compositor ihn gepaintet hat.
2. Ohne sichtbares DOM-Repaint kann `drawImage(video)` den alten Frame zurückgeben (Stand vor dem Seek), denn der Compositor hat den neuen noch nicht in den Texture-Slot gelegt.
3. `opacity: 0.001` hat früher den Compositor zum Paint gezwungen — moderne Chromium-Versionen optimieren das weg.
4. Auch `new VideoFrame(htmlVideoElement)` hängt am selben Compositor-Pfad.

**Symptom:** Im exportierten MP4 zeigt jedes Video nur das erste Bild als Standbild. Audio läuft, Bilder/FX funktionieren, aber alle Videos sind eingefroren.

**Was wir alles probiert haben (und nicht funktioniert hat):**

| Versuch                                       | Warum es schief ging                                     | Commit      |
| --------------------------------------------- | -------------------------------------------------------- | ----------- |
| CSS-`opacity`-Trick zum Compositor-Wakeup     | Chrome optimiert es weg, kein Paint scheduling           | `2146aee`   |
| `readyState ≥ 2` Polling nach `seeked`        | readyState lügt — geht auf 2, Frame trotzdem alt         | `62f6f12`   |
| `new VideoFrame(htmlVideoElement)`            | Hängt am gleichen Compositor                             | `2146aee`   |
| `requestVideoFrameCallback` allein            | Feuert nur bei sichtbarem Paint                          | (Pre-rewrite) |

**Die Lösung:** Den HTML-Video-Pfad für Export komplett rauswerfen und WebCodecs nehmen. Der `VideoDecoder` liefert `VideoFrame`-Objekte direkt aus dem Decoder, ohne Compositor.

---

## Die WebCodecs-Pipeline

### Module: `lib/video/decoder-pool.ts`

Ein **long-lived** Pool (eine Instanz pro Studio-Page-Mount, erst bei Unmount zerstört). Pro `mediaId` gibt es eine `VideoDecoderSource`, die:

1. MP4-Bytes aus dem Bytes-Cache holt (`videoBytesCache.fetch(url, undefined, signal)`).
2. Mit `mp4box.js` demuxt: extrahiert AVC-Codec-String, Auflösung, Sample-Array (jedes Sample = ein H.264-Frame mit `dts`, `cts`, `is_sync`, `data`).
3. `VideoDecoder` konfiguriert (`codec: 'avc1.64001f'` o. ä., `optimizeForLatency: false`).
4. Auf `getFrameAt(sourceTimeSec)` antwortet — siehe nächster Abschnitt.

### Output-Queue statt Resolver-per-Timestamp

**Frühere Version:** `Map<timestampUs, resolver>` — pro angefragtem Timestamp ein Promise registrieren, im `output`-Callback nach `frame.timestamp` lookup-en.

**Warum kaputt:** Der Decoder macht Lookahead. Er emittiert oft Frame N+2 _bevor_ Frame N (B-Frames!). Wenn wir auf Frame N warten und das Lookahead-Fenster Frame N nicht enthält, schlägt der Per-Frame-Timeout zu — Bug bei Frame 437 nach ~30 Minuten Export, Pipeline hängt komplett (Commit `757be12`).

**Aktuelle Lösung:** `outputQueue: VideoFrame[]`, FIFO. Der `output`-Callback pusht; `getFrameAt` walkt die Queue und schließt die ältesten Frames, sobald sie hinter dem Target-Timestamp liegen. Sequenzieller Zugriff — passt zum Render-Loop, der die Zeit monoton vorwärts laufen lässt.

### B-Frame-Gotchas

H.264 mit B-Frames hat **DTS ≠ CTS**:

- **DTS** (Decoding Timestamp): in welcher Reihenfolge der Decoder die Samples bekommt — monoton.
- **CTS** (Composition/Presentation Timestamp): in welcher Reihenfolge die Frames angezeigt werden sollen — **nicht monoton**, weil B-Frames rückbezogen sind.

Konsequenzen:

| Was du erwartest        | Was du bekommst                           | Konsequenz                                              |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------- |
| Monotones `ts`-Array    | `[0, 33, 17, 67, 50, 100, ...]`           | Binärsuche bricht. `findSampleForTime` macht Linear-Scan |
| `sampleIdx + 1 == next` heißt vorwärts | Stimmt auch für „rückwärts wegen B-Frame" | Backward-Seek-Detektor muss **timestamp-basiert** sein, nicht index-basiert (Commit darunter) |

Backward-Seek-Detection (in `getFrameAt`):

```ts
const latestEmittedTs = this.outputQueue.length > 0
  ? this.outputQueue[this.outputQueue.length - 1].timestamp
  : Number.NEGATIVE_INFINITY;
const BACKWARD_SLACK_US = 100_000;  // 100 ms Toleranz für B-Frame-Reordering
if (target.ts + BACKWARD_SLACK_US < latestEmittedTs) {
  // Echter Seek rückwärts — alle Frames droppen, decoder.flush(), neu starten
}
```

### `flush()` darf hängen

Chrome hat einen Bug, bei dem `decoder.flush()` nie auflöst, wenn die Pipeline in einem ungewöhnlichen Zustand ist. Pragmatischer Schutz: `flushWithTimeout(3_000)` — nach 3 Sekunden weitermachen, ohne den Export zu blockieren (Commit `48dafb1`).

---

## Source-relative Time-Mapping

**Problem:** Ein Clip kann an `startBeat = 16` auf der Timeline liegen, aber die Bytes des Videos beginnen bei Sekunde 0 des Quellfiles.

**Naiv (falsch):**

```ts
const sourceTime = globalTimeSec;  // ← spielt Frame X.Y aus dem Video,
                                   //   selbst wenn das Video weiter unten liegt
```

**Konsequenz:** Video läuft „5x zu schnell" — weil `globalTime` ab `clipStart` weiterläuft und am Source weit vor dem letzten Bild ankommt (Quote des Users: „Halleluja! Der 1. Film läuft, allerding um faktor 5 (reine Schätzung) oder so zu schnell").

**Korrekt** (`lib/export/offline-render.ts`):

```ts
const clipStartSec = (clip.startBeat * 60) / deps.beatGrid.bpm
                   + deps.beatGrid.offsetMs / 1000;
const sourceInPointSec = (clip.params as { sourceInPointSec?: number } | undefined)
                          ?.sourceInPointSec ?? 0;
const sourceTime = globalTimeSec - clipStartSec + sourceInPointSec;
```

Drei Bestandteile:

1. **`globalTimeSec - clipStartSec`** — Sekunden seit Beginn dieses Clips auf der Timeline.
2. **`+ sourceInPointSec`** — Offset im Quellvideo (für die geplante Schnitt-Funktion: Nur die Stelle ab Sekunde 30 nutzen → `sourceInPointSec = 30`).
3. Resultat ist die **Sekunde im Quellvideo**, die jetzt gerendert werden muss.

Diese Architektur ist explizit dafür ausgelegt, dass später eine Trim-UI dazukommt, ohne den Render-Pfad anfassen zu müssen.

### Live-Preview hatte denselben Bug — Plan 8d Hotfix

**Stand 2026-05-26:** Bis Plan 8d war der einzige Multi-Clip-pro-Track-
Workflow in der Live-Preview "ein Image-Track mit zwei Bildern" —
keine Source-Relative-Time-Berechnung nötig (Bilder sind statisch).
Mit Plan 8d's `main-video`-Spur (4 SceneFlow-Szenen sequentiell auf
einer Spur) trat die Live-Preview in dieselbe Falle wie der frühere
Offline-Export:

`useVideoEngine` hatte einen globalen `engine.play()`-Aufruf, der
ALLE geladenen Videos gleichzeitig vom aktuellen `currentTime`
abspielen ließ. Was passierte:

- Szene 1: spielt von t=0 ihre echte Dauer durch (z.B. 5 s),
  hält dann am letzten Frame an (Video hat ended-Event gefeuert).
  User sieht "freeze mid clip 1".
- Szenen 2-N: wurden ASYNCHRON von R2 nachgeladen. Als der
  globale `play()` lief, waren sie noch nicht in `loadedIds()` —
  sie wurden also nie gestartet. Stehen für immer auf Frame 0.

**Fix:** dieselbe `globalTime - clipStartSec + sourceInPointSec`-
Formel ist jetzt auch in der Live-Preview. `useVideoEngine`
orchestriert PRO LOADED VIDEO ELEMENT:

- Wenn der Playhead innerhalb eines referenzierenden Clips ist:
  `el.currentTime` auf source-relative Sekunde syncen (nur bei
  Drift > 200 ms, sonst native Wiedergabe laufen lassen).
- Wenn `timeline.playhead.playing` true: `el.play()`.
- Wenn der Playhead außerhalb liegt: `el.pause()` + zurück auf
  Frame 0 (damit der nächste Wechsel auf diese Spur bei Frame 0
  startet, nicht bei der Driftposition).
- Neu geladene Videos kriegen via `syncOnLoadRef`-Callback einen
  sofortigen Sync, sobald `load()` resolved — sonst bleiben sie
  bis zum nächsten Store-Tick auf Frame 0.

Code: `lib/hooks/useVideoEngine.ts:syncVideoPlayback`. Tests in
`tests/unit/hooks/useVideoEngine.test.tsx` unter dem describe-Block
"Plan 8d — per-clip source-relative play orchestration".

---

## Bytes-Cache: Warum & Wie

**Problem ohne Cache** (286 MB pro Session bei zwei mittleren Videos):

1. Page-Load: `useVideoEngine` baut `<video src=https://r2/...mp4>` → Browser fetcht 143 MB.
2. Export-Klick: `VideoDecoderPool.load()` macht `fetch(https://r2/...mp4).arrayBuffer()` → **noch mal** 143 MB.

R2 sendet `Cache-Control: no-cache`, antwortet aber mit `200` (nicht `304`), also lädt der Browser jedes Mal frisch. Doppelter Traffic, doppelte Wartezeit beim Export.

**Lösung** (`lib/video/bytes-cache.ts`):

- Module-Singleton: `Map<url, ArrayBuffer>` + `Map<url, Promise>` für In-Flight-Dedup.
- `fetch(url, onProgress?, signal?)` — wenn schon gecached, sofort Resolve mit Bytes + ein letzter Progress-Call zum Aufräumen der UI. Sonst Streaming-Fetch mit `response.body.getReader()`, jedes Chunk wandert in den Progress-Callback.
- Zwei Konkurrierende Aufrufer kriegen dasselbe Promise (nur der erste sieht Progress — bewusste Vereinfachung).

**Konsumenten:**

| Modul                  | Wie genutzt                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/video/engine.ts`  | `fetch(url, onProgress)` → Blob aus dem Buffer → `URL.createObjectURL(blob)` → `<video>.src = blobUrl`. Progress-Callback ruft `mediaActions.setVideoLoadProgress`. |
| `lib/video/decoder-pool.ts` | `fetch(url, undefined, signal)` → ArrayBuffer direkt an `mp4box`. Ohne Progress (passiert bereits beim Page-Load durch die Engine).                |
| `MediaLibrary.tsx`     | Liest `media.videoLoadProgress[id]` → zeigt schmalen Balken + „42% · 67340 KB" unter jedem Video.                                                            |

**Memory-Trade-off:** Jedes geladene Video bleibt für die Lebensdauer der Page-Session im RAM. ~50-200 MB pro typischem Musikvideo. Für Desktop OK; v0.2/Mobile-Kandidat für LRU-Eviction. Beim Unmount des Engines werden alle Blob-URLs revoked und der Cache entfällt mit dem Page-Reload.

---

## Was passiert wann (Zustand-Diagramm)

```
ExportState:
  idle ─── User klickt Export ───►   preparing
                                        │
                                        ├── Decoder-Pool lädt fehlende Videos
                                        │   (Bytes-Cache-Hit = schnell)
                                        ▼
                                     rendering
                                        │
                                        ├── pro Frame: Quellzeit → decoder
                                        │   → VideoFrame → OffscreenCanvas
                                        │   → FX → encodeFrame
                                        │
                                        ├── alle 1024 Frames: encoder.flush()
                                        │
                                        ▼
                                     muxing
                                        │
                                        ├── muxer.finalize()
                                        │
                                        ▼
                                       done
                                        │
                                        └── triggerDownload(mp4Blob)
```

Bei jedem Schritt: `setExportState({ status: ..., progress: N/M, message: ... })`. UI bindet daran.

---

## Diagnose-Logs

Bei Verdacht auf Export-Probleme als Erstes in die Browser-Console:

```
[VideoDecoderSource] loaded: codec=avc1.64001f samples=192 ts=...us monotonic=false WxH
```

- `monotonic=false` ist **normal** — B-Frames bringen CTS aus der Reihenfolge. Solange `samples > 0` und `codec` sich nach H.264 anfühlt, ist der Demux OK.

```
[VideoDecoderSource] backward seek: target=12.34s latestEmitted=15.20s
```

- Tritt nur bei echtem Rewind auf (z. B. Schleifenwiederholung, Scrub). Wenn das beim normalen Vorwärts-Export erscheint → Bug in der Backward-Detection, Slack erhöhen.

```
[OfflineRender] stall at frame 437, stage=decode
```

- Per-Frame-Timeout (10 s) hat zugeschlagen. `stage` sagt dir, wo: `fetch` (Bytes-Cache), `decode` (VideoDecoder), `compose` (FX), `encode` (VideoEncoder). Commit `e989de0` für den Mechanismus.

---

## Known Limitations

1. **MP4-Only** — kein WebM, kein VP9. mp4box ist hartkodiert. Falls jemals nötig: parallele Demuxer-Strategie pro Container.
2. **AVC/H.264-Only** — HEVC/AV1 ungetestet. Codec-String aus mp4box wird an `VideoDecoder.configure` durchgereicht; sollte funktionieren, aber nicht verifiziert.
3. **Kein WebGL-Renderer** — alles Canvas 2D. FX, die echte Shader bräuchten, sind v0.2.
4. **Audio kommt von AudioEngine, nicht aus Video-Tracks** — Videos werden mit `muted: true` geladen. Bewusst: Zwei Audio-Clocks würden auseinanderdriften.
5. **In-Memory-Muxing** — `mp4-muxer` baut das komplette MP4 im RAM. Für 30-Minuten-Exports knapp. Kein File-System-Streaming.
6. **Bytes-Cache: keine Eviction** — ein Video, das du nicht mehr nutzt, bleibt resident bis Page-Reload.

---

## Wenn der Export wieder hängt — Debug-Reihenfolge

1. **Console-Logs lesen** (oben). Welcher Stage stallt?
2. **`media.videoLoadProgress` im Devtools-Zustand prüfen** — sind alle Videos bei `received == total`? Wenn nein: R2-Problem oder CORS.
3. **Frame-Loop-Logs aktivieren** in `offline-render.ts` (auskommentiert). Welcher Frame ist der letzte erfolgreiche?
4. **Decoder-Output-Queue-Größe loggen** — wenn die Queue voll wird, drosselt der Encoder zu langsam. Wenn sie leer ist, lookup-misst der Decoder.
5. **Niemals zuerst „opacity:0.001" probieren.** Wir wissen, dass es nicht funktioniert. Falls jemand auf die Idee kommt → diesen Abschnitt rausholen.

---

## Wo der Code lebt — schneller Index

| Was du suchst                              | Datei                                                  |
| ------------------------------------------ | ------------------------------------------------------ |
| MP4-Bytes-Cache (Singleton + Streaming)    | `lib/video/bytes-cache.ts`                             |
| Live-Preview-Video-Pool                    | `lib/video/engine.ts`                                  |
| Reconciler Timeline ↔ Live-Preview         | `lib/hooks/useVideoEngine.ts`                          |
| WebCodecs-Decoder-Pool (Offline)           | `lib/video/decoder-pool.ts`                            |
| Long-lived Decoder-Pool für Export         | `lib/hooks/useVideoDecoderPool.ts`                     |
| Offline-Render-Loop                        | `lib/export/offline-render.ts`                         |
| Export-Orchestrator (Render + Mux)         | `lib/export/exporter.ts`                               |
| Export-State-Machine                       | `lib/export/state-machine.ts`                          |
| UI-Download-Progress unter Video-Titeln    | `components/Workspace/LeftPanel/MediaLibrary.tsx`      |
| Source-relative Time-Mapping               | `lib/export/offline-render.ts` (Suche `sourceInPointSec`) |
| B-Frame-Backward-Seek-Detection            | `lib/video/decoder-pool.ts` (Suche `BACKWARD_SLACK_US`) |

---

## Memorabilien aus dem Debugging

- „**Das Video steht wieder.**" — User-Quote nach Versuch #4, ehrlich verdient.
- „**Ich lasse mich von Dir nicht mehr trösten.**" — Auslöser für den Wechsel zur long-lived Decoder-Architektur.
- „**Halleluja! Der 1. Film läuft, allerdings um faktor 5 zu schnell.**" — Source-relative Time war noch nicht da.
- „**Es funktioniert endlich, Hurraaaaaa. Hat lange gedauert aber es ist gut.**" — Final, mit Bytes-Cache + Progress-UI.

Wenn dieser Pfad jemals wieder auseinanderfällt: erst das hier lesen, dann anfangen zu programmieren. Das spart Tage.
