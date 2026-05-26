# Plan 5.9d — Korrekturen vor Finalisierung

## B1 — Offline-Audio-Mixdown: vollständige Strategie

**Ein einziger `OfflineAudioContext` als Mix-Bus:**

```ts
// lib/export/offline-render.ts — Audio-Mixdown-Funktion:

export async function mixAudioOffline(
  clips: AudioClip[],
  mediaRefs: MediaRef[],
  bpm: number,
  totalDurationSec: number,
  videoAudioClips?: VideoAudioClip[]  // optional: Video-Audio-Quellen
): Promise<AudioBuffer> {
  const sampleRate = 48000;
  const totalSamples = Math.ceil(totalDurationSec * sampleRate);
  const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

  // Jeden Audio-Clip als BufferSource + GainNode in den Mix:
  for (const clip of clips) {
    const ref = mediaRefs.find(m => m.id === clip.mediaId);
    if (!ref) continue;
    const arrayBuffer = await fetch(ref.url).then(r => r.arrayBuffer());
    const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;

    const gain = offlineCtx.createGain();
    // Volume-Automation in den OfflineAudioContext einbrennen:
    applyVolumeAutomation(gain, clip, bpm, offlineCtx);

    source.connect(gain);
    gain.connect(offlineCtx.destination);

    const clipStartSec = (clip.startBeat * 60) / bpm;
    const clipOffsetSec = 0; // Clip läuft von Anfang
    source.start(clipStartSec, clipOffsetSec);
  }

  // Video-Audio: decodeAudioData aus dem Video-File, als extra Source:
  if (videoAudioClips) {
    for (const vc of videoAudioClips) {
      if (!vc.audioEnabled) continue;
      const arrayBuffer = await fetch(vc.url).then(r => r.arrayBuffer());
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
      } catch {
        continue; // Video hat keinen Audiotrack — kein Fehler
      }
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      // Video-Audio: kein GainNode (volume = 1.0 in v0.1)
      source.connect(offlineCtx.destination);
      const clipStartSec = (vc.startBeat * 60) / bpm;
      source.start(clipStartSec, 0);
    }
  }

  const mixedBuffer = await offlineCtx.startRendering();
  return mixedBuffer; // → in AudioEncoder
}

function applyVolumeAutomation(
  gain: GainNode,
  clip: AudioClip,
  bpm: number,
  ctx: OfflineAudioContext
): void {
  const STEP = 0.1; // Beats pro Automation-Sample
  for (let beat = 0; beat <= clip.lengthBeats; beat += STEP) {
    const vol = resolveParam(clip.params?.volume ?? 1.0, beat, clip.lengthBeats);
    const timeSec = (clip.startBeat + beat) * 60 / bpm;
    gain.gain.setValueAtTime(vol, timeSec);
  }
}
```

**Clipping-Prevention:** `OfflineAudioContext` clippt bei > 1.0 hart.
Wenn die Summe der Gains > 1.0 sein kann, normalisieren:

```ts
// Nach startRendering():
const peak = findPeak(mixedBuffer);
if (peak > 0.95) normalizePCM(mixedBuffer, 0.95 / peak);
```

`findPeak` + `normalizePCM`: reine Float32Array-Operationen, ≤ 10 LOC.

**Integration in `renderOffline`:** Die bestehende `audioBuffer: AudioBuffer`-Signatur
wird ersetzt durch die oben beschriebene `mixAudioOffline`-Funktion.
Der Rest der Export-Pipeline (AudioEncoder) bleibt unverändert.

---

## B2 — Live-Volume: `linearRampToValueAtTime` statt `gain.value`

```ts
// lib/renderer/loop.ts — für aktive Audio-Clips pro Frame:
const FRAME_DURATION = 1 / 60; // ~16.7ms

// STATT: deps.setClipVolume(clip.id, resolvedVolume);
// NEU:
deps.rampClipVolume(clip.id, resolvedVolume, audioCtx.currentTime + FRAME_DURATION);

// In AudioEngine:
rampClipVolume(clipId: string, volume: number, targetTime: number): void {
  const gain = gainNodes.get(clipId);
  if (!gain) return;
  gain.gain.linearRampToValueAtTime(
    Math.max(0, Math.min(1, volume)),
    targetTime
  );
}
```

`setClipVolume` bleibt für sofortige Sprünge (Seek, Stop) — 
`rampClipVolume` ist der neue Per-Frame-Pfad.

---

## B3 — Multi-Clip Sync: `playClip` Signatur + When-Berechnung

**Neue Signatur:**

```ts
playClip(clipId: string, offsetSec: number, whenSec: number): void
```

**When-Berechnung in `useAudioEngine`:**

```ts
const LOOKAHEAD = 0.05; // 50ms Buffer

function startAllActiveClips(currentBeat: number, bpm: number): void {
  const now = audioCtx.currentTime;
  const whenBase = now + LOOKAHEAD;

  for (const clip of timeline.clips.filter(isAudioClip)) {
    if (currentBeat > clip.startBeat + clip.lengthBeats) continue; // vorbei

    const clipStartSec = (clip.startBeat * 60) / bpm;
    const currentSec = (currentBeat * 60) / bpm;

    if (currentBeat >= clip.startBeat) {
      // Clip läuft bereits — mit offset starten
      const offsetSec = currentSec - clipStartSec;
      engine.playClip(clip.id, offsetSec, whenBase);
    } else {
      // Clip startet in der Zukunft
      const delaySec = clipStartSec - currentSec;
      engine.playClip(clip.id, 0, whenBase + delaySec);
    }
  }
}
```

`playClip` in der AudioEngine:

```ts
playClip(clipId: string, offsetSec: number, whenSec: number): void {
  // Alten Node stoppen falls vorhanden:
  stopClip(clipId);

  const buf = buffers.get(clipId);
  if (!buf) return;

  const source = audioCtx.createBufferSource();
  source.buffer = buf;
  const gain = gainNodes.get(clipId) ?? audioCtx.createGain();
  gainNodes.set(clipId, gain);
  source.connect(gain);
  gain.connect(audioCtx.destination);
  source.start(Math.max(audioCtx.currentTime, whenSec), offsetSec);
  sources.set(clipId, source);
}
```

---

## B4 — Test-Count: 20 konkrete Tests

```
tests/unit/audio/engine-multi-clip.test.ts     ≥ 6
tests/unit/export/offline-audio-mix.test.ts    ≥ 5  (NEU — Mixdown + Video-Audio)
tests/unit/renderer/audio-volume-ramp.test.ts  ≥ 3
tests/unit/components/Inspector/video-audio-toggle.test.tsx  ≥ 2
tests/unit/store/timeline-slice-audio.test.ts  ≥ 2  (addTrack audio jetzt erlaubt)
tests/unit/audio/engine-sync.test.ts           ≥ 2  (when-Berechnung + offset)
```

Gesamt: **≥ 20** — passt zur Verification Gate.

---

## W1 — `addTrack('audio')` Test-Update

`tests/unit/store/track-actions.test.ts:55` (Plan 5.9c) erwartet Toast
"Multi-Audio is v0.2". In Plan 5.9d:

```ts
// VORHER (5.9c-Test — LÖSCHEN oder UMKEHREN):
it('addTrack("audio") soft-rejects via toast', () => { ... });

// NACHHER (5.9d):
it('addTrack("audio") creates a new audio track', () => {
  const store = makeFreshStore();
  store.getState().timelineActions.addTrack('audio');
  const audioTracks = store.getState().timeline.tracks
    .filter(t => t.kind === 'audio');
  expect(audioTracks.length).toBeGreaterThan(1); // default + new
});
```

---

## W4 — `AudioClipState` Interface

```ts
// lib/audio/types.ts — explizit definieren:
export interface AudioClipState {
  clipId: string;
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  gainNode: GainNode;
  isPlaying: boolean;
}
```

---

## W5 — `useAudioEngine` baut auf `useVideoEngine` Muster

`useVideoEngine` (Plan 5.9b, Commit `6265582`) hat den Strict-Mode-Bug
via `engineRef.current`-Pattern gelöst. `useAudioEngine` soll dasselbe
Muster verwenden:

```ts
const engineRef = useRef<AudioEngine | null>(null);
// Engine erst in useEffect initialisieren (nicht direkt im Hook-Body)
// Subscription-Pattern: identisch zu useVideoEngine
```

Plan soll `useVideoEngine` als explizites Vorbild referenzieren.

---

## D1 — Plan-Header-Block (Pflicht)

Oben im Plan einfügen:

```
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> or superpowers:executing-plans to implement this plan task-by-task.
>
> **Project execution policy:** direct-on-main, sequential, one commit per task.
> NO superpowers-subagent-ceremony — CC #1 implements straight.
```

---

## D2 — Keine Store-Migration nötig

`volume`-Param und `audioEnabled`-Param sind in `clip.params` gespeichert.
`resolveClipParams` gibt den Default zurück wenn der Param fehlt
(`volume → 1.0`, `audioEnabled → false`). **Kein Versions-Bump, keine
Test-Fixture nötig.** Explizit im Plan dokumentieren:

```
Migration: Nicht nötig. Bestehende v6-Snapshots funktionieren als
v6-Snapshots weiter. Neue Params haben Defaults (volume=1.0,
audioEnabled=false). Store-Version bleibt 6.
```

---

## D3 — Konkrete Smoke-Gate-Schritte für Volume-Automation

```
# Volume-Automation 0→1 über erste 4 Beats:
# → Playback starten, die ersten 4 Beats deutlich leiser als der Rest

# Export: MP4 in Audacity öffnen
# → Amplituden-Anstieg in den ersten 4 Beats visuell sichtbar in der Wellenform
# → Ab Beat 4: konstante Amplitude
```

---

## D4 — KNOWN_LIMITATIONS konkrete Einträge

```markdown
## Audio (Plan 5.9d)
- Video-Audio-Volume ist nicht automatisierbar (nur on/off in v0.1).
  In v0.2: MediaElementAudioSourceNode + GainNode.
- Volume-Automation: 0.1-Beat-Raster im Offline-Export (kein
  kontinuierliches Scheduling). Bei langsamen Rampen hörbar smooth,
  bei schnellen Stabs (< 0.1 Beat) Quantisierungseffekt möglich.
- Offline-Audio-Mix normalisiert auf 0.95 peak falls Summe > 1.0.
  Loudness-Kompatibilität zu Streaming-Plattformen nicht geprüft.
```

---

## Verification Gate (aktualisiert)

```powershell
npm test -- --run   # ≥ Baseline + 20 Tests, 0 failing
npm run typecheck
npm run lint
npm run build
```
