# CC #1 Prompt — Schreibe Plan 5.11: Export Performance Hotfix

## Kontext

Du arbeitest an **VibeGrid** (`C:\_Dev\VibeGrid`).

Baseline: aktueller HEAD post-5.10 (**675 Tests**, Store v6).

**Problem:** Ein 3-Minuten-Video braucht 15–20 Minuten zum Exportieren.
Ziel: unter 3 Minuten (1:1 Realtime oder besser).

Schreibe nur den **Plan** — noch keinen Code.
**Wichtig:** Lies vor dem Planen die relevanten Export-Files durch
(`lib/export/offline-render.ts`, `lib/export/mix-audio-offline.ts`,
der WebCodecs-Render-Loop) und stütze den Plan auf echten Code —
keine erfundenen Pfade oder Funktionsnamen.

---

## Schritt 0 — Profiling zuerst

Bevor Fixes geplant werden: den Render-Loop analysieren und die
tatsächliche Zeitverteilung dokumentieren. Im Plan festhalten:

- Wie viele Frames bei 30fps / 3min? (= N)
- Was passiert pro Frame? (seekAllTo, Canvas-Draw, VideoEncoder.encode, ...)
- Wo liegt die vermutliche Hauptbremse?

Drei bekannte Kandidaten — welcher trifft zu?

**Kandidat A — `seekAllTo` pro Frame mit Netzwerk-Roundtrips:**
Wenn Video-Assets von R2 geladen werden und jedes Seek einen
Decoder-Flush + Netzwerk-Request auslöst, multipliziert sich
das über tausende Frames. Fix: alle Assets vor Export-Start
vollständig in den Browser-Cache laden (pre-warm), dann erst
den Render-Loop starten.

**Kandidat B — Software-Encoding statt Hardware:**
`VideoEncoder` fällt ohne explizite Config auf Software-Encoding zurück.
Fix: `hardwareAcceleration: 'prefer-hardware'` in der `VideoEncoderConfig`.
Check: `VideoEncoder.isConfigSupported(config)` vor dem Start aufrufen
und ins Log schreiben ob Hardware verfügbar ist.

**Kandidat C — Zu hohe Frame-Rate:**
Bei 60fps und 3min = 10.800 Frames. Bei 30fps = 5.400 — halbe Zeit.
Fix: Export-Frame-Rate als Option anbieten (24 / 30 / 60fps),
Default auf 30fps setzen.

---

## Erwartete Fixes (nach Profiling konkretisieren)

### Fix 1 — Asset Pre-Warming vor Export-Start

Alle Video- und Audio-Assets die im Export-Zeitraum aktiv sind,
vor dem Render-Loop vollständig laden:

```ts
// Pseudocode — CC #1 passt auf echte Struktur an:
async function prewarmAssets(clips, mediaRefs) {
  // Für jeden Video-Clip: Video-Element laden + bis zum ersten Frame seeked warten
  // Für jeden Audio-Clip: AudioBuffer bereits via AudioEngine geladen ✓
  // Erst wenn alle Assets ready: Render-Loop starten
}
```

Ziel: kein Netzwerk-Request mehr während des Frame-Loops.

### Fix 2 — Hardware Acceleration explizit anfordern

```ts
// In VideoEncoderConfig:
{
  codec: '...',
  hardwareAcceleration: 'prefer-hardware',
  ...
}
```

+ `isConfigSupported` Check mit Console-Log damit der User sehen kann
ob Hardware-Encoding aktiv ist.

### Fix 3 — Export-Frame-Rate als Option

30fps als Default (war vermutlich 60fps hardcoded).
Option im Export-Dialog: 24 / 30 / 60fps.
Im Store oder als lokaler Export-State.

### Fix 4 — Fortschrittsbalken mit ETA

Macht den Export nicht schneller, aber erträglich:

```ts
// Pro Frame: (currentFrame / totalFrames) * 100 → Progressbar
// ETA: (elapsed / currentFrame) * remainingFrames → "noch ca. X Sekunden"
```

---

## Was CC #1 im Plan dokumentieren muss

Nach dem Coderead:
1. Tatsächliche Frame-Rate im aktuellen Export-Code (hardcoded?)
2. Ist `hardwareAcceleration` bereits gesetzt?
3. Wie läuft `seekAllTo` — wartet es auf ein Event oder ist es fire-and-forget?
4. Welcher der 3 Kandidaten ist der Hauptschuldige?
5. Realistisches Ziel nach Fix (Schätzung)

---

## File Map

CC #1 füllt die File-Map nach dem Coderead aus.
Erwartete Candidates:
- `lib/export/offline-render.ts` — Render-Loop, VideoEncoderConfig
- Export-Dialog-Komponente — Frame-Rate-Option + Progressbar
- Möglicherweise: Asset-Pre-Warm als neue Hilfsfunktion

---

## Tests

- Pre-Warm: alle Assets geladen bevor erster Frame gerendert wird
- Hardware-Acceleration: `isConfigSupported` wird aufgerufen
- Frame-Rate-Option: 30fps Default, konfigurierbar
- Progress: Callbacks werden pro Frame aufgerufen

Mindest: **≥ 6 neue Tests**

---

## Verification Gate

Baseline: **675 Tests**, 0 failing.
Ziel: **≥ 681 Tests**.

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Pflicht: Manueller Performance-Test:**
```
# 3-Minuten-Projekt mit 2-3 FX-Clips exportieren
# Zeitmessung: Start → Download-Dialog
# Ziel: unter 3 Minuten
# Console: "Hardware encoding: true/false" sichtbar
# Progressbar mit ETA während Export
```

---

## Commit-Struktur

Nach Profiling konkretisieren. Erwartetes Muster:

```
perf(export): prewarm video assets before render loop
perf(export): prefer-hardware in VideoEncoderConfig
feat(export): 30fps default + frame-rate option in export dialog
feat(export): progress bar with ETA during offline render
test: export performance — prewarm + hardware config + progress
```

---

## Out of Scope

- Web Worker für den Render-Loop (größeres Refactor, v0.2)
- Parallelisierung von Frames (nicht möglich mit WebCodecs — sequential by spec)
- Server-side Rendering (v0.2 mit Capacitor/Backend)

Abgabe: `2026-05-22-vibegrid-plan-5_11-export-performance.md`
