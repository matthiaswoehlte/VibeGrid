# CC #1 Prompt — Schreibe Plan 5.9d: Multi-Audio-Tracks + Volume-Automation + Video-Audio

## Kontext

Du arbeitest an **VibeGrid** (`C:\_Dev\VibeGrid`).

Plan 5.9c (FX-Track Consolidation) ist abgeschlossen.
Baseline: aktueller HEAD nach 5.9c, alle Gates grün.

Schreibe nur den **Plan** — noch keinen Code.

---

## Was Plan 5.9d leistet

Drei zusammenhängende Features:

1. **Video-Audio Toggle** — Video-Clips können ihren eigenen Ton abspielen
2. **Multi-Audio-Tracks** — beliebig viele Audio-Tracks mit verschiebbaren
   Audio-Clips (wie Bild-Clips auf Image-Tracks)
3. **Volume-Automation** — jeder Audio-Clip hat einen `volume`-Parameter
   der als Automation-Kurve definiert werden kann

---

## Feature 1 — Video-Audio Toggle

### Clip-Parameter

```ts
// In den Video-Clip-Params (über paramSchema wie alle anderen FX):
interface VideoClipParams {
  audioEnabled: boolean;  // default: false (backwards-compatible)
}
```

### Inspector

Wenn ein Video-Clip selektiert ist: Toggle "Video-Audio" im Inspector.
`false` = Video stumm (wie heute). `true` = Video-Ton aktiv.

### Renderer

```ts
// In lib/renderer/loop.ts, beim Video-Draw:
const videoEl = deps.getVideoElement(clip.mediaId);
if (!videoEl) continue;

// Audio-State setzen:
const params = resolveClipParams(clip.params, ...);
videoEl.muted = !params.audioEnabled;

ctx.drawImage(videoEl, 0, 0, rc.width, rc.height);
```

**Wichtig:** `videoEl.muted` live setzen funktioniert — Browser
respektieren das sofort ohne Neustart des Elements.

### Lautstärke-Verhältnis

Video-Audio läuft über das `HTMLVideoElement` direkt (nicht durch
die AudioEngine). Das Volume-Verhältnis zwischen Video-Ton und
Audio-Tracks wird über den `volume`-Parameter der Audio-Clips gesteuert
(Feature 3). Video-Clip-Volume ist in v0.1 nicht automatisierbar —
nur on/off. Das ist der sauberste Ansatz ohne die Video-Audio-Pipeline
komplett neu zu bauen.

---

## Feature 2 — Multi-Audio-Tracks

### Konzept

Audio-Tracks funktionieren wie Image-Tracks: beliebig viele, mit
verschiebbaren und größenveränderbaren Clips. `addTrack('audio')` ist
nicht mehr geblockt (war in 5.9a als v0.2-Stub markiert).

### AudioEngine: Multi-Track-Support

Die aktuelle AudioEngine lädt **ein** Audio-File global. Mit Multi-Track
braucht jeder Audio-Clip seine eigene Dekodierung und seinen eigenen
Playback-Pfad:

```
AudioContext
  ├── AudioClip 1 (GainNode → destination)
  ├── AudioClip 2 (GainNode → destination)
  └── VideoEl Audio (direkt, nicht durch AudioEngine)
```

**Implementierung:**

```ts
// lib/audio/engine.ts — neue Methoden:
interface AudioEngine {
  // ... bestehende Methoden ...

  // Neu für Multi-Track:
  loadClip(clipId: string, url: string): Promise<void>;
  unloadClip(clipId: string): void;
  playClip(clipId: string, offsetSec: number): void;
  stopClip(clipId: string): void;
  setClipVolume(clipId: string, volume: number): void; // 0..1
  seekAllClips(timeSec: number): void;
}
```

Jeder geladene Clip bekommt:
- `AudioBuffer` (decoded)
- `AudioBufferSourceNode` (zum Abspielen)
- `GainNode` (für Volume)

Seek: `AudioBufferSourceNode` kann nicht geseekt werden — neues
`start(0, offsetSec)` nach `stop()`. Das ist das Standard-Pattern
für Web Audio API Seek.

### Store-Änderungen

`AudioMediaRef` bleibt in `MediaRef` mit `kind: 'audio'`. Audio-Clips
in der Timeline haben `clip.kind = 'audio'` und `clip.mediaId`.

Beim Playback: `AudioEngine` iteriert alle aktiven Audio-Clips über
alle Audio-Tracks und spielt sie synchron ab.

### Clip-Länge aus MediaRef

Wenn ein Audio-File auf einen Audio-Track gezogen wird:
```ts
lengthBeats = Math.round(mediaRef.duration * bpm / 60);
```
Gleiche Logik wie Video-Clips (aus dem totalBeats-Hotfix bekannt).

---

## Feature 3 — Volume-Automation

### Audio-Clip-Parameter

```ts
interface AudioClipParams {
  volume: number;  // 0..1, default: 1.0 — StaticOrAuto über paramSchema
}
```

`volume` ist ein normaler `StaticOrAuto<number>`-Parameter — der User
kann eine Automation-Kurve darauf legen wie bei jedem anderen FX-Param.

### Inspector

Wenn ein Audio-Clip selektiert ist:
- Volume-Slider (0..1, angezeigt als 0%–100%)
- ⚡-Button für Automation (wie bei FX-Params)
- Automation-Editor öffnet sich im Modal (Plan 5.7-R)

### Renderer-Integration

Der Renderer läuft im RAF-Loop — er kennt `currentBeat`. Der Volume-Wert
wird pro Frame aus dem resolved Param berechnet und an die AudioEngine
weitergegeben:

```ts
// In tick(), für jeden aktiven Audio-Clip:
const resolvedVolume = resolveClipParams(clip.params, currentBeat, ...);
deps.setClipVolume(clip.id, resolvedVolume.volume);
```

`setClipVolume` setzt den `GainNode.gain.value` — das ist sample-accurate
im AudioContext und verursacht keine Klick-Artefakte.

### Offline Render

Im Offline-Render läuft keine AudioEngine in Echtzeit — Audio wird
nach dem Render gemuxed. Volume-Automation für den Export:

Der `AudioEncoder` in `offline-render.ts` muss die Volume-Kurve auf
den Audio-Buffer anwenden. Das geschieht via `OfflineAudioContext`:

```ts
// Pro Audio-Clip:
const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);
const source = offlineCtx.createBufferSource();
source.buffer = audioBuffer;
const gain = offlineCtx.createGain();

// Volume-Automation in den OfflineAudioContext einbauen:
for (let beat = 0; beat <= clip.lengthBeats; beat += 0.1) {
  const vol = resolveParam(clip.params.volume, beat, clip.lengthBeats);
  const timeSec = beatToSec(beat, bpm);
  gain.gain.setValueAtTime(vol, timeSec);
}

source.connect(gain);
gain.connect(offlineCtx.destination);
source.start();
const rendered = await offlineCtx.startRendering();
```

Der gemixte Buffer wird dann in den `AudioEncoder` gegeben.

---

## Wichtige technische Entscheidungen

### Video-Audio vs. AudioEngine

Video-Ton läuft NICHT durch die AudioEngine. Das ist eine bewusste
v0.1-Entscheidung:
- Kein Sync-Problem zwischen HTMLVideoElement-Audio und AudioContext
- Kein Extra-GainNode für Video nötig
- Lautstärke-Verhältnis: Audio-Track-Clips haben Volume 0..1, Video-Ton
  läuft auf System-Lautstärke des Elements

Für v0.2 kann Video-Audio durch einen `MediaElementAudioSourceNode` in
die AudioEngine geroutet werden — dann ist alles über GainNodes steuerbar.

### Seek-Verhalten bei Multi-Audio

Wenn der User den Playhead seekt während mehrere Audio-Clips laufen:
1. Alle `AudioBufferSourceNode`s stoppen
2. Neue Nodes erstellen (Nodes sind one-shot in Web Audio)
3. Mit `start(0, offsetSec)` ab der korrekten Position starten

Das ist O(n) pro Seek — bei 5 Audio-Clips kein Performance-Problem.

### `AudioClip` in bestehenden Tests

Alle Tests die `initialTimelineState` als Literal nutzen und
`addTrack('audio')` testen müssen angepasst werden — der v0.2-Stub-Toast
wird entfernt.

---

## File Map

| Datei | Aktion |
|---|---|
| `lib/audio/engine.ts` | Modify — `loadClip`, `unloadClip`, `playClip`, `stopClip`, `setClipVolume`, `seekAllClips` |
| `lib/audio/types.ts` | Modify/Create — `AudioClipState` interface |
| `lib/hooks/useAudioEngine.ts` | Modify — Multi-Clip-Management, Sync mit Timeline |
| `lib/renderer/loop.ts` | Modify — `setClipVolume` pro Frame für aktive Audio-Clips + `videoEl.muted` |
| `lib/export/offline-render.ts` | Modify — `OfflineAudioContext` pro Clip mit Volume-Automation |
| `lib/store/timeline-slice.ts` | Modify — `addTrack('audio')` nicht mehr geblockt |
| `components/Inspector/` | Modify — Video-Audio-Toggle + Audio-Volume-Slider |
| `KNOWN_LIMITATIONS.md` | Modify — Video-Audio-Limitation aktualisieren |

---

## Tests

- `tests/unit/audio/engine-multi-clip.test.ts` — ≥ 6 Tests
  (loadClip, unloadClip, setClipVolume setzt GainNode, seekAllClips,
   playClip mit offsetSec, stopClip cleanup)
- `tests/unit/renderer/audio-volume.test.ts` — ≥ 3 Tests
  (setClipVolume wird mit resolvedVolume aufgerufen, muted-Flag)
- `tests/unit/export/offline-audio-volume.test.ts` — ≥ 3 Tests
  (OfflineAudioContext gain.setValueAtTime pro Beat)
- `tests/unit/components/Inspector/video-audio-toggle.test.tsx` — ≥ 2

---

## Verification Gate

Baseline: aktueller HEAD nach 5.9c.
Ziel: **≥ Baseline + 20 Tests**.

```powershell
npm test -- --run    # 0 failing
npm run typecheck
npm run lint
npm run build        # Bundle ≤ Baseline + 5%
```

## Smoke Gate

```
npm run dev
# Audio-Track hinzufügen → neue Spur in Timeline
# Audio-File auf Audio-Track → Clip als Balken, verschiebbar
# Zwei Audio-Tracks mit je einem Clip → beide spielen synchron
# Inspector: Volume-Slider für Audio-Clip → Lautstärke ändert sich live
# Automation auf Volume: Kurve definieren → Volume folgt Kurve beim Playback
# Video-Clip: Inspector zeigt "Video-Audio"-Toggle
# Video-Audio ON: Video-Ton hörbar während Playback
# Export: Volume-Automation im MP4 hörbar
```

---

## Commit-Struktur

```
feat(audio): AudioEngine multi-clip — loadClip/unloadClip/setClipVolume
feat(renderer): audio clip volume resolved per frame via GainNode
feat(video): audioEnabled param + inspector toggle for video clips
feat(timeline): addTrack('audio') fully enabled (remove v0.2 stub)
feat(export): offline OfflineAudioContext with volume automation per clip
feat(inspector): volume slider + automation for audio clips
test: multi-clip engine + volume renderer + offline audio coverage
docs(limitations): update video audio section
```

---

## Out of Scope

- Video-Audio durch AudioEngine geroutet (v0.2 — MediaElementAudioSourceNode)
- Audio-Clip-Trim / In-Out-Points (v0.2)
- Per-Track Master-Volume (v0.2)
- Audio-Visualizer Waveform für Audio-Clips (bereits für globalen Track,
  für Clips separates Feature)

Abgabe: `2026-05-21-vibegrid-plan-5_9d-multi-audio-volume.md`
