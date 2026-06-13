# CC #1 Prompt — Plan 9c.2: Playback-Clock-Fallback + Metronom (Rev. 2)

**Wenn kein Sync-Soundtrack auf der Sync-Audio-Spur liegt, treibt eine
AudioContext-basierte Fallback-Clock `currentTime` vorwärts. Zusätzlich:
ein hörbares Metronom/Taktel, das gegen diese Clock auf dem Beat läuft —
für FX-Tuning, wenn (noch) kein Audio im Projekt liegt.**

Vorgänger zu 9d (Loop-Wrap). 9ds Loop-Wrap setzt eine immer vorhandene,
getriebene Clock voraus — dieser Plan macht das wahr.

Baseline: HEAD post-Plan-11b. Test-Zahl + Store-Version in Schritt 0 bestätigen.

---

## ⚠️ Rev.-2-Korrektur (CC2-Review) — zuerst lesen

Rev. 1 modellierte `currentTime` als vorhandene Variable + zweite Zuleitung,
mit `performance.now()`-Clock. Beides falsch:

**B1 — keine audio-unabhängige `currentTime` heute:**
- `engine.state.currentTime` ist 100% Spiegel des `audioEl` (`engine.ts:151`,
  `timeupdate` → `setState`).
- `engine.seek()` (`engine.ts:187`) ist `if (audioEl) { audioEl.currentTime=… }`
  → ohne Soundtrack No-Op, bleibt 0.
- **Konsequenz:** Engine muss **erstmals eigene `currentTime`** besitzen,
  geschrieben von `audioEl` (wenn da) ODER Fallback-Clock (wenn nicht), und
  von `seek()` in **beiden** Modi.

**B2 — `performance.now()` driftet gegen Per-Clip-Audio:**
- „Kein Soundtrack" ≠ „kein Audio". Per-Clip-Audio (Library-Sounds, 8.7)
  läuft auf AudioContext-Clock (`engine.ts:343`).
- `performance.now()` ist zweite Zeitbasis → Drift über Minuten.

**Lösung beider:** Fallback-Clock aus `engine.getContextTime()`
(`engine.ts:392`, AudioContext-Delta + Play-Start- + Seek-Offset). Visuals
und hörbares Audio per Konstruktion gleiche Zeitbasis.

---

## Der ternäre Audio-Fall

| Fall | Zustand | Clock-Quelle |
|---|---|---|
| **(a)** | Sync-Soundtrack | `audioEl` (heute, unverändert) |
| **(b)** | kein Soundtrack, Per-Clip-Audio | AudioContext-Clock |
| **(c)** | gar kein Audio | AudioContext-Clock falls Gate 0.0 hält, sonst `performance.now()`-Hybrid |

Fall (c) ist realer Workflow (eigene Videos hochladen, FX testen, bevor Ton
da ist), kein Randfall.

---

## Schritt 0 — Codebase lesen (PFLICHT)

### Gate 0.0 — AudioContext-Zeit ohne gespielten Sound (Fall c, blockierend)

Läuft `audioContext.currentTime` zuverlässig vorwärts, wenn die Context nur
für die Clock existiert und **nie ein Sound gespielt** wird (auch nach
`resume()`)? Empirisch prüfen (Probe-Tick), nicht annehmen.
- Läuft → AudioContext-Clock für a/b/c.
- Läuft nicht → (c) nutzt `performance.now()`-Hybrid (Drift egal, nichts
  Hörbares da). a/b bleiben AudioContext.

### Pfade

1. ✅/⚠️ **Kanonische Zeit + Mirror:** `engine.state.currentTime` ← `audioEl`
   (`engine.ts:151`); `seek()` No-Op ohne `audioEl` (`engine.ts:187`);
   `getContextTime()` (`engine.ts:392`); Mirror `currentTime`(Sek) →
   `playhead.beats`(Beats), einseitig via `onStateChange`
   (`useAudioEngine.ts:97-109`). CC #1 bestätigt Ort der neuen kanonischen
   `currentTime`.
2. ✅/⚠️ **Werfender Play-Pfad (W1):** `Transport.toggle()` (`Transport.tsx:25`)
   → `engine.play()` wirft `Error('Audio not loaded')` (`engine.ts:170`) ohne
   `audioEl`; Throw verhindert `playhead.playing=true` → Reconciler
   (`useAudioEngine.ts:217`) startet nicht.
3. ⚠️ **Per-Clip-Audio-Erkennung:** Audio auf irgendeiner Spur (nicht nur
   Sync)? Bestimmt (b) vs (c).
4. ⚠️ **BPM-Quelle:** Store, überschreibbar, Live-Änderung. (Clock braucht
   BPM NICHT; Render-Loop liest ihn.)
5. ⚠️ **Beat-Quelle fürs Metronom:** `loop.ts:531`/`:309` — wo Beat-Index
   pro Tick entsteht. Metronom liest **dieselbe** Math, keine eigene.
6. ⚠️ **Taktart für Takt-1-Betonung:** vorhanden? Sonst 4/4 annehmen + doku.
7. ⚠️ **Top-Bar-Toggle-Ort** (neben BPM/Play); bestehende Toggle-Komponente.
8. ✅ **Undo/persist:** Playhead transient, `persist-shape.ts:33` forciert
   `playing:false`.
9. Test-Zahl + Store-Version: `npm test -- --run 2>&1 | grep -E "Tests|passed" | tail -3`

---

## BPM-Rolle (kein Geschwindigkeits-Denkfehler)

BPM treibt NICHT die Sekunden. 1 s Wall-Clock = 1 s `currentTime`. BPM ist
nur das Raster, aus dem der Render-Loop Beats ableitet (`loop.ts:309`,
`beats = currentTime * bpm/60`) — heute schon, unverändert. Fallback-Clock
liefert nur gleichmäßige Sekunden. Live-BPM-Änderung darf `currentTime`
**nicht** resetten.

---

## Teil 1 — Engine besitzt eigene `currentTime` + Dual-Clock

- Kanonische `currentTime` unabhängig vom `audioEl`.
- Geschrieben von `audioEl` (a) ODER Fallback-Clock (b/c); `seek()` schreibt
  in beiden Modi (B1-Fix).
- Über `setState`/`onStateChange` (W2), damit Mirror → Playhead → Render-Loop
  → Per-Clip-Reconciler folgen. **Nicht** direkt in `playhead.beats`.
- Clock-Quelle bei **Play-Start** + **Seek** festgelegt, nicht kontinuierlich
  → genau eine aktive Clock → keine Drift.

**Umschalt-Fälle:**
1. Soundtrack geladen während Fallback → nächster Play-Start nutzt `audioEl`.
2. Soundtrack entfernt während Playback → Fallback übernimmt ab aktueller Zeit.
3. Live-BPM-Änderung → `currentTime` unberührt, nur Beat-Raster verschiebt sich.

**W1:** `engine.play()` ohne `audioEl` startet die Fallback-Clock statt zu
werfen (oder Transport-Pfad so führen, dass `playhead.playing`+Reconciler
unabhängig vom werfenden Aufruf laufen). CC #1 wählt nach Code-Lage.

---

## Teil 2 — Metronom / Taktel

**Entscheidungen (final, keine offenen Punkte):**

| Aspekt | Entscheidung |
|---|---|
| Toggle | An/Aus in der Top-Bar neben BPM |
| Läuft mit Soundtrack? | **Ja** — auch mit Audio als Click-Track (DAW-Norm), nicht nur ohne |
| Klick | Synthetischer Oscillator-Ping (null Asset), kurze Hüllkurve |
| Takt-1-Betonung | Erster Schlag im Takt höher/lauter (4/4 falls keine Taktart) |
| Toggle-State | Persistent (Arbeitsraum-Präferenz, in persist-shape; **nicht** Undo, **nicht** Playhead-Snapshot) |
| Lautstärke | Fester dezenter Pegel über eigenen GainNode |
| Scheduling | **Look-ahead** auf AudioContext-Zeit (`source.start(when)`), NICHT pro RAF-Frame |

**Drift-Vermeidung:** Klick per `source.start(when)` auf AudioContext-Zeit —
dieselbe Basis wie Per-Clip-Audio und Fallback-Clock. Kein `setInterval`,
kein RAF-„jetzt klicken". Look-ahead-Scheduler plant alle paar ms voraus
(Per-Clip-Audio-Scheduling `engine.ts:343` als Vorbild). Klick liegt exakt
auf dem Beat, den die Visuals zeigen. Im 9d-Loop läuft das Metronom über den
Wrap korrekt weiter.

---

## Undo-Behaviour

- Clock-State / `currentTime`: Playback-Laufzeit, kein Dokument-State, nicht
  persistiert, nicht im Snapshot (folgt heutigem Playhead-Muster).
- Metronom-Toggle: persistent (überlebt Reload), aber **nicht** im
  Undo-Snapshot (Arbeitsraum-Präferenz, kein Dokument-State).

---

## Dateien (verifiziert + ⚠️)

| Datei | Aktion |
|---|---|
| `engine.ts` (⚠️ Stellen) | MODIFY — eigene `currentTime`; Fallback-Clock aus `getContextTime`; `seek()` in beiden Modi |
| `Transport.tsx:25` + Play-Pfad | MODIFY — W1: fehlender Soundtrack blockiert Play nicht |
| `useAudioEngine.ts:97-109` (Mirror) | ggf. MODIFY — Fallback-`currentTime` über `onStateChange` spiegeln |
| Clock-Modul (CREATE) | AudioContext-Delta-Clock (start/stop/seek); `performance.now()`-Hybrid nur falls Gate 0.0 es für (c) verlangt |
| Metronom-Modul (CREATE) | Look-ahead-Scheduler, Oscillator-Klick, Takt-1-Betonung, GainNode |
| Top-Bar-Komponente (⚠️ Pfad) | MODIFY — Metronom-Toggle neben BPM |
| Store + `persist-shape.ts` | MODIFY — Metronom-Toggle persistent (nicht Snapshot) |

Kein Eingriff in BPM→Beat-Math (`loop.ts:309`).

---

## Tests

**Clock (Teil 1):**
1. (B1-Anker) Kein Audio + Play → `currentTime` rückt vor (heute rot)
2. Fall (a): Soundtrack → `audioEl` treibt, unverändert (kein Regress)
3. Fall (b): kein Soundtrack + Per-Clip-Audio → AudioContext-Clock; Visuals+Audio
   gleiche Zeitbasis (Drift-Test)
4. Fall (c): gar kein Audio + Play → Clock rückt vor (AudioContext/Hybrid je Gate 0.0)
5. `seek()` ohne `audioEl` → springt korrekt (B1-Fix; heute No-Op)
6. Stop → Clock hält, kein Reset
7. Soundtrack entfernt während Playback → Fallback ab aktueller Zeit, kein Sprung
8. Soundtrack geladen → nächster Play-Start nutzt `audioEl`
9. Live-BPM-Änderung → `currentTime` unberührt
10. W1: Play ohne Soundtrack wirft nicht, `playhead.playing=true`, Per-Clip-Audio startet
11. W2: Fallback-`currentTime` über `onStateChange` → `playhead.beats` (nicht direkt)
12. Genau eine aktive Clock

**Metronom (Teil 2):**
13. Toggle an → Klick auf Beat-Grenzen; aus → kein Klick
14. Klick liegt auf AudioContext-Zeit (Look-ahead), nicht RAF-Jitter
15. Takt-1-Betonung (4/4 oder vorhandene Taktart)
16. Metronom + Fallback-Clock (kein Audio): Klick + Visuals beat-synchron
17. Metronom + Per-Clip-Audio: Klick + Audio beat-synchron (Drift-Test)
18. Metronom + Soundtrack: läuft als Click-Track mit
19. Toggle-State überlebt Reload (persistent), nicht im Undo-Snapshot
20. Im 9d-Loop: Klick läuft über Wrap korrekt weiter

---

## Commits (Vorschlag)

```
feat(engine): own canonical currentTime independent of audioEl (B1)
feat(engine): audiocontext-based fallback clock (start/stop/seek, ternary case)
fix(transport): play without soundtrack no longer throws (W1)
feat(metronome): look-ahead oscillator click scheduler on audiocontext time
feat(ui): metronome toggle in top bar + persistent state
test(9c2): clock fallback + ternary + switch + metronome drift + loop
```

6 Commits.

---

## Nicht im Scope

- Tempo-Automation / BPM-Kurven (BPM konstant pro Projekt, live editierbar)
- Variable Frame-Rate / Slow-Motion
- 9d-Loop-Wrap selbst (Plan 9d; dieser Plan macht ihn möglich)
- Count-in vor Aufnahme (keine Audio-Aufnahme im Tool)
- Regelbare Metronom-Lautstärke (fester Pegel; später erweiterbar)
- Klick-Samples (synthetischer Oscillator reicht)

---

## Verhältnis zu 9d

Nach 9c.2 behält 9d die Annahme „immer eine getriebene Clock". Loop-Wrap
wrappt `currentTime`, egal welche Quelle treibt. 9d-Test 16 wird echter
End-to-End-Test. Reihenfolge: 9c.2 → 9d-Loop-Wrap; übrige 9d-Schritte
clock-unabhängig, parallel/vorher.

---

## Architekt-Checkliste

- [ ] Gate 0.0: AudioContext-Zeit ohne Sound empirisch geprüft (AudioContext vs Hybrid für c)
- [ ] B1: Engine besitzt eigene `currentTime`, beide Quellen + `seek()` (Test 1+5)
- [ ] B2: Fallback aus `getContextTime`, nicht `performance.now()` (Test 3 Drift)
- [ ] Ternärer Fall a/b/c, Per-Clip-Erkennung (Schritt 0 #3)
- [ ] W1 entschärft (Test 10); W2 Schreibziel `onStateChange` (Test 11)
- [ ] Fall (a) kein Regress (Test 2)
- [ ] Metronom: dieselbe Beat-Quelle, Look-ahead auf AudioContext (Test 14)
- [ ] Metronom Drift-Tests grün (16+17); läuft im 9d-Loop (20)
- [ ] Metronom-Toggle persistent, nicht im Snapshot (Test 19)

---

Rev. 2 — Clock-Fallback (AudioContext, ternär, Gate 0.0) + Metronom in einer
Datei. Alle Metronom-Entscheidungen final. ⚠️ = Schritt-0-Pflicht.
