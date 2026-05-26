# CC #1 Prompt — Schreibe Plan 6: Export Pipeline

## Kontext

Du arbeitest an **VibeGrid** (`C:\_Dev\VibeGrid`).

Plan 5.7 + 5.7-R sind abgeschlossen und durch CC #2 freigegeben.
Baseline: **358 Tests**, Commit `df0c4f8`, alle Verification Gates grün.

Du kennst den Workflow: Plan schreiben → Architekt reviewt → du
implementierst. Schreibe jetzt nur den **Plan** — noch keinen Code.

---

## Was Plan 6 leisten soll

**Name:** Export Pipeline

VibeGrid kann nach Plan 6 eine vollständige WebM-Datei aus dem aktuellen
Projekt exportieren. Der User klickt Export, sieht einen REC-Indicator,
wartet in Echtzeit, bekommt die Datei automatisch heruntergeladen.

---

## Features im Scope

### Feature 1 — WebM Export via MediaRecorder

- `lib/export/VideoExporter.ts` — Klasse (oder Modul) das den Export orchestriert
- Canvas-Stream via `canvas.captureStream(fps)` — empfohlene FPS: 30
- Audio-Stream via `AudioContext.destination` →
  `AudioContext.createMediaStreamDestination()`
- Beide Streams in einen `MediaRecorder` zusammenführen
  (`new MediaStream([videoTrack, audioTrack])`)
- Codec-Präferenz: `video/webm;codecs=vp9,opus`
  Fallback: `video/webm;codecs=vp8,opus`
  Fallback: `video/webm` (Browser entscheidet)
  → `MediaRecorder.isTypeSupported()` prüfen, ersten unterstützten Typ wählen
- `ondataavailable` → Chunks sammeln in `Blob[]`
- `onstop` → `new Blob(chunks, { type: mimeType })` →
  `URL.createObjectURL(blob)` → automatischer Download via
  `<a download="vibegrid_export_YYYY-MM-DDTHH-MM-SS.webm">` + `.click()`
- Nach Download: `URL.revokeObjectURL(url)` (Memory-Leak-Prävention)
- Export läuft in **Echtzeit** — Audio spielt komplett durch, erst dann
  stoppt der MediaRecorder
- Während Export: `isPlaying = true`, Playhead bewegt sich normal,
  `isExporting = true` (neuer Store-State) — UI zeigt REC-Indicator

### Feature 2 — REC-Indicator

Visuelles Feedback während des Exports:

- Roter Dot + Timecode (Format: `REC 0:00` → `0:03` etc.) in der TopBar
- Timecode aktualisiert sich jede Sekunde (kein RAF-Update nötig,
  `setInterval(1000)` reicht)
- Sichtbar solange `isExporting === true`
- Verschwindet nach abgeschlossenem Download

### Feature 3 — Tab-Switch Warning

- `document.addEventListener('visibilitychange', ...)` während Export
- Wenn Tab in den Hintergrund wechselt: persistenter Warning-Toast
  (sonner `toast.warning(...)` mit `duration: Infinity`)
- Toast bleibt bis Tab wieder aktiv wird (`visibilitychange` → visible)
- Export wird **nicht** abgebrochen (User entscheidet)

### Feature 4 — Performance Warning

- Während Export: tatsächliche FPS messen via RAF-Timestamps
  (`performance.now()` Differenz zwischen Frames)
- Gleitender Durchschnitt über 60 Frames
- Wenn Durchschnitt < 24 fps: einmaliger non-blocking Toast
  `toast.warning("Performance dropped — export may have dropped frames")`
- Toast nur einmal pro Export-Session (Flag zurücksetzen bei Export-Start)

### Feature 5 — Export Cancel

- `X`-Button neben dem REC-Indicator in der TopBar
- `VideoExporter.cancel()` → `mediaRecorder.stop()` ohne Download
- Nach Cancel: `isExporting = false`, Audio stoppt, Playhead reset
  zu Beat 0, kein Download, kein Blob im Memory
- Toast: `toast.info("Export cancelled")`

### Feature 6 — Export Button

- Button in der TopBar (neben Play/Pause)
- Disabled wenn `exportState.status !== 'idle'` ODER keine
  Audio-MediaRef im Store ODER kein aktiver Image-Clip auf der
  Image-Track (sonst schwarzer Frame beim Export-Start)
- Klick startet Export ab Beat 0 (Playhead reset vor Start)
- Tooltip zeigt den gewählten Codec ("Export codec: VP9 + Opus" /
  "VP8 + Opus (Fallback)") — User sieht was er bekommt

---

## Spec-Pflicht-Details (NICHT übersehen)

Diese Punkte kommen aus `docs/superpowers/specs/2026-05-19-vibegrid-design.md` §8
und sind Acceptance-Criteria-relevant. Der Plan muss sie ALLE adressieren.

### Pre-Checks vor Export-Start (Spec §8.1.1)

Vor dem `MediaRecorder.start()` muss VideoExporter prüfen:

1. **Audio geladen** — `mediaRefs.find(m => m.kind === 'audio' && m.duration)` muss
   existieren. Ohne Audio gibt es keinen Stream-Endpunkt und keine Lauflänge.
2. **Aktiver Image-Clip auf der Image-Track** — Spec verlangt das, sonst
   startet der Export mit schwarzem Frame. Check via
   `activeImageClips(timeline, 0).length > 0`.
3. **Playhead bei Beat 0** — Export läuft IMMER von vorne. Falls nicht
   bei 0: `timelineActions.setPlayhead(0)` + `engine.seek(0)` BEVOR Recording
   startet. Idealerweise im `start()`-Vor-Schritt.

Failing pre-check → `state.status = 'error'` mit Code (`'no-audio'`,
`'no-image'`) + Toast → kein MediaRecorder-Start.

### Stop-Mechanismus mit Safety-Net (Spec §8.1.6)

Recording stoppt durch ZWEI parallele Trigger:

```ts
// Primary: audio element fires 'ended' when duration reached
audioEl.addEventListener('ended', () => exporter.stop(), { once: true });

// Safety net: setInterval polls in case 'ended' didn't fire
// (e.g. last 0.1s of audio is silent and decoder finished early)
const safetyInterval = setInterval(() => {
  if (audioEl.currentTime >= audioEl.duration - 0.1) {
    clearInterval(safetyInterval);
    exporter.stop();
  }
}, 200);
```

Beide Cleanups (event listener removal + clearInterval) MÜSSEN auch
in `cancel()` greifen, sonst feuert das Safety-Net nach dem Cancel
und startet einen "zweiten" Stop.

### MediaRecorder Chunk-Timing

```ts
mediaRecorder.start(500); // 500 ms timeslice → chunks alle 500 ms
```

OHNE Timeslice-Arg sammelt MediaRecorder bis zum Stop in einem Buffer
— bei 3-Min-Track sind das ~135 MB Memory. Mit 500 ms streamen die
Chunks früh in `ondataavailable` und der Memory-Footprint bleibt klein.

### Bitrates (QAC-03)

```ts
const recorder = new MediaRecorder(combinedStream, {
  mimeType,                       // VP9+Opus / VP8+Opus / default
  videoBitsPerSecond: 6_000_000,  // 6 Mbps — Social-Media-Standard
  audioBitsPerSecond: 128_000     // 128 Kbps — saubere Stereo-Aufnahme
});
```

Diese Werte sind v0.1 fest. Plan 6.x oder v0.2 macht sie konfigurierbar.

### `AudioEngine.getAudioStream()` Getter

Aktueller Stand: `lib/audio/engine.ts` hält `streamDest:
MediaStreamAudioDestinationNode | null` privat in der Closure. Es gibt
KEINEN public Getter dafür. Plan 6 muss diesen hinzufügen:

```ts
// In AudioEngine interface:
getAudioStream(): MediaStream | null;

// Implementation:
getAudioStream(): MediaStream | null {
  return streamDest?.stream ?? null;
}
```

Ohne diesen Getter kann VideoExporter den Audio-Track nicht greifen.
Existierende AudioEngine-Tests müssen einen Smoke-Test für den neuen
Getter bekommen.

### `ExportState` Status-Machine statt `isExporting: boolean`

Ein einzelner Boolean verliert die Zwischenzustände. Spec §8 definiert:

```ts
export interface ExportState {
  status: 'idle' | 'preparing' | 'recording' | 'finalizing' | 'done' | 'error';
  progress: number;          // 0..1, derived from elapsed/total
  elapsedSeconds: number;
  totalSeconds: number;
  warning?: 'performance-degraded' | 'tab-hidden';
  errorCode?: 'no-audio' | 'no-image' | 'codec-unsupported' | 'recorder-failed';
}
```

Store-Feld also nicht `isExporting: boolean`, sondern:

```ts
exportState: ExportState   // transient, never persisted
```

Plus Action:
```ts
setExportState(patch: Partial<ExportState>): void
```

Der Export-Button checkt `status !== 'idle'` (deckt preparing /
recording / finalizing alle ab). Der REC-Indicator zeigt sich für
`status === 'recording'`. Cancel-Button für `status === 'recording'`.

### `URL.revokeObjectURL` mit 10-s-Verzögerung (Spec §8.1.7)

```ts
const url = URL.createObjectURL(blob);
anchor.href = url;
anchor.download = filename;
anchor.click();

// Don't revoke immediately — give the browser time to start the
// download. Some Chromium versions abort the download if the URL is
// revoked before the save-dialog opens.
setTimeout(() => URL.revokeObjectURL(url), 10_000);
```

### Codec-Display in der UI

Nach Codec-Detection und VOR Recording-Start: den gewählten Codec im
REC-Indicator-Tooltip oder als kurzer Toast anzeigen.
```ts
toast.info(`Export codec: ${codecLabel}`); // "VP9 + Opus" / "VP8 + Opus"
```

---

## Store-Änderungen

Siehe oben "Spec-Pflicht-Details / ExportState Status-Machine" — der Store
hält **`exportState: ExportState`** statt eines einzelnen Booleans, damit
die Zwischenzustände (preparing/recording/finalizing/done) für die UI
unterscheidbar sind.

Neues Feld in `UIState` (transient, nicht persisted):
```ts
exportState: ExportState  // default: { status: 'idle', progress: 0, elapsedSeconds: 0, totalSeconds: 0 }
```

Neue Top-Level-Action:
```ts
setExportState(patch: Partial<ExportState>): void
```

`exportState` darf **nie** in der `partialize`-Funktion landen. Patch-Semantik
weil viele Updates nur einzelne Felder ändern (progress, elapsedSeconds,
warning) — Full-Object-Replace würde unnötig viele Felder neu durchschicken.

> **Migration im Plan-Doc:** Falls der Architekt das Boolean lieber sieht
> (KISS-Argument), kann CC #1 in seinem Plan-Vorschlag dafür argumentieren.
> Aber dann verliert man das `'preparing'`-Window vor MediaRecorder-Start
> und das `'finalizing'`-Window während Blob-Assembly — beides Phasen wo
> Button bereits disabled gehört aber REC-Indicator noch NICHT sichtbar
> sein sollte.

---

## Housekeeping (Pflicht in Plan 6)

### jsdom-Stubs hochziehen

`URL.createObjectURL` und `File.arrayBuffer` sind noch inline als Stubs
in `tests/unit/integration/media-meta.test.ts` definiert. Diese Stubs
müssen in **`tests/vitest.setup.ts`** verschoben werden damit sie
global für alle Tests gelten. Kein neues Verhalten — nur Umzug.

### `KNOWN_LIMITATIONS.md` Export-Sektion ausfüllen

Die Sektion `## Export (Plan 6)` enthält noch den Placeholder-Text.
Nach Implementierung: mit den tatsächlichen Einschränkungen befüllen
(mindestens: Echtzeit-Export, Tab-Switch-Warnung, WebM nicht iOS-kompatibel,
Codec-Browser-Varianz).

---

## Was explizit NICHT in Plan 6 gehört

- R2 Upload des exportierten Videos (v0.2)
- MP4 / WebCodecs Export (v0.2, iOS-Kompatibilität)
- Stems-Export (separate Audiotracks — erst nach Plan 5.9 Multi-Track)
- Progress-Bar in Prozent (Echtzeit-Export hat keine sinnvolle
  Prozentzahl — Timecode reicht)
- Export-Qualitäts-Einstellungen (feste 6 Mbps für v0.1)

---

## Technische Hinweise

### SSR-Safety (Non-Negotiable)

`VideoExporter` greift auf `canvas`, `AudioContext` und `MediaRecorder`
zu — alles Browser-only. Die Klasse/das Modul muss mit
`import 'client-only'` oder einem `isClient()`-Guard geschützt sein.
Kein `window`-Zugriff auf Modul-Top-Level.

### AudioContext Destination Stream

Der `AudioContext` existiert bereits in `lib/audio/AudioEngine.ts`.
`VideoExporter` braucht eine Referenz darauf — entweder via
`useAudioEngine()` Hook oder direkt aus dem Store falls die Engine
dort registriert ist. Prüfe den aktuellen Stand vor dem Design.

### MediaRecorder in jsdom

`MediaRecorder` existiert in jsdom nicht. Für Unit-Tests:
`vi.stubGlobal('MediaRecorder', MockMediaRecorder)` oder eine
Test-Factory. Das Muster ist analog zu den bestehenden
`URL.createObjectURL`-Stubs.

### Filename Timestamp

```ts
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
// → "2026-05-20T14-30-00"
const filename = `vibegrid_export_${ts}.webm`;
```

Kein `undefined` im Filename (Acceptance Criteria AC-13).

---

## Verification Gate Zielwert

Baseline: 358 Tests.
Plan 6 soll mindestens **≥ 380 Tests** erreichen (Scope-Erhöhung wegen
ExportState-Statemachine + Pre-Checks + AudioEngine.getAudioStream).

Neue Test-Dateien (Mindest):
- `tests/unit/export/VideoExporter.test.ts` — ≥ 8 Tests
  (start mit allen Pre-Checks grün, start scheitert ohne Audio, start
  scheitert ohne Image-Clip, stop via 'ended'-Event, stop via
  safety-interval, cancel räumt beide Stop-Trigger auf, codec-Fallback-
  Kette wählt vp9 → vp8 → default, Filename-Format ohne `undefined`)
- `tests/unit/export/state-machine.test.ts` — ≥ 4 Tests
  (status transitions idle→preparing→recording→finalizing→done, error
  branches setzen status='error' + errorCode, warning-Felder werden
  von performance-monitor + tab-visibility separat gesetzt, cancel
  führt zurück zu idle)
- `tests/unit/audio/engine-stream.test.ts` — ≥ 2 Tests
  (`getAudioStream()` returnt null vor load, MediaStream nach load)
- `tests/unit/components/TopBar/ExportButton.test.tsx` — ≥ 4 Tests
  (disabled ohne Audio, disabled ohne Image-Clip, disabled wenn
  exportState.status !== 'idle', click startet Export)
- `tests/unit/components/TopBar/RecIndicator.test.tsx` — ≥ 3 Tests
  (sichtbar wenn status === 'recording', timecode aus elapsedSeconds,
  X-Button ruft cancel)
- `tests/unit/store/export-state.test.ts` — ≥ 4 Tests
  (setExportState patch-merges einzelne Felder, exportState nicht in
  localStorage nach persist, reset nach cancel zu status='idle' +
  elapsedSeconds=0, warning-Update überschreibt nicht den status)
- jsdom-Stub-Migration: `media-meta.test.ts` stubs nach
  `vitest.setup.ts` — kein neuer Test, aber bestehende Tests müssen
  weiterhin grün sein. Zusätzlich neuer `MediaRecorder`-Mock in
  `vitest.setup.ts` (siehe technische Hinweise)

### Commit-Struktur (Vorschlag)

```
chore(tests): move jsdom stubs to vitest.setup.ts
feat(store): isExporting UI state + setIsExporting action
feat(export): VideoExporter — MediaRecorder + codec detection
feat(export): WebM download + URL.revokeObjectURL cleanup
feat(topbar): ExportButton + RecIndicator + Cancel
feat(export): tab-switch warning toast
feat(export): performance FPS monitor + dropped-frames toast
docs(limitations): fill in Export section of KNOWN_LIMITATIONS.md
test: VideoExporter + ExportButton + RecIndicator coverage
```

---

## Acceptance Criteria Referenz

Die relevanten ACs aus `ACCEPTANCE_CRITERIA_V01.md`:
- **AC-13** — WebM Export, REC-Indicator, Filename, abspielbar in Chrome + VLC
- **AC-14** — Tab-Switch Warning, Performance-Toast, Export läuft weiter
- **AC-15** — Cancel stoppt Recording, kein Download, Playhead reset
- **QAC-03** — Mindest-Bitrate 6 Mbps Video + 128 Kbps Audio,
  VP9+Opus bevorzugt, kein schwarzer Screen am Anfang

---

## Format des Plans

Orientiere dich an **Plan 5.7** als Vorlage (inkl. Context-Block wenn
relevante Änderungen seit dem letzten Handoff-Dokument existieren):

- Header-Block: Goal, Architecture-Übersicht, Dependencies
- **File Map** (erstellt/modifiziert)
- **Tasks** mit Checkbox-Steps (`- [ ]`)
- Test-First pro Task (fail → implement → green)
- Ein Commit pro Task
- **Verification Gate** am Ende
- **Smoke Gate** (manuell, konkret abarbeitbar)
- **Risk + Watchlist** Tabelle

## Abgabe

Der Plan als `.md` Datei, bereit für den Architekt-Review.
Dateiname: `2026-05-20-vibegrid-plan-6-export.md`
