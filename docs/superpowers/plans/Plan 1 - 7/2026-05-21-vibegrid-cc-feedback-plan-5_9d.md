# CC Feedback — Plan 5.9d: Multi-Audio + Volume-Automation + Video-Audio

❌ **Nicht freigegeben** — 3 kritische Bugs, 5 Anmerkungen.

---

## Kritische Bugs (MUSS gefixt werden)

### Bug 1 — `AudioEngine` fehlt `getLoadedClipIds()` → Reconciler ist unimplementierbar

**Problem:**  
Task 2, Reconciler-Sketch, Zeile:

```ts
const loaded = new Set(/* engine's loaded clip ids */);
```

Das ist kein Code — das ist ein Platzhalter. Aber die `AudioEngine`-Interface
aus Task 1 enthält **keine Methode um die bereits geladenen Clip-IDs abzufragen**.
Der Reconciler MUSS bei jedem `clips`-Change diffren (wanted ↔ loaded),
sonst:

- Variante A: CC #1 ruft `loadClip()` immer auf → glitchender Audio-Re-Load
  mitten in der Wiedergabe (hörbare Stille-Blitze)
- Variante B: CC #1 erfindet eine Engine-Methode, die nicht im Interface steht →
  TypeScript-Error oder silent-any

**Fix:** Eine der beiden Varianten in Task 1 Step 3 ergänzen:

Option A (empfohlen — Engine ist Source of Truth):
```ts
// AudioEngine interface:
getLoadedClipIds(): string[];

// Implementation:
function getLoadedClipIds(): string[] {
  return [...buffers.keys()];
}
```

Option B (Hook hält eigenes Set):
```ts
// In useAudioEngine useEffect-Closure:
const loadedClipIds = new Set<string>();

// Nach loadClip: loadedClipIds.add(clipId)
// Nach unloadClip: loadedClipIds.delete(clipId)
```

Option A ist klarer. Task 1 Step 3 Interface-Block um `getLoadedClipIds()` ergänzen.

---

### Bug 2 — Seek-while-Playing nicht behandelt

**Problem:**  
Der Reconciler in Task 2 behandelt nur `seek-while-PAUSED`:

```ts
if (!isPlaying && state.timeline.playhead.beats !== prev.timeline.playhead.beats) {
  newEngine.seekAllClips(timeSec);
}
```

Wenn der User während der Wiedergabe den Playhead zieht (normaler Use-Case!),
gilt: `isPlaying = true`, `beats` ändert sich → Bedingung `!isPlaying` ist `false`
→ NICHTS passiert. Alle Clips laufen weiter an falscher Position.

Das ist reproduzierbar in Smoke-Gate Step 3 ("Pause works, Stop returns to beat 0")
— aber das Gate testet nicht *seek-while-playing*. Das würde bei Smoke-Gate Step 6
(Volume-Automation von Beat 0 abspielen) nicht direkt auffallen, aber im
echten Workflow sofort.

**Fix:** Im Subscribe-Block des Reconcilers die Play-Seek-Branch ergänzen:

```ts
// Seek-while-playing:
if (
  isPlaying &&
  state.timeline.playhead.beats !== prev.timeline.playhead.beats
) {
  // Stop all, dann sofort neu starten (mit neuer Position)
  newEngine.seekAllClips(timeSec);
  startAllActiveClips(state.timeline, newEngine, bpm, LOOKAHEAD);
}
```

Diese Branch NACH dem `isPlaying && !wasPlaying` Block einfügen
(nach dem Start-All-Block), NICHT davor — sonst doppelter Start beim
normalen Play-Button.

Außerdem: `timeSec` aus `state` berechnen (nicht `prev`):
```ts
const timeSec = (state.timeline.playhead.beats * 60) / bpm;
```

---

### Bug 3 — `rampClipVolume` ohne Anchor → Web Audio `linearRamp`-Footgun

**Problem:**  
Task 1 Step 3:

```ts
function rampClipVolume(clipId: string, volume: number, targetTime: number): void {
  gain.gain.linearRampToValueAtTime(volume, targetTime);
}
```

`linearRampToValueAtTime` MUSS eine vorherige Scheduled-Event haben, von der
aus gerampt wird. Ohne vorangehendes `setValueAtTime` definiert die Web-Audio-Spec
das Verhalten als "Ramp vom Beginn der Zeit" — was in der Praxis bedeutet:
Der erste Aufruf pro Clip startet einen Ramp von 0 (Stille) zum Zielwert.
**Hörbar als: jeder Clip startet mit Lautstärke 0 und faded langsam ein.**

Das ist ein klassischer Web-Audio-Footgun, der im Test nicht auffällt
(die Engine-Mocks stubben `linearRampToValueAtTime` als no-op), aber in der
Smoke-Gate-Session sofort hörbar ist.

**Fix:** Anchor vor jedem Ramp setzen:

```ts
function rampClipVolume(clipId: string, volume: number, targetTime: number): void {
  const gain = gainNodes.get(clipId);
  if (!gain) return;
  const ctx = ensureContext();
  // Anchor the current scheduled value so the ramp starts FROM here, not from t=0.
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(
    Math.max(0, Math.min(1, volume)),
    targetTime
  );
}
```

Das `setValueAtTime(gain.gain.value, ctx.currentTime)` ist idempotent (setzt
current value auf current time — kein Sprung) und gibt dem nachfolgenden Ramp
einen stabilen Startpunkt. In Tests: sicherstellen dass der Mock beide Calls
prüft.

---

## Anmerkungen (sollte gefixt werden, kein Blocker)

### 4 — `seekAllClips` — Naming irreführend

Die Methode heißt `seekAllClips(timeSec)` aber die Implementation ist
`stopAllClips()` — `_timeSec` wird nicht benutzt. Das ist kein Bug, aber
der Name verspricht Seeking (Restart an neuer Position) und liefert nur Stop.

CC #1 könnte die Methode falsch verstehen und davon ausgehen, dass die Clips
nach dem Aufruf automatisch an der neuen Position spielen — was zu Bug 2
führt (oder einer zweiten Variante davon).

**Empfehlung:** Entweder umbenennen zu `stopAllClips()` + Task 2 anpassen,
ODER den `timeSec`-Parameter wirklich nutzen (stopClip + intern seekPosition
merken für nächstes `playClip`). Da Task 2 sowieso `startAllActiveClips`
nach dem Stop aufruft, reicht umbenennen.

---

### 5 — `applyVolumeAutomation` — Floating-Point-Loop-Boundary

```ts
for (let beat = 0; beat <= clip.lengthBeats; beat += STEP) {
```

Mit `STEP = 0.1` und IEEE-754: `3.0 + 0.1 + 0.1 + ... + 0.1` akkumuliert
Rundungsfehler. Für `clip.lengthBeats = 4.0` kann die Schleife entweder bei
`3.9999...` stoppen (letzter Wert fehlt) oder bei `4.0000001` iterieren
(ein Extra-`setValueAtTime` nach Ende). Kein hörbarers Problem, aber
ein flaky-Edge-Case in den Tests.

**Fix:**
```ts
for (let beat = 0; beat <= clip.lengthBeats + STEP * 0.5; beat += STEP) {
  const clampedBeat = Math.min(beat, clip.lengthBeats);
  // ...
```
Oder: `Array.from({ length: Math.ceil(clip.lengthBeats / STEP) + 1 }, (_, i) => i * STEP)`.

---

### 6 — `sampleRate: 48000` hardcoded in `mixAudioOffline`

```ts
const offlineCtx = new OfflineAudioContext(2, totalSamples, 48000);
```

Kein funktionaler Bug (48 kHz ist der Standard für Video-Export), aber:
- Manche Browser auf älterer Android-Hardware unterstützen nur 44100 Hz für
  `OfflineAudioContext` — 48000 kann dort einen `NotSupportedError` werfen
- Der live `AudioContext` verwendet `sampleRate: undefined` (Browser-Default)
  → Live-Preview und Export-Mix haben potenziell unterschiedliche Sample-Rates
  → kein hörbarers Problem für den User, aber Inkonsistenz

**Empfehlung:** Als Konstante extrahieren + in `KNOWN_LIMITATIONS` erwähnen:
```ts
const EXPORT_SAMPLE_RATE = 48_000; // WAV/MP4 standard; see KNOWN_LIMITATIONS
```

---

### 7 — `VolumeSection.tsx` — kein Komponenten-Test

Das ist der Headline-Feature-Slider des Plans. Der File-Map-Block erstellt
`VolumeSection.tsx`, aber es existiert kein Test-File dafür.
`video-audio-toggle.test.tsx` testet nur den Toggle, nicht den Slider.

Tests für `VolumeSection` würden prüfen:
- Slider bei 100% wenn `volume` undefined (Default 1.0)
- Drag auf 50% → `clip.params.volume` wird 0.5
- ⚡-Button öffnet AutomationEditor für den `volume`-Param

Das ist laut Plan in Task 6 zu ergänzen. Mindestens 2 Cases.
Der +20-Test-Target wird trotzdem erreicht, aber Slider-Coverage fehlt.

---

### 8 — `source.start(startSec, 0)` wenn `startSec >= totalDurationSec`

In `mixAudioOffline`, wenn ein Audio-Clip nach dem Export-Ende beginnt
(z.B. Clip auf Beat 32, Export endet bei Beat 16):

```ts
source.start(startSec, 0); // startSec > totalDurationSec
```

`OfflineAudioContext` wirft in diesem Fall **keinen Error**, sondern
ignoriert den Node still — das ist OK. Aber die Tests decken diesen
Fall nicht ab. Kein Blocker, aber ergänzenswert in `offline-audio-mix.test.ts`
als 7. Case: "clip starting after export end renders silence, no throw".

---

## Was gut ist ✅

- **Architektur: Clip-zentriert, nicht Track-zentriert** — die Begründung
  in Architecture Insight 1 ist überzeugend und zukunftssicher (Video-Audio
  als "same path" ist besonders elegant).

- **`useVideoEngine`-Pattern als Blueprint** — die explizite Referenz auf
  Commit `6265582` und "Copy the structure" ist die richtige Anweisung.
  Strict-Mode-Safety durch ONE-master-useEffect ist hier entscheidend.

- **`rampClipVolume` vs. `setClipVolume`** — die Trennung von
  "per-frame ramp" (kein Zipper) vs. "instant set" (Seek/Stop) ist
  korrekt. Architecture Insight 2 erklärt das gut.

- **Kein Store-Versions-Bump** — `?? 1.0` / `?? false` als Defaults für
  fehlende Params in alten Snapshots ist sauber. Keine Migration nötig,
  keine Regressions-Gefahr.

- **`mixAudioOffline` Peak-Normalisierung** — richtig implementiert.
  `findPeak` + `normalizePCM` sind straightforward, korrekte Fallbacks.

- **Offline-Render-Signatur-Break** — Task 7 Step 5 "Update existing tests"
  explizit mit konkreten Dummy-Werten (`audioClips: [], ...`) — sehr gut,
  verhindert `undefined`-Panics in alten Tests.

- **Test-First-Disziplin** — Jeder Task hat failing-tests zuerst,
  dann Implementation. Struktur ist solide.

- **Smoke-Gate** — 9 Steps, konkret und vollständig. Besonders Step 6
  (AutomationEditor + hörbare Lautstärke-Kurve) und Step 8 (Audacity-Waveform)
  sind handfeste Gates für die Headline-Features.

---

## Summary

Die 3 kritischen Bugs sind alle im `AudioEngine`-/`useAudioEngine`-Layer
konzentriert (Task 1 + Task 2). Fixes sind chirurgisch — kein Redesign nötig:

| Bug | Fix-Umfang |
|---|---|
| 1 — `getLoadedClipIds()` fehlt | 1 Interface-Methode + 2 Zeilen Impl. |
| 2 — Seek-while-playing | 4 Zeilen in Subscribe-Block |
| 3 — `linearRamp`-Anchor | 1 Zeile in `rampClipVolume` |

Anmerkungen 4–8 können inline beim Implementieren als Notes dienen —
kein separates Feedback-Round nötig.

**Nächste Aktion:** CC #1 patcht Task 1 Step 3 (Interface + rampClipVolume)
und Task 2 Step 3 (loaded-Set-Quelle + seek-while-playing Branch).
Dann: freigegeben.
