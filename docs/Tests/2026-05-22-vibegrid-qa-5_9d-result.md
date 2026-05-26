# VibeGrid QA-Report — Plan 5.9d: Multi-Audio + Volume-Automation + Video-Audio

Datum: 2026-05-22
QA: CC #2
Baseline-Hash: `a3f978d` (post-5.9c)
HEAD-Hash: `99ca9db` (post-5.9d)

---

## Gates

| Check | Status | Notiz |
|---|---|---|
| typecheck | ✅ | `tsc --noEmit` clean |
| lint | ✅ | `✔ No ESLint warnings or errors` |
| tests | ✅ | **653 Tests / 109 Files, 0 failing** (Baseline 617 + 36 — über die ≥637-Schwelle) |
| build | ✅ | Compiled successfully. Studio-Page `/` = **66.9 kB / 163 kB First Load JS**. 5 API-Routes alle 0 B Client-Bundle. Neue `/api/presign`-Route ist Dynamic |

**Bundle-Beobachtung:** 163 kB First Load. Die Baseline-Größe nach 5.9c wurde im Prompt nicht als Zahl genannt — kann gegen die "+5 %"-Klausel nicht hart geprüft werden. Plan 5.9d fügt `mixAudioOffline`, multi-clip API in `engine.ts` + Reconciler in `useAudioEngine` + Inspector-Sektionen hinzu. Wachstum ist plausibel für den Feature-Umfang.

---

## Phase 0 — Baseline

- HEAD-Commit-Message: `docs: KNOWN_LIMITATIONS — Plan 5.9d audio + video-audio + volume notes` ✅ exakt Task 8 wie erwartet
- Working tree: nicht clean (viele untracked docs/plans + neue Test-Reports — alles CC2/Plan-Doku-Territorium, kein Code-Untracked). **Kritischer Check:** `tests/unit/components/Inspector/volume-section.test.tsx` ist **getrackt** (kein vergessenes `git add`) ✅

---

## Phase 2 — Code-Review

| Check | Status | Belegstelle |
|---|---|---|
| AudioEngine Interface vollständig (9 neue Methoden + 5 alte erhalten) | ✅ | `lib/audio/engine.ts:7-55`. Alle Methoden: `loadClip`/`unloadClip`/`playClip(id, offsetSec, whenSec)`/`stopClip`/`stopAllClips`/`setClipVolume`/`rampClipVolume`/`getContextTime`/`getLoadedClipIds`. Alte `load`/`play`/`pause`/`seek`/`getDecodedBuffer` weiterhin da |
| `rampClipVolume` Anchor vorhanden | ✅ | `engine.ts:385-389` — `gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime)` ZUERST, dann `linearRampToValueAtTime(...)`. Doc-Block Z. 377-384 erklärt MDN-Footgun explizit |
| Seek-while-playing Branch B | ✅ | `useAudioEngine.ts:208-215` — `if (isPlaying && wasPlaying && playhead-changed) { stopAllClips(); startAllActiveClips(...); }`. Branch A für seek-while-paused steht direkt darüber (Z. 198-203) |
| `getLoadedClipIds` im Reconciler | ✅ | `useAudioEngine.ts:152` — `const loaded = new Set(engine.getLoadedClipIds());` |
| `getLoadedClipIds` im Cleanup-Return | 🟡 | **Nicht literal vorhanden** — die Effect-Cleanup gibt nur `return unsub;` zurück. **Aber kein Leak:** das Engine-Mount-Effect (Z. 73-76) ruft bei Unmount `e.destroy()` → `destroy()` in `engine.ts:400-426` räumt `clipSources`/`clipGainNodes`/`clipBuffers`-Maps via interne Iteration (Z. 408-416). Die QA-Prompt-Erwartung ist literal stringent — funktional aber redundant, weil `destroy()` den gleichen Job ohne externe Schleife erledigt. Kein FAIL aus meiner Sicht |
| `stopAllClips` (kein `seekAllClips`) | ✅ | `engine.ts:37` Interface, `:355` Impl. Rename ist konsistent angewendet (3 Aufrufe in `useAudioEngine.ts:194,202,213`) |
| `EXPORT_SAMPLE_RATE` Konstante | ✅ | `mix-audio-offline.ts:32` — `const EXPORT_SAMPLE_RATE = 48_000;` mit Doc-Block. Verwendung in Z. 59-60: `OfflineAudioContext(2, totalSamples, EXPORT_SAMPLE_RATE)` |
| Float-Loop fix in `applyVolumeAutomation` | ✅ | `mix-audio-offline.ts:124-130` — integer step count + clamp:`const steps = Math.ceil(...); for (let i = 0; i <= steps; i++) { const beat = Math.min(i * STEP, clip.lengthBeats); }`. Doc-Block Z. 121-123 erklärt IEEE-754-Akkumulationsbug |
| `addTrack('audio')` Soft-Reject weg | ✅ | `timeline-slice.ts:161-176` — kein `toast.error`, kein audio-Special-Case. Kommentar Z. 156-160 dokumentiert die Aktivierung. `defaultLabelFor` handelt "Audio"/"Audio 2"/"Audio 3" |
| `renderOffline` Signatur-Break | ✅ | `offline-render.ts:32-65` — `OfflineRenderDeps` hat KEIN `audioBuffer` mehr. Neue Felder: `audioClips: Clip[]`, `videoAudioClips: VideoAudioClip[]`, `mediaRefs: MediaRef[]`, `bpm: number`, `audioDurationSec`, `sampleRate`, `numberOfChannels`. `useVideoExporter.ts:217-230` baut beide Listen + übergibt sie an `renderOffline(...)` (Z. 247-281) |

---

## Phase 3 — Test-Coverage

| Test-File | Erwartet | Tatsächlich | Status |
|---|---|---|---|
| `engine-multi-clip.test.ts` | ≥ 8 | **8** | ✅ |
| `engine-sync.test.ts` | ≥ 2 | **2** (past-start + future-start) | ✅ |
| `useAudioEngine.test.tsx` | +5 neu, inkl. seek-while-playing | **8 total** (vorher 4) → +4 net, seek-while-playing Case enthalten | ✅ |
| `offline-audio-mix.test.ts` | ≥ 7 inkl. Clip-after-end + peak-NOT-triggered | **8** | ✅ |
| `audio-volume-ramp.test.ts` | ≥ 5 inkl. videoEl.muted Case | **6** | ✅ |
| `volume-section.test.tsx` | ≥ 3 | **3** (Slider-Default + Drag + ⚡-Button) | ✅ |
| `video-audio-toggle.test.tsx` | ≥ 2 | **3** | ✅ |
| `timeline-slice-audio.test.ts` | ≥ 2 (Audio 2/3 Labels) | **2** | ✅ |
| `track-actions.test.ts` | modifiziert, alter soft-reject Case weg | **14 Tests** (modifiziert, audio-soft-reject Case raus) | ✅ |

**Gezielter Sammel-Run (9 Files):** 54/54 Tests grün, 2.33 s.

---

## Phase 4 — Commit-Struktur

8 Commits in **exakt** der erwarteten Reihenfolge:

```
99ca9db docs: KNOWN_LIMITATIONS — Plan 5.9d audio + video-audio + volume notes      ← Task 8 ✅
b25e0f6 feat(export): mixAudioOffline + multi-clip audio + video-audio …            ← Task 7 ✅
f24d88a feat(inspector): volume slider for audio clips + video-audio toggle …       ← Task 6 ✅
f5f8d0e feat(video): per-clip audioEnabled toggle drives videoEl.muted              ← Task 5 ✅
752ff19 feat(renderer): per-frame rampClipVolume for active audio clips             ← Task 4 ✅
7e53cc1 feat(store): addTrack('audio') fully enabled — remove v0.2 stub             ← Task 3 ✅
d2de56c feat(audio): useAudioEngine multi-clip reconciler (Strict-Mode-safe)        ← Task 2 ✅
27979ac feat(audio): AudioEngine multi-clip API — load/play/stop/setVolume/rampVol  ← Task 1 ✅
```

Format `type(scope): description` durchgängig eingehalten. Keine squashed Commits, keine Reihenfolge-Drift.

---

## Phase 5 — KNOWN_LIMITATIONS

✅ Alle 5 erwarteten Einträge vorhanden in **`docs/KNOWN_LIMITATIONS.md:44-82`**, Abschnitt `## Plan 5.9d — Multi-Audio + Volume + Video-Audio`:

| # | Eintrag | Belegstelle |
|---|---|---|
| 1 | Video-Audio volume nicht automatable | Z. 46-49 |
| 2 | Volume-Automation auf 0.1-beat Raster im Export | Z. 58-61 |
| 3 | Peak-Normalisierung auf 0.95 | Z. 62-66 |
| 4 | Kein Per-Track-Master-Volume | Z. 67-70 |
| 5 | Kein Audio-Clip Trim / In-Out-Points | Z. 71-74 |

**Bonus-Einträge** (über die 5 erwarteten hinaus): EXPORT_SAMPLE_RATE 48 kHz Hinweis (Z. 50-57) + Single-buffer soundtrack double-volume Edge-Case (Z. 75-82). Beide sehr wertvoll.

🟡 **Aber: zwei `KNOWN_LIMITATIONS.md` driften auseinander.**

Im Repo existieren ZWEI Files:
- `KNOWN_LIMITATIONS.md` (Repo-Root)
- `docs/KNOWN_LIMITATIONS.md`

Die 5.9d-Einträge sind nur in der `docs/`-Variante. **Die Root-Variante (Z. 155-157) enthält noch den stale-falschen Eintrag aus 5.9c:**

```markdown
- **Multi-Audio-Tracks** are a v0.2 feature. The `'audio'` TrackKind
  exists in the type system (Plan 5.9a stub) but `addTrack('audio')`
  rejects with a toast.
```

Das **widerspricht direkt** der Plan-5.9d-Realität (`addTrack('audio')` ist aktiviert, kein Toast). User die in der Root-Variante nachschlagen bekommen falsche Info. Empfehlung: Root-File entweder aktualisieren ODER als veraltet markieren mit Verweis auf `docs/KNOWN_LIMITATIONS.md`. Plan 5.9d Task 8 hat das nur in `docs/` adressiert.

---

## Phase 6 — Smoke-Tests (manuell, Browser)

| Test | Status |
|---|---|
| S1 Multi-Audio anlegen | ⬜ nicht ausgeführt |
| S2 Clips auf mehrere Tracks | ⬜ nicht ausgeführt |
| S3 Sync-Playback | ⬜ nicht ausgeführt |
| S4 Seek-while-paused | ⬜ nicht ausgeführt |
| S5 Seek-while-playing (kritisch) | ⬜ nicht ausgeführt |
| S6 Volume Inspector | ⬜ nicht ausgeführt |
| S7 Volume-Automation smooth | ⬜ nicht ausgeführt |
| S8 Video-Audio Toggle | ⬜ nicht ausgeführt |
| S9 Export mit Audio-Mix | ⬜ nicht ausgeführt |
| S10 Backwards Compatibility | ⬜ nicht ausgeführt |

**Begründung:** Phase 6 erfordert echten Chrome + Mausinteraktion + Audio-Hörbarkeit (S3/S7 sind explizit "kein Zipper-Rauschen, smooth"). Das ist nicht headless automatisierbar. Empfehlung: Matthias führt S1–S10 manuell durch — die Code-Pfade sind aus der statischen Review bereits validiert (Bug #1 `getLoadedClipIds` Reconciler ✓, Bug #2 Seek-while-playing Branch B ✓, Anchor-Pattern ✓), das Restrisiko liegt nur noch in Live-Browser-Verhalten.

---

## Verdict

✅ **Freigegeben** — mit einer kleinen Doku-Inkonsistenz die separat behoben werden sollte:

- Alle 4 Gates grün
- Alle 9 Code-Review-Punkte erfüllt (8 ✅ + 1 🟡 ohne funktionalen Leak)
- Alle 9 erwarteten Test-Files existieren + grün (54 Tests im gezielten Sub-Run)
- Test-Count über der Schwelle (653 ≥ 637)
- 8 Commits in korrekter Reihenfolge
- KNOWN_LIMITATIONS hat alle 5 erwarteten Einträge in `docs/`

## Gefundene Issues

🟡 **I1 — Doppelte `KNOWN_LIMITATIONS.md` Files, Root-Variante ist stale:**
- `KNOWN_LIMITATIONS.md:155-157` enthält noch die alte Multi-Audio-v0.2-Aussage aus 5.9c
- `docs/KNOWN_LIMITATIONS.md:44+` hat den korrekten 5.9d-Block
- Plan 5.9d Task 8 hat nur die `docs/`-Variante aktualisiert
- **Empfehlung:** entweder Root-File aus dem Repo entfernen (single source of truth in `docs/`), oder die stale Multi-Audio-Zeilen 155-157 entfernen. Kein Blocker für Plan-Freigabe, aber sollte vor Release bereinigt werden.

🟡 **I2 — `getLoadedClipIds`-Cleanup-Erwartung literal nicht erfüllt:**
- QA-Prompt erwartet `for (const clipId of newEngine.getLoadedClipIds())` im Cleanup
- Code räumt stattdessen via `engine.destroy()` welches die internen `clipSources`/`clipGainNodes`/`clipBuffers`-Maps direkt iteriert (`engine.ts:408-416`)
- **Funktional kein Leak** — der Effekt ist identisch. QA-Prompt-Erwartung ist über-stringent.
- **Empfehlung:** keine Code-Änderung, ggf. QA-Prompt-Erwartung in Zukunft auf "destroy() räumt clipBuffers/clipGainNodes/clipSources" umformulieren.

ℹ️ **Phase 6 manuelle Browser-Smoke S1–S10 wurden nicht ausgeführt** — siehe Phase-6-Sektion. Statische Code-Pfade sind aber alle validiert.
