# CC Feedback — Design Sektion 6: Export-Pipeline

✅ Freigegeben mit folgenden Korrekturen und Ergänzungen:

## Bug: canvas.captureStream(60) — falsche Framerate-Garantie

`captureStream(60)` ist ein *Hint*, keine Garantie. Auf schwächeren Geräten
liefert der Stream trotzdem weniger Frames. Wichtiger: 60fps bedeutet
auch 60fps im Output-File — für Social Media (Instagram, TikTok) ist
**30fps Standard** und führt zu kleineren Files bei gleicher Qualität.

```typescript
// ÄNDERN:
canvas.captureStream(30)  // 30fps für v0.1 — Social-Media-Standard

// Ergänzung in ExportOptions:
frameRate: 30 | 60;  // default 30
```

## Bug: audioElement.ended als Stop-Trigger ist unzuverlässig

`ended`-Event feuert nicht immer zuverlässig, besonders wenn Audio
kurz vor Ende geseekt wurde. Robusterer Stop-Trigger:

```typescript
// NICHT nur auf 'ended' verlassen:
audioElement.addEventListener('ended', stopRecording);

// ZUSÄTZLICH: Polling-Fallback als Safety-Net:
const durationCheck = setInterval(() => {
  if (audioElement.currentTime >= audioElement.duration - 0.1) {
    stopRecording();
    clearInterval(durationCheck);
  }
}, 200);

// Cleanup in cancel() auch clearInterval(durationCheck) aufrufen
```

## Ergänzung: Memory-Leak Verhinderung bei Blob-Download

`URL.createObjectURL(blob)` muss nach dem Download revoked werden,
sonst hält der Browser den Blob im Memory — bei großen Videos kritisch.

```typescript
// NACH dem Download-Trigger:
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = filename;
a.click();

// Wichtig — nach kurzem Timeout revoken:
setTimeout(() => URL.revokeObjectURL(url), 10_000);
```

## Ergänzung: Pre-Check um Codec-Support erweitern

Der Pre-Check vor Export-Start soll auch Codec-Support prüfen
und dem User kommunizieren welcher Codec genutzt wird:

```typescript
// Vor Export-Start in UI anzeigen:
const codec = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
  ? 'VP9 + Opus'
  : 'VP8 + Opus (Fallback)';
// Toast oder kleiner Indicator: "Export codec: VP9 + Opus"
```

## Ergänzung: Tab-Visibility Warning proaktiv anzeigen

Das ist eine bekannte Limitation — User muss das VOR dem Start wissen,
nicht erst wenn der Export kaputt ist.

```typescript
// Beim Start des Recordings sofort:
document.addEventListener('visibilitychange', handleVisibilityChange);

function handleVisibilityChange() {
  if (document.hidden && exportState.status === 'recording') {
    // Nicht stoppen — aber sofort warnen:
    setWarning('tab-hidden');
    showToast(
      '⚠️ Tab im Hintergrund — Export-Qualität beeinträchtigt. Tab aktiv halten!',
      { duration: 0 }  // persistent bis Tab wieder aktiv
    );
  }
}

// Cleanup in cancel() und nach 'done':
document.removeEventListener('visibilitychange', handleVisibilityChange);
```

## Kleinigkeit: ExportState um elapsed erweitern

Für den REC-Timecode im UI braucht die UI die vergangene Zeit.
`progress: number (0..1)` reicht allein nicht für "00:14 / 00:32":

```typescript
export interface ExportState {
  status: 'idle' | 'preparing' | 'recording' | 'finalizing' | 'done' | 'error';
  progress: number;           // 0..1 (time-based)
  elapsedSeconds: number;     // für Timecode-Anzeige im UI
  totalSeconds: number;       // Gesamtdauer des Exports
  warning?: 'performance-degraded' | 'tab-hidden';
}
```

## Bestätigung: Bekannte Limitierungen gut dokumentiert ✅

Die Liste (WebM/iOS, Tab-Switch, Codec-Varianz) ist vollständig und korrekt.
Bitte als `KNOWN_LIMITATIONS.md` im Repo committen, nicht nur als Code-Kommentar.
