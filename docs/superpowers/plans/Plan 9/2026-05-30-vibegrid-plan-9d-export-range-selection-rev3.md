# CC #1 Prompt — Plan 9d: Export Range Selection + Loop Preview (Rev. 3)

**Time-Selection auf dem Timeline-Header (Ctrl+Drag) → Loop-Preview und
Export beschränken sich auf den markierten Zeitausschnitt.**
Plain-Click auf den Header hebt die Range auf.

FL-Studio-Time-Selection / NLE-In-Out-Range-Äquivalent. Range ist
**ephemeral** — nicht Teil der Undo-History (wie Multi-Select aus 9b).

Baseline: HEAD post-Plan-11b. Test-Zahl + Store-Version in Schritt 0 bestätigen.

---

## ⚠️ Rev.-3-Korrektur gegenüber Rev. 2 — bitte zuerst lesen

Rev. 2 spezifizierte eine **Pre-Roll-Architektur** (alle Schichten von t=0
bis `rangeStart` evaluieren, um Zustand aufzubauen). **Das war falsch** und
ist in Rev. 3 vollständig gestrichen. Begründung aus dem CC #1 Pre-Review:

Der VibeGrid-Render-Loop ist **pro Frame zustandslos** — jeder Frame wird
allein aus der absoluten Zeit rekonstruiert, es wird kein Zustand über
Frames akkumuliert:

- `loop.ts:309` — `beats = ((time - offsetMs/1000) * bpm) / 60`. Absolut,
  keine Akkumulation.
- `loop.ts:531` — `subdivisionIndex = Math.floor(beats * multiplier)`.
  FX-Seeds (GlitchSlice, RetroVHS) hängen daran → aus absoluter Zeit
  abgeleitet, nicht Frame-für-Frame aufgebaut.
- `loop.ts:604` — Automation via `resolveClipParams(…, paramBeat, …)` an
  absoluter Beat-Position. Keyframe-Interpolation ist reine Funktion der
  Abfragezeit — der Wert bei t=30 braucht keine Historie von t=5–30.
- `loop.ts:327–332` — der einzige Frame-übergreifende State
  (`lastFiredByClip`, `lastFiredSubdivisionByClip`) wird bei jedem Seek
  über den `seekCounter` geleert.

**Konsequenz:** Es gibt keinen Zustand aufzubauen. Loop-Wrap = Seek nach
`rangeStart` — und Seek existiert bereits, wird bei jedem Scrubben benutzt.
Pre-Roll würde Zustand rendern, der nicht existiert, und wäre netto
technische Schuld. Gestrichen.

Die einzige reale „Pre-Roll"-Restmenge: Export rendert bei **absoluter t**
mit **range-relativem Output-Index**. Das ist trivial, keine Architektur.

---

## Schritt 0 — Codebase lesen (PFLICHT)

### 0.0 — Das Architektur-Gate (zuerst, blockierend)

**Der gesamte Plan steht und fällt mit dieser einen Verifikation.**

Reproduziert ein Seek auf absolute Zeit `t` denselben Frame, egal über
welchen Pfad man dort hinkommt (durchlaufendes Playback vs. direkter Seek
vs. Loop-Wrap)?

- Code legt das stark nahe (zustandsloser Loop, siehe oben).
- **Aber:** CC #1 hat im Pre-Review `loop.ts`/`engine.ts` gelesen, **nicht
  jeden FX-Plugin-internen State.** Falls ein FX echt über Frames
  akkumuliert (Partikel, die Position integrieren; ein Feedback-/
  Ping-Pong-Buffer; ein WebGL-Render-Target, das den Vorframe liest),
  bräuchte dieser FX beim Seek/Wrap eine Sonderbehandlung.
- Das Gegenargument („wäre das so, wäre Scrubben heute schon kaputt") ist
  stark — aber **muss verifiziert werden, nicht angenommen.**

**Konkret:** Jeden FX-Plugin-`render()` daraufhin prüfen, ob er Output aus
einem vorherigen Frame liest (akkumulierender Buffer, integrierte Position,
Feedback-Textur). Besonders verdächtig: Particle, Dissolve, RetroVHS, alle
WebGL2-FX mit Render-Targets.

- **Gate hält** (kein FX akkumuliert) → Seek-Modell, Plan wie unten.
- **Gate hält nicht** (≥1 FX akkumuliert) → CC #1 meldet zurück, **bevor**
  er weiterbaut; betroffene FX brauchen Reset-on-Seek, das ist dann ein
  eigener Scope.

### 0.1–0.9 — Verifizierte Pfade (Refs aus Pre-Review, von CC #1 bestätigen)

1. ⚠️ **Header-Klick-Semantik heute.** Timeline-Header/Ruler-Komponente
   (Pfad bestätigen). Macht ein Linksklick heute schon etwas
   (Playhead-Seek)? → entscheidet, ob Plain-Click-Clear konfliktfrei ist.
   CC #1 dokumentiert die gefundene Semantik mit Datei:Zeile.

2. ⚠️ **Pointer-Handler auf dem Header.** `onPointerDown/Move/Up`.
   macOS: `metaKey` neben `ctrlKey`.

3. ⚠️ **Pixel↔Zeit-Mapping.** Bestehende Umrechnung Pixel-X →
   Sekunden/Beats (Zoom, Scroll-Offset) — exakt wiederverwenden.

4. ⚠️ **Beat-Snap (Plan 8d).** Snap-Helper. Range-Kanten snappen auf
   Beat/Bar. Snap-Toggle/Modifier-Konvention bestätigen.

5. ⚠️ **Ephemeral-State-Präzedenz (9b).** `lib/store/` — wo lebt
   Multi-Select-State? Im Undo-Snapshot oder außerhalb? 9d folgt exakt
   diesem Pfad. Plan-10-`skip`-Flag bestätigen. Datei:Zeile notieren.

6. ✅ **Playback-Treiber + Seek (verifiziert im Pre-Review):**
   - `engine.ts:355–365` — `stopAllClips()`, vom Reconciler bei Seek
     genutzt; ruft danach `playClip` für jeden aktiven Clip neu auf.
   - `engine.ts:328–345` — `playClip(clipId, offsetSec, whenSec)` →
     `source.start(when, offsetSec)`. Buffer-Offset bei `rangeStart` =
     `rangeStart - clipStart`, direkt berechnet. O(Clips)-Seek.
   - `seekCounter` als Invalidierungs-Mechanismus (`loop.ts:327–332`).
   CC #1 lokalisiert den Playback-Treiber (wo `currentTime` pro Tick
   vorrückt) und den Spacebar-Handler.

7. ✅ **Render-Pfade (verifiziert — Rev.-2-Geisterpfad korrigiert):**
   - `lib/renderer/offline-tick.ts` — Frame-Tick
   - `lib/export/offline-render.ts` — Export-Orchestrierung
   - `lib/export/mix-audio-offline.ts` — Audio-Mix offline
   - (`lib/renderer/offline-render.ts` aus Rev. 2 **existiert nicht**)

8. ⚠️ **Projektlänge / Timeline-Ende** — Quelle der Gesamtdauer
   (Clamp + Fallback). Datei:Zeile.

9. ⚠️ **VideoDecoderPool-Seek.** `resetAllSources()` ist laut Pre-Review
   der Export-Start-Fix, kein Per-Seek-Ding. Bestätigen, dass ein
   Loop-Wrap-Seek denselben Pfad wie bestehendes Scrubben nimmt.

10. Test-Zahl + Store-Version:
    `npm test -- --run 2>&1 | grep -E "Tests|passed" | tail -3`

---

## Feature 1 — Range Selection (Header-Interaktion)

| Geste | Verhalten |
|---|---|
| **Ctrl+Drag** (Cmd macOS) über Header | Range aufziehen — dunkles Orange-Band, snappt auf Beat/Bar |
| **Plain-Click** auf Header | Range aufheben (+ ggf. Playhead-Seek, siehe 0.1) |
| **Ctrl+Drag** bei existierender Range | Range neu setzen |

### State

```ts
exportRange: { start: number; end: number } | null  // Sekunden, absolut
```

- `null` = keine Range = normales Verhalten (Default)
- **Außerhalb des Undo-Snapshots** + **aus persist-shape ausgeklammert** (R6)
- Set/Clear via Mutator mit `skip`-Flag (Plan-10-Pattern, 9b-Vorbild)

### Normalisierung (Pflicht)

- Rückwärts (`start > end`) → swappen
- Null-Länge (`start === end` nach Snap) → `null`
- Clamp an `[0, projectDuration]`

---

## Feature 2 — Loop-Preview (Seek-Modell)

Loop-Preview reduziert sich auf: **Playback-Treiber wrappt `currentTime`
bei `rangeEnd` → `rangeStart`, bumpt den `seekCounter`, Reconciler startet
Clips am Offset neu.** Alle drei Mechanismen existieren bereits.

### Loop-Verhalten (vollständig)

| Playhead-Position bei Play/Space | Verhalten |
|---|---|
| **Vor `rangeStart`** | Spielt normal; erreicht `rangeEnd` → wrap zu `rangeStart` |
| **Innerhalb `[rangeStart, rangeEnd]`** | Loopt sofort |
| **Nach `rangeEnd`** | Spielt bis Projektende, **kein** Loop |
| **Keine Range aktiv** | Normales Play, unverändert |

**Stop:** Playhead bleibt stehen wo er ist — kein Auto-Reset.

### Wrap-Mechanik

Bei `currentTime >= rangeEnd` (und nur wenn Playhead bei Play-Start nicht
schon hinter `rangeEnd` war):

1. `currentTime = rangeStart`
2. `seekCounter++` → leert `lastFiredByClip` / `lastFiredSubdivisionByClip`
   (`loop.ts:327–332`)
3. Reconciler: `stopAllClips()` → `playClip` pro aktivem Clip mit
   `offsetSec = rangeStart - clipStart`

Das ist **identisch** zum heutigen Scrub-Verhalten. Kein neuer State-Cache,
keine Invalidierungs-Maschinerie.

---

## Feature 3 — Export mit Range

- Range aktiv → Export emittiert nur Frames `[rangeStart, rangeEnd]`
- **Sampling bei absoluter t**, Output-Frame-Index **range-relativ**:
  `outputFrame = round((t - rangeStart) * fps)`. Das Video beginnt bei
  Frame 0, ein Clip bei abs. Sekunde 30 wird mit absoluter Phase gerendert.
  Das ist die einzige „Pre-Roll"-Restmenge — trivial.
- **Audio als Windowing** (nicht Pre-Roll), via `mix-audio-offline.ts`:
  Clips bei `clipStart - rangeStart` schedulen, Fenster
  `[0, rangeEnd - rangeStart]` slicen. Clips, die vor `rangeStart` beginnen
  und hineinragen, mit negativem Schedule-Offset korrekt anschneiden.
- Keine Range → identisch zur Baseline (volles Projekt).

---

## Bekannte Limitierung (akzeptiert, dokumentieren)

**Audio-Wrap-Glitch:** Beim Loop-Wrap ersetzt `playClip` die one-shot
BufferSources — ein kurzer Übergang ist möglich. **Das ist das heutige
Scrub-Verhalten**, kein neuer Defekt. Akzeptiert; in `KNOWN_LIMITATIONS`
notieren statt zu „lösen" (eine Cross-Fade-Lösung wäre Scope-Creep für ein
Nicht-Regressions-Problem).

---

## Design-Token (NEU)

```css
--range-select-fill: rgba(255,140,0,0.18)   /* Band-Füllung */
--range-select-edge: rgba(255,140,0,0.85)   /* Kanten/Griffe */
```

Klar abgesetzt von Multi-Select-Optik (9b). Token-Datei-Ort in Schritt 0
bestätigen.

---

## Undo-Behaviour

| Action | Behandlung |
|---|---|
| Range erstellen (Ctrl+Drag) | `skip` — kein Undo-Eintrag |
| Range aufheben (Plain-Click) | `skip` — kein Undo-Eintrag |
| Undo/Redo während Range aktiv | Range bleibt **unverändert** |

Range nicht im Undo-Snapshot, nicht in persist-shape (R6). Undo/Redo darf
Range weder zurücksetzen noch wiederbeleben. Exakt wie Multi-Select (9b).

---

## Dateien (verifiziert + ⚠️ zu bestätigen)

| Datei | Aktion |
|---|---|
| `lib/store/` (9b-State-Ort, ⚠️) | MODIFY — `exportRange`-State + `set/clearExportRange` (`skip`), aus persist-shape ausklammern |
| `lib/export/offline-render.ts` | MODIFY — Range-Bounds + range-relativer Output-Index |
| `lib/renderer/offline-tick.ts` | MODIFY (falls nötig) — absolute t, range-relativer Index |
| `lib/export/mix-audio-offline.ts` | MODIFY — Audio-Windowing (clipStart−rangeStart, Fenster-Slice) |
| Playback-Treiber (⚠️ Pfad) | MODIFY — Wrap `currentTime` bei `rangeEnd`→`rangeStart`, `seekCounter++` |
| Timeline-Header-Komponente (⚠️ Pfad) | MODIFY — Ctrl+Drag Range, Plain-Click Clear, Pixel↔Zeit + Snap |
| Range-Overlay-Komponente | CREATE — Orange-Band auf dem Header |
| Token-Datei (⚠️ Pfad) | MODIFY — Range-Select-Tokens |

Kein Pre-Roll-Modul. Kein State-Cache. Kein A/B/C-Architektur-Layer.

---

## Tests (gegen Seek-Modell formuliert)

**Store/State:**
1. `setExportRange` setzt `{start,end}`, `clearExportRange` → `null`
2. Rückwärts-Range → geswappt
3. Null-Länge → `null`
4. Clamp an `[0, projectDuration]`
5. Undo/Redo lässt `exportRange` unberührt
6. `exportRange` nicht im Undo-Snapshot **und nicht in persist-shape** (R6)

**Architektur-Gate (der zentrale Korrektheitstest):**
7. **Seek-Reproduzierbarkeit:** Frame bei absoluter t identisch, egal ob
   durchlaufend erreicht, direkt geseekt, oder per Loop-Wrap erreicht.
   (Regressions-Anker für die gestrichene Pre-Roll-Annahme.)
8. `seekCounter`-Bump beim Wrap leert `lastFiredByClip` /
   `lastFiredSubdivisionByClip`.

**Loop-Preview:**
9. Playhead vor `rangeStart` → erreicht `rangeEnd` → wrap zu `rangeStart`
10. Playhead innerhalb Range → loopt
11. Playhead nach `rangeEnd` → spielt bis Ende, kein Loop
12. Stop → Playhead bleibt stehen
13. Keine Range → normales Play, unverändert
14. Wrap: Clip-Buffer-Offset = `rangeStart - clipStart` (Reconciler-Pfad)

**Export:**
15. Range → nur Frames `[rangeStart, rangeEnd]`
16. Output-Frame-Index range-relativ (erster Frame = Index 0)
17. **`beatIndex`/`beatPhase` bei absoluter t** (Clip bei abs. Sekunde X
    → absolute Phase, nicht range-relativ)
18. **Automation: Keyframe bei t=5s, `rangeStart=10s`** → Export-Frame bei
    t=10s hat korrekten interpolierten Wert (reine Funktion von t, kein
    Pre-Roll nötig — verifiziert das Seek-Modell)
19. **Audio-Windowing: Clip bei t=8s, `rangeStart=10s`** → Clip im Mix bei
    `clipStart - rangeStart = -2s` geschedult, korrekt angeschnitten
20. Keine Range → identisch zur Baseline

**Interaktion/UI:**
21. Ctrl+Drag (+ metaKey) → `setExportRange`
22. Plain-Click → `clearExportRange`
23. Snap: Drag-Kanten rasten auf Beat/Bar
24. Overlay rendert Band nur wenn `exportRange !== null`

---

## Commits (Vorschlag)

```
feat(store): exportRange ephemeral state + set/clear (skip undo, no persist)
feat(export): offline-render range bounds + range-relative output index
feat(export): audio windowing in mix-audio-offline (clipStart-rangeStart)
feat(preview): loop-wrap currentTime at rangeEnd, seekCounter bump
feat(timeline): ctrl+drag range select + plain-click clear + snap
feat(timeline): range overlay (orange) + design tokens
test(9d): seek-reproducibility + range bounds + audio window + loop + ui
```

7 Commits. Kein Pre-Roll-Commit (gestrichen).

---

## Nicht im Scope

- Mehrere Ranges gleichzeitig
- Range numerisch / In-Out per Tastatur
- Range-Persistenz über Reload (ephemeral)
- Loop-Toggle unabhängig von Range (Range aktiv = Loop, keine Range = kein Loop)
- Audio-Wrap-Cross-Fade (bekannte Limitierung, kein neuer Defekt)
- **Pre-Roll / State-Cache / A/B/C-Architektur** (in Rev. 3 verworfen)

---

## Architekt-Checkliste

- [ ] **0.0 Architektur-Gate:** jeden FX-`render()` auf Frame-Akkumulation
      geprüft (Particle, Dissolve, RetroVHS, WebGL2-Render-Targets).
      Gate hält → weiter. Gate hält nicht → zurückmelden vor Weiterbau.
- [ ] Schritt 0 #1: Header-Klick-Semantik dokumentiert (Datei:Zeile)
- [ ] Schritt 0 #5: 9b-ephemeral-Pfad bestätigt (Datei:Zeile)
- [ ] Render-Pfade korrekt: offline-tick.ts / export/offline-render.ts /
      mix-audio-offline.ts (kein Geisterpfad)
- [ ] Audio als Windowing, nicht Pre-Roll
- [ ] Test 7 (Seek-Reproduzierbarkeit) + 18 (Automation reine t-Funktion) grün
- [ ] metaKey (macOS) neben ctrlKey
- [ ] Range nicht im Undo-Snapshot + nicht persistiert — Test 5 + 6 grün
- [ ] Kein Pre-Roll-Modul, kein State-Cache angelegt

---

Rev. 3 — Pre-Roll verworfen, Seek-Modell, verifizierte Pfade.
Schritt 0.0 ist das blockierende Gate. ⚠️ = Schritt-0-Pflicht.
