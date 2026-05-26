# VibeGrid QA-Report — Plan 5.9d: Multi-Audio + Volume-Automation + Video-Audio

**Datum:** 2026-05-21  
**QA:** CC #2  
**Baseline:** post-5.9c HEAD (617 Tests, Commits `d06b51c` / `b3c9ef0` / `a3f978d`)  
**Ziel-Tests:** ≥ 637  

> **Wichtig:** CC #2 schreibt KEINEN Code, repariert KEINE Bugs.
> Bei Failure: STOP, Befund dokumentieren, zurück an CC #1.
> Alle Befehle in **PowerShell** — kein Bash.

---

## Phase 0 — Baseline verifizieren

```powershell
git log --oneline -5
# Erwarte: letzter Commit enthält "docs: KNOWN_LIMITATIONS" (Task 8)

git status
# Erwarte: working tree clean — keine untracked/modified Files
```

Untracked Files die NICHT ok sind:
- `tests/unit/components/Inspector/volume-section.test.tsx` untracked
  → wäre ein vergessenes `git add` in Task 6. Sofort melden.

---

## Phase 1 — Automatisierte Gates

```powershell
npm run typecheck
```
Erwarte: **0 errors**. Besonders prüfen:
- `lib/audio/engine.ts` — Interface `AudioEngine` hat alle neuen Methoden
- `lib/export/offline-render.ts` — `OfflineRenderDeps.audioBuffer` ist weg
- `lib/hooks/useVideoExporter.ts` — übergibt `audioClips` / `videoAudioClips` statt `audioBuffer`

```powershell
npm run lint
```
Erwarte: **0 warnings, 0 errors**.

```powershell
npm test -- --run
```
Erwarte:
- **0 failing**
- Test-Count **≥ 637** (Baseline 617 + mind. 20 neue)

Test-Count notieren: `____` (in den Report eintragen)

```powershell
npm run build
```
Erwarte: **0 errors**, Bundle-Größe ≤ Baseline + 5 %.
Bundle-Größe notieren (aus Build-Output): `____`

---

## Phase 2 — Gezielte Code-Review via `git diff`

### 2a — AudioEngine Interface vollständig

```powershell
git show HEAD~7:lib/audio/engine.ts | Select-String "interface AudioEngine" -A 40
# Zeige die 7 Commits zurück (vor Plan 5.9d) — oder:
git log --oneline | Select-String "multi-clip API"
# Dann: git diff <hash-vor-task1> HEAD -- lib/audio/engine.ts
```

Manuell prüfen — folgende Methoden MÜSSEN im `AudioEngine` Interface stehen:

- [ ] `loadClip(clipId: string, url: string): Promise<void>`
- [ ] `unloadClip(clipId: string): void`
- [ ] `playClip(clipId: string, offsetSec: number, whenSec: number): void`
- [ ] `stopClip(clipId: string): void`
- [ ] `stopAllClips(): void`  ← KEIN `seekAllClips` — war ein Rename-Fix
- [ ] `setClipVolume(clipId: string, volume: number): void`
- [ ] `rampClipVolume(clipId: string, volume: number, targetTime: number): void`
- [ ] `getLoadedClipIds(): string[]`  ← war kritischer Bug #1
- [ ] `getContextTime(): number`
- [ ] Alte Methoden (`load`, `play`, `pause`, `seek`, `getDecodedBuffer`) noch vorhanden ✓

### 2b — `rampClipVolume` Anchor-Pattern

```powershell
git diff HEAD -- lib/audio/engine.ts | Select-String "rampClipVolume" -A 10
```

Die Implementierung MUSS so aussehen (Reihenfolge kritisch):

```ts
gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);   // ← ERST Anchor
gain.gain.linearRampToValueAtTime(..., targetTime);            // ← DANN Ramp
```

**FAIL** wenn `linearRampToValueAtTime` ohne vorangehendes `setValueAtTime` steht.
(Web Audio Footgun: Ramp startet von t=0 → Clip fadet von Stille ein.)

### 2c — `useAudioEngine` Seek-while-Playing Branch

```powershell
git diff HEAD -- lib/hooks/useAudioEngine.ts | Select-String "wasPlaying" -A 15
```

Im Subscribe-Block MÜSSEN zwei Seek-Branches vorhanden sein:

```ts
// Branch A — Seek-while-PAUSED:
if (!isPlaying && state.timeline.playhead.beats !== prev.timeline.playhead.beats) {
  newEngine.stopAllClips();
}

// Branch B — Seek-while-PLAYING (war kritischer Bug #2):
if (isPlaying && wasPlaying && state.timeline.playhead.beats !== prev.timeline.playhead.beats) {
  newEngine.stopAllClips();
  startAllActiveClips(...);
}
```

**FAIL** wenn Branch B fehlt — dann desynchronisiert Audio bei Playhead-Drag.

### 2d — `getLoadedClipIds` im Reconciler genutzt

```powershell
git diff HEAD -- lib/hooks/useAudioEngine.ts | Select-String "getLoadedClipIds"
```

Erwarte: Mindestens 2 Treffer:
1. Im `reconcile()`-Body: `new Set(newEngine.getLoadedClipIds())`
2. Im Cleanup-Return: `for (const clipId of newEngine.getLoadedClipIds())`

**FAIL** wenn Cleanup `getLoadedClipIds()` nicht nutzt — dann Leak beim Unmount.

### 2e — `mixAudioOffline` EXPORT_SAMPLE_RATE als Konstante

```powershell
git diff HEAD -- lib/export/mix-audio-offline.ts | Select-String "48"
```

Erwarte: `const EXPORT_SAMPLE_RATE = 48_000` (nicht `48000` hardcoded im `new OfflineAudioContext`-Call).

### 2f — `applyVolumeAutomation` Float-Loop

```powershell
git diff HEAD -- lib/export/mix-audio-offline.ts | Select-String "STEP" -A 8
```

Erwarte: Loop über Integer-Index, NICHT `beat += 0.1`:

```ts
// KORREKT:
const steps = Math.ceil(clip.lengthBeats / STEP);
for (let i = 0; i <= steps; i++) {
  const beat = Math.min(i * STEP, clip.lengthBeats);
  ...
}

// FALSCH (Float-Accumulation-Bug):
for (let beat = 0; beat <= clip.lengthBeats; beat += STEP) { ... }
```

### 2g — `addTrack('audio')` Soft-Reject entfernt

```powershell
git diff HEAD -- lib/store/timeline-slice.ts | Select-String "toast" -B 2 -A 2
```

Erwarte: Kein `toast.error` mehr im `addTrack`-Block für `'audio'`.
Der v0.2-Kommentar `'Multi-Audio-Tracks: kommt mit Plan 5.9d'` ist weg.

### 2h — `renderOffline` Signatur-Break korrekt

```powershell
git diff HEAD -- lib/export/offline-render.ts | Select-String "audioBuffer"
```

Erwarte:
- `audioBuffer: AudioBuffer` in `OfflineRenderDeps` ist weg (als Deletion markiert)
- `audioClips`, `videoAudioClips`, `mediaRefs`, `bpm` stehen als neue Felder drin

```powershell
git diff HEAD -- lib/hooks/useVideoExporter.ts | Select-String "audioClips"
```
Erwarte: `audioClips` und `videoAudioClips` werden gebaut und übergeben.

---

## Phase 3 — Test-Coverage-Check

```powershell
npm test -- --run --reporter=verbose 2>&1 | Select-String "✓|×|FAIL|PASS" | Select-Object -First 100
```

Folgende Test-Files MÜSSEN existieren und grün sein:

| Test-File | Mind. Cases | Prüfen |
|---|---|---|
| `tests/unit/audio/engine-multi-clip.test.ts` | ≥ 8 | `rampClipVolume anchors` explizit als Case |
| `tests/unit/audio/engine-sync.test.ts` | ≥ 2 | past-start + future-start |
| `tests/unit/hooks/useAudioEngine.test.tsx` | +5 neue | seek-while-playing Case vorhanden |
| `tests/unit/export/offline-audio-mix.test.ts` | ≥ 7 | clip-after-end + peak-NOT-triggered Cases |
| `tests/unit/renderer/audio-volume-ramp.test.ts` | ≥ 5 | videoEl.muted Case |
| `tests/unit/components/Inspector/volume-section.test.tsx` | ≥ 3 | Slider-Default + Drag + ⚡-Button |
| `tests/unit/components/Inspector/video-audio-toggle.test.tsx` | ≥ 2 | toggle + filename |
| `tests/unit/store/timeline-slice-audio.test.ts` | ≥ 2 | Audio 2 / Audio 3 Labels |
| `tests/unit/store/track-actions.test.ts` | modifiziert | alter "soft-rejects"-Case ist WEG |

```powershell
# Alle neuen Test-Files auf einmal prüfen:
npm test -- --run `
  tests/unit/audio/engine-multi-clip.test.ts `
  tests/unit/audio/engine-sync.test.ts `
  tests/unit/hooks/useAudioEngine.test.tsx `
  tests/unit/export/offline-audio-mix.test.ts `
  tests/unit/renderer/audio-volume-ramp.test.ts `
  tests/unit/components/Inspector/volume-section.test.tsx `
  tests/unit/components/Inspector/video-audio-toggle.test.tsx `
  tests/unit/store/timeline-slice-audio.test.ts `
  tests/unit/store/track-actions.test.ts
```

Erwarte: **0 failing** in allen 9 Files.

---

## Phase 4 — Commit-Struktur-Check

```powershell
git log --oneline main~8..main
```

Erwarte exakt 8 Commits in dieser Reihenfolge:

```
feat(audio): AudioEngine multi-clip API — load/play/stop/setVolume/rampVolume
feat(audio): useAudioEngine multi-clip reconciler (Strict-Mode-safe via useVideoEngine pattern)
feat(store): addTrack('audio') fully enabled — remove v0.2 stub
feat(renderer): per-frame rampClipVolume for active audio clips
feat(video): per-clip audioEnabled toggle drives videoEl.muted
feat(inspector): volume slider for audio clips + video-audio toggle + media-clip header
feat(export): mixAudioOffline + multi-clip audio + video-audio in offline render
docs: KNOWN_LIMITATIONS — Plan 5.9d audio + video-audio + volume notes
```

**FAIL** wenn Commits gepatcht/squashed sind oder Reihenfolge abweicht.

---

## Phase 5 — KNOWN_LIMITATIONS Vollständigkeit

```powershell
Get-Content docs/KNOWN_LIMITATIONS.md | Select-String "5.9d" -A 20
```

Erwarte Abschnitt `## Plan 5.9d` mit mindestens diesen Einträgen:
- [ ] Video-Audio volume nicht automatable
- [ ] Volume-Automation auf 0.1-beat Raster im Export
- [ ] Peak-Normalisierung auf 0.95
- [ ] Kein Per-Track-Master-Volume
- [ ] Kein Audio-Clip Trim / In-Out-Points

---

## Phase 6 — Smoke-Test (manuell, `npm run dev`)

```powershell
npm run dev
# Öffne http://localhost:3001
```

Folgende Steps in Chrome DevTools durchführen. **Bei jedem Fail: sofort stoppen.**

**S1 — Multi-Audio-Track anlegen**
- [ ] "+ Track hinzufügen" → Audio-Option sichtbar (war in 5.9c versteckt)
- [ ] Klick → neuer Track "Audio 2" erscheint
- [ ] Nochmal → "Audio 3" erscheint

**S2 — Audio-Clips auf mehrere Tracks**
- [ ] Audio-Datei A auf Track "Audio" (Lane 1) droppen → Clip erscheint
- [ ] Audio-Datei B auf Track "Audio 2" droppen → Clip erscheint
- [ ] Beide Clips haben unterschiedliche Farben / sind klar unterscheidbar

**S3 — Multi-Clip Sync-Playback**
- [ ] Play → beide Audio-Dateien starten synchron (kein Delay/Versatz hörbar)
- [ ] Pause → beide stoppen sofort
- [ ] Stop → Playhead zurück auf Beat 0

**S4 — Seek-while-Paused**
- [ ] Playhead auf Beat 8 ziehen (paused)
- [ ] Play → Clips starten an richtiger Position (nicht von Anfang)

**S5 — Seek-while-Playing** ← war kritischer Bug #2, muss explizit getestet werden
- [ ] Play starten
- [ ] Während Playback den Playhead auf Beat 4 zurückziehen
- [ ] Audio resynchronisiert sich sofort auf neue Position
- [ ] **FAIL wenn**: Audio läuft weiter ohne Resync (hörbar als Desync zwischen Playhead und Ton)

**S6 — Volume Inspector**
- [ ] Audio-Clip selektieren → Inspector öffnet mit Dateiname als Header
- [ ] Volume-Slider bei 100 % (Default)
- [ ] Slider auf ~30 % ziehen → Lautstärke des Clips fällt live (anderer Clip unverändert)
- [ ] ⚡-Button → AutomationEditor öffnet für `volume`-Parameter

**S7 — Volume-Automation**
- [ ] Im AutomationEditor: Kurve 0 → 1 über 4 Beats zeichnen → Schließen
- [ ] Play von Beat 0 → erste 4 Beats deutlich leiser, dann volle Lautstärke
- [ ] Kurve ist **smooth** — kein Zipper-Rauschen, kein Staircase-Artefakt
- [ ] **FAIL wenn**: Clip startet in Stille und faded langsam ein (= rampClipVolume Anchor fehlt)

**S8 — Video-Audio Toggle**
- [ ] Video-Clip selektieren → Inspector zeigt `audioEnabled`-Toggle (OFF by default)
- [ ] Toggle ON → Play → Video-Ton hörbar neben Audio-Clips
- [ ] Toggle OFF → Play → Video stumm

**S9 — Export mit Audio-Mix**
- [ ] Export starten → warten bis fertig
- [ ] MP4 in VLC öffnen → beide Audio-Clips hörbar
- [ ] Volume-Automation (0→1 über 4 Beats) im Export erhalten
- [ ] Wenn Video-Audio-Toggle ON war: Video-Ton im Mix

**S10 — Backwards Compatibility**
- [ ] Bestehendes v6-Projekt laden (pre-5.9d Snapshot)
- [ ] Keine Migration-Prompts, kein Fehler
- [ ] Bestehende Image + FX-Clips rendern unverändert
- [ ] Bestehende Audio-Clips (falls vorhanden) spielen mit Volume 1.0

---

## Ergebnis-Template

```markdown
# VibeGrid QA-Report — Plan 5.9d

Datum: 2026-05-21
QA: CC #2
Baseline-Hash: [git log --oneline -1 vor 5.9d]
HEAD-Hash: [git log --oneline -1 nach 5.9d]

## Gates
- typecheck: ✅ / ❌
- lint: ✅ / ❌
- tests: ✅ [XXX Tests] / ❌ [N failing]
- build: ✅ [Bundle: XXX kB] / ❌

## Code-Review
- AudioEngine Interface vollständig: ✅ / ❌
- rampClipVolume Anchor vorhanden: ✅ / ❌
- Seek-while-playing Branch vorhanden: ✅ / ❌
- getLoadedClipIds in Reconciler + Cleanup: ✅ / ❌
- stopAllClips (kein seekAllClips): ✅ / ❌
- EXPORT_SAMPLE_RATE Konstante: ✅ / ❌
- Float-Loop fix in applyVolumeAutomation: ✅ / ❌
- addTrack('audio') Soft-Reject weg: ✅ / ❌
- renderOffline Signatur: ✅ / ❌

## Test-Coverage
- engine-multi-clip (≥8): ✅ [N] / ❌
- engine-sync (≥2): ✅ / ❌
- useAudioEngine +5 neu + seek-while-playing: ✅ / ❌
- offline-audio-mix (≥7 inkl. Clip-after-end): ✅ [N] / ❌
- audio-volume-ramp (≥5): ✅ / ❌
- volume-section (≥3): ✅ / ❌
- video-audio-toggle (≥2): ✅ / ❌
- timeline-slice-audio (≥2): ✅ / ❌
- track-actions (alter soft-reject Case weg): ✅ / ❌

## Commit-Struktur
- 8 Commits, korrekte Reihenfolge: ✅ / ❌

## KNOWN_LIMITATIONS
- 5 Einträge vorhanden: ✅ / ❌

## Smoke-Tests
- S1 Multi-Audio anlegen: ✅ / ❌
- S2 Clips auf mehrere Tracks: ✅ / ❌
- S3 Sync-Playback: ✅ / ❌
- S4 Seek-while-paused: ✅ / ❌
- S5 Seek-while-playing (critical): ✅ / ❌
- S6 Volume Inspector: ✅ / ❌
- S7 Volume-Automation smooth: ✅ / ❌
- S8 Video-Audio Toggle: ✅ / ❌
- S9 Export mit Audio-Mix: ✅ / ❌
- S10 Backwards Compatibility: ✅ / ❌

## Verdict
✅ Freigegeben / ❌ Fixes needed

## Gefundene Issues (falls vorhanden)
...
```
