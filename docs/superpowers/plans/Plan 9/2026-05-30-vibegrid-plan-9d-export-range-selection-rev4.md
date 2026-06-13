# CC #1 Prompt — Plan 9d: Export Range Selection + Loop Preview (Rev. 4)

**Time-Selection auf dem Timeline-Header (Ctrl+Drag) → Loop-Preview und
Export beschränken sich auf den markierten Zeitausschnitt.**
Plain-Click auf den Header hebt die Range auf.

FL-Studio-Time-Selection / NLE-In-Out-Range-Äquivalent. Range ist
**ephemeral** — nicht Teil der Undo-History (wie Multi-Select aus 9b).

Baseline: HEAD post-Plan-11b. Test-Zahl + Store-Version in Schritt 0 bestätigen.

---

## ⚠️ Revisions-Historie — bitte zuerst lesen

**Rev. 2** spezifizierte eine **Pre-Roll-Architektur** (alle Schichten von
t=0 bis `rangeStart` evaluieren). Verworfen in Rev. 3.

**Rev. 3** ersetzte Pre-Roll durch ein **Seek-Modell** mit der Pauschal-
aussage „der Render-Loop ist pro Frame zustandslos". Diese Aussage ist
**über-generalisiert** — sie stimmt für fast alle FX, aber **nicht für
Particles**, das Frame-Zustand akkumuliert (`particles.ts:247-249`,
modul-globaler Pool `particles.ts:53`, nur bei `dispose()` geleert).

**Rev. 4** (dieser Plan) behält das Seek-Modell für alle zustandslosen FX,
behandelt Particles als benannten Sonderfall mit expliziter Trade-off-
Entscheidung, und korrigiert den Audio-Windowing-Bug (W1) sowie die
Dual-Audio-Path-Falle (W2).

### Das Seek-Modell (gilt für alle FX außer Particles)

Der Render-Loop rekonstruiert jeden Frame aus absoluter Zeit, akkumuliert
keinen Zustand:
- `loop.ts:309` — `beats = ((time - offsetMs/1000) * bpm) / 60`. Absolut.
- `loop.ts:531` — `subdivisionIndex = Math.floor(beats * multiplier)`.
- `loop.ts:604` — Automation via `resolveClipParams(…, paramBeat, …)`,
  reine Funktion der Abfragezeit.
- `loop.ts:327–332` — Frame-übergreifender State (`lastFiredByClip`,
  `lastFiredSubdivisionByClip`) wird bei jedem Seek über `seekCounter` geleert.

**Verifiziert zustandslos** (kein Gate-Problem): RetroVHS, GlitchSlice,
Dissolve, FilmGrainBurst, Text (pre-baked Jitter), Contour (Edge-Cache
liest aktuellen Frame), alle WebGL2-FX (kein Feedback-/Ping-Pong-Target).
**Verifiziert akkumulierend:** nur Particles.

Loop-Wrap = Seek nach `rangeStart`. Mechanismus existiert bereits
(`seekCounter`-Bump → `lastFired`-Reset → Reconciler startet Clips am
Offset neu), wird bei jedem Scrubben benutzt. Kein State-Cache, kein
A/B/C-Architektur-Layer.

---

## 🔴 B1 — Particles akkumuliert Frame-Zustand: Trade-off-Entscheidung

`particles.ts:247-249` integriert Positionen Frame-für-Frame
(`p.x += p.vx * dt`). Der Pool wird nur bei `dispose()` geleert, **nicht**
vom `seekCounter`-Reset. Damit gilt:

- **Voll-Export** (ab frameIdx=0, `offline-render.ts:294`) baut den Pool
  natürlich auf → korrekt.
- **Range-Export ab t>0** (Sampling bei absoluter t, kein Pre-Roll) startet
  mit leerem Pool → die ersten ~1–2 s zeigen Partikel, die aus dem Nichts
  hochrampen. Sichtbarer Artefakt am Anfang jedes mid-stream Range-Exports.

### Die Spannung (muss explizit entschieden sein, nicht versteckt)

Billiger Range-Export (nur den Bereich sampeln) bricht Particles. Korrektes
Particles bräuchte Render-ab-0 — für Video teuer (5–15× realtime pro
Decoder-Seek), exakt der Grund, warum Pre-Roll in Rev. 3 verworfen wurde.

**Drei Optionen:**
- **(a)** Particles-Ramp-up als dokumentierte Limitierung akzeptieren.
- **(b)** Für akkumulierende FX render-but-discard ab t=0 (FX korrekt, aber
  Video-Export-Kosten zurück — der verworfene Pre-Roll-Pfad).
- **(c)** Particles zustandslos umschreiben (Position aus absoluter Zeit
  ableiten statt integrieren) — eigener Scope.

### ✅ Entscheidung für 9d: Option (a)

Particles-Ramp-up am Range-Start ist eine **akzeptierte, dokumentierte
Limitierung** (siehe `KNOWN_LIMITATIONS` unten). Begründung: (b) holt genau
die Kosten zurück, deretwegen Pre-Roll verworfen wurde; (c) ist der saubere
Fix, aber eigener Scope.

**(c) ist der Nordstern** — out of scope für 9d, aber im Plan vermerkt,
damit (a) nicht als Endzustand missverstanden wird. Wenn Particles
irgendwann stateless wird, sind Export und Loop ohne Sonderfall korrekt.

### Gekoppelt: DL2 — Loop-Preview-Verhalten = Export-Verhalten

**Prinzip: Die Preview muss zeigen, was der Export produziert.** Eine
Loop-Preview mit durchgehenden Partikeln, während der Export hochrampt,
wäre die „Preview lügt"-Falle (gleiche Klasse wie die heilige Regel
„Live-Preview nutzt nie WebCodecs").

Da der Range-Export bei (a) am Anfang hochrampt, **muss die Loop-Preview
das auch tun.** Also: **Pool beim Loop-Wrap leeren** (Option A aus DL2).
Jeder Loop-Durchlauf ist damit ein ehrlicher Preview des Export-Passes.
Das „Hochrampen-Flackern" ist kein Defekt, sondern akkurate Vorschau —
und nützliches Feedback (User sieht, dass die Range leer startet, und zieht
den Anfang evtl. bewusst einen Beat früher).

> Hätte B1 = (b)/(c) gewählt (durchgehende Partikel im Export), wäre DL2 =
> Pool weiterlaufen lassen korrekt. Die beiden Entscheidungen sind gekoppelt:
> **Preview-Verhalten = Export-Verhalten, immer.**

### Implementierungs-Mechanik für „Pool beim Wrap leeren"

Der `seekCounter` (`loop.ts:327-332`) leert nur Loop-lokale Maps — er
erreicht den modul-globalen Particles-Pool (`particles.ts:53`) **nicht**.
Für den Pool-Reset braucht es einen Hook bis ins Plugin:

**`plugin.onSeek?(clipId)` — optionaler Plugin-Hook (ENG):**
- Nur Particles implementiert ihn (leert seinen Pool-Eintrag für `clipId`).
- Wird beim Seek/Loop-Wrap aufgerufen, parallel zum `seekCounter`-Bump.
- Render-Signatur bleibt schlank (kein `seekCounter` durch den RenderContext).

**Bewusst ENG, nicht als Plugin-Lifecycle etabliert.** Verifiziert: die
11c-Kandidaten (ZoomPulse, ZoomPunch, ScreenShake, Dissolve) re-sampeln pro
Frame aus absoluter Zeit und brauchen `onSeek` **nicht**. Der stateless-
Rewrite (Option c) **löscht** den Hook, statt ihn zu brauchen. Ein breites
Lifecycle-Element, dessen einziger Konsument ein Workaround ist, den der
echte Fix wieder entfernt, wäre spekulative Infrastruktur — explizit vermieden.

**Zwei Pflicht-Bedingungen, damit „eng" keine versteckte Falle wird:**

1. **Hook am Interface dokumentieren** (Kommentar dort, wo `onSeek`
   definiert wird):
   > `onSeek?(clipId)` — optional, nur für FX die Zustand über Frames
   > akkumulieren. Der saubere Fix für solche FX ist Statelessness
   > (Zustand aus absoluter Zeit ableiten); dieser Hook ist ein Workaround,
   > bis das geschieht.

   Damit findet ein künftiger FX-Autor, der versehentlich akkumuliert, den
   Hook — statt denselben Bug neu zu bauen.

2. **Als Scaffolding markieren, mit Lösch-Bedingung:** Der Hook ist
   temporär. **Lösch-Bedingung: der stateless-Particles-Rewrite (B1 Option
   c) entfernt sowohl die Akkumulation als auch diesen Hook.** Damit wird
   `onSeek` nicht zum dauerhaften Inventar.

### W3 — vorbestehender Bug, in der B1-Notiz mitführen

`dt = 1/60` ist in `particles.ts:247` hartcodiert, ignoriert die echte
Frame-Dauer → Particles bewegt sich im 30-fps-Export mit halber
Geschwindigkeit ggü. 60-fps-Preview. **Nicht durch 9d verursacht**, aber
interagiert mit B1. In der `KNOWN_LIMITATIONS`-Notiz erwähnen, damit es
nicht als „neuer 9d-Bug" zurückkommt. Fix optional in 9d (wenn B1 ohnehin
Particles anfasst), sonst deferred.

---

## Schritt 0 — Codebase lesen (PFLICHT)

### 0.0 — Architektur-Gate (Particles ist der bekannte Verstoß)

Das Seek-Modell ist für alle FX **außer Particles** verifiziert. CC #1
bestätigt vor dem Bau:
- Particles ist der **einzige** akkumulierende FX (Pre-Review hat RetroVHS,
  GlitchSlice, Dissolve, FilmGrainBurst, Text, Contour, alle WebGL2-FX als
  zustandslos verifiziert — gegenprüfen, nicht blind übernehmen).
- Falls wider Erwarten ein weiterer FX akkumuliert → zurückmelden, bevor
  weitergebaut wird (er bräuchte denselben `onSeek`-Hook).

### 0.1–0.10 — Pfade

1. ⚠️ **Header-Klick-Semantik heute.** Timeline-Header/Ruler-Komponente
   (Pfad bestätigen). Linksklick heute = Playhead-Seek? → entscheidet, ob
   Plain-Click-Clear konfliktfrei ist. Datei:Zeile dokumentieren.
2. ⚠️ **Pointer-Handler.** `onPointerDown/Move/Up`. macOS: `metaKey` neben
   `ctrlKey`.
3. ⚠️ **Pixel↔Zeit-Mapping.** Bestehende Umrechnung exakt wiederverwenden.
4. ⚠️ **Beat-Snap (Plan 8d).** Snap-Helper. Range-Kanten snappen auf Beat/Bar.
5. ⚠️ **Ephemeral-State-Präzedenz (9b).** `lib/store/` — Multi-Select-State-
   Ort, im Undo-Snapshot oder außerhalb? `skip`-Flag. Datei:Zeile.
6. ✅/⚠️ **Playback-Treiber + Seek + Dual-Audio-Path (W2 — kritisch):**
   - `engine.ts:355–365` — `stopAllClips()` (Reconciler bei Seek).
   - `engine.ts:328–345` — `playClip(clipId, offsetSec, whenSec)` →
     `source.start(when, offsetSec)`. Buffer-Offset = `rangeStart - clipStart`.
   - `seekCounter` (`loop.ts:327–332`).
   - **W2 — Dual-Audio-Path-Falle:** `currentTime` kommt vom globalen
     Soundtrack-`audioEl` (`engine.ts:151`, `timeupdate`). Per-Clip-Audio
     (`clipSources`) treibt die Zeit **nicht**. **Frage für Schritt 0: Was
     treibt `currentTime` beim Loop-Wrap, wenn KEIN sync-Soundtrack geladen
     ist, sondern nur Per-Clip-Audio?** Dann gibt es keinen `audioEl` — der
     Wrap-Mechanismus hängt an einer evtl. nicht existierenden Quelle. CC #1
     lokalisiert den Treiber und klärt den Soundtrack-losen Fall, **bevor**
     er den Wrap baut.
7. ✅ **Render-Pfade (verifiziert):**
   - `lib/renderer/offline-tick.ts` — Frame-Tick
   - `lib/export/offline-render.ts` — Export-Orchestrierung (`:294` Tick-Loop)
   - `lib/export/mix-audio-offline.ts` — Audio-Mix offline (`:85` `source.start`)
   - (`lib/renderer/offline-render.ts` aus Rev. 2 existiert nicht)
8. ⚠️ **Projektlänge / Timeline-Ende** — Quelle der Gesamtdauer. Datei:Zeile.
9. ✅ **VideoDecoderPool-Seek.** `resetAllSources()` = Export-Start-Fix, kein
   Per-Seek-Ding. Loop-Wrap-Seek nimmt denselben Pfad wie Scrubben.
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

Playback-Treiber wrappt `currentTime` bei `rangeEnd` → `rangeStart`, bumpt
den `seekCounter`, Reconciler startet Clips am Offset neu. Particles-Pool
wird via `onSeek` geleert (B1/DL2).

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
3. Reconciler: `stopAllClips()` → `playClip` pro aktivem Clip mit
   `offsetSec = rangeStart - clipStart`
4. **`plugin.onSeek?(clipId)` pro aktivem Clip** → Particles leert Pool

Identisch zum heutigen Scrub-Verhalten, plus Schritt 4 für akkumulierende FX.

---

## Feature 3 — Export mit Range

- Range aktiv → Export emittiert nur Frames `[rangeStart, rangeEnd]`
- **Sampling bei absoluter t**, Output-Frame-Index **range-relativ**:
  `outputFrame = round((t - rangeStart) * fps)`. Video beginnt bei Frame 0,
  Clip bei abs. Sekunde 30 wird mit absoluter Phase gerendert.
- Particles: Pool startet leer (B1 = (a), Ramp-up dokumentiert).

### Audio-Windowing (W1 — korrigierte Mechanik)

In `mix-audio-offline.ts`: Clips relativ zum Range-Fenster schedulen.
**Negativer `when` ist in der Web-Audio-API nicht zulässig** (`source.start`
wirft RangeError / klemmt auf 0 ohne Vorspulen). Daher Fallunterscheidung:

```ts
const rel = clipStartSec - rangeStartSec;
if (rel >= 0) source.start(rel, 0);   // Clip beginnt im Fenster
else          source.start(0, -rel);  // Clip ragt hinein: when=0, Buffer-Offset = -rel
```

- Fenster: `[0, rangeEnd - rangeStart]` slicen.
- Der `if (startSec >= totalDurationSec) continue`-Guard (`:78`/`:102`) muss
  auf **range-relative Zeit rebased** werden (sonst werden Clips falsch
  ge-skippt).
- Keine Range → identisch zur Baseline (volles Projekt).

---

## KNOWN_LIMITATIONS (dokumentieren, nicht „lösen")

1. **Audio-Wrap-Glitch:** Loop-Wrap ersetzt one-shot BufferSources → kurzer
   Übergang möglich. Das ist heutiges Scrub-Verhalten, kein neuer Defekt.
2. **Particles-Ramp-up am Range-Start (B1):** Range-Export ab t>0 und jeder
   Loop-Durchlauf zeigen Partikel, die aus leerem Pool hochrampen. Preview =
   Export (ehrlich). Sauberer Fix: stateless Particles (deferred, Nordstern).
3. **Particles `dt=1/60` (W3):** Hartcodiert, halbe Geschwindigkeit im
   30-fps-Export ggü. 60-fps-Preview. Vorbestehend, nicht 9d-verursacht.

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
| `lib/store/` (9b-State-Ort, ⚠️) | MODIFY — `exportRange` + `set/clearExportRange` (`skip`), aus persist ausklammern |
| `lib/export/offline-render.ts` | MODIFY — Range-Bounds + range-relativer Output-Index |
| `lib/renderer/offline-tick.ts` | MODIFY (falls nötig) — absolute t, range-relativer Index |
| `lib/export/mix-audio-offline.ts` | MODIFY — Audio-Windowing (W1-Fallunterscheidung, Guard rebasen) |
| `lib/fx/particles.ts` | MODIFY — `onSeek(clipId)` implementieren (Pool-Eintrag leeren) |
| FX-Plugin-Interface (⚠️ Pfad) | MODIFY — optionaler `onSeek?(clipId)` + Doku-Kommentar (Bedingung 1+2) |
| Playback-Treiber (⚠️ Pfad) | MODIFY — Wrap `currentTime`, `seekCounter++`, `onSeek` pro Clip |
| Timeline-Header-Komponente (⚠️ Pfad) | MODIFY — Ctrl+Drag Range, Plain-Click Clear, Pixel↔Zeit + Snap |
| Range-Overlay-Komponente | CREATE — Orange-Band auf dem Header |
| Token-Datei (⚠️ Pfad) | MODIFY — Range-Select-Tokens |

Kein Pre-Roll-Modul. Kein State-Cache. Kein breites Plugin-Lifecycle.

---

## Tests

**Store/State:**
1. `setExportRange` setzt `{start,end}`, `clearExportRange` → `null`
2. Rückwärts-Range → geswappt
3. Null-Länge → `null`
4. Clamp an `[0, projectDuration]`
5. Undo/Redo lässt `exportRange` unberührt
6. `exportRange` nicht im Undo-Snapshot **und nicht in persist-shape** (R6)

**Architektur-Gate (zentraler Korrektheits-Anker):**
7. **Seek-Reproduzierbarkeit — namentlich gegen Particles** (DL1): Ein
   zustandsloser FX (Pulse) macht den Test trivial grün und beweist nichts.
   Der Test MUSS gegen Particles laufen: Frame bei absoluter t nach
   `onSeek`-Reset == Frame bei t über frischen Seek erreicht. (Beweist, dass
   `onSeek` den Pool tatsächlich auf den Seek-Zustand bringt.)
8. `seekCounter`-Bump beim Wrap leert `lastFiredByClip` /
   `lastFiredSubdivisionByClip`.
9. **`onSeek` leert Particles-Pool-Eintrag für `clipId`** (Pool nach
   `onSeek` leer, andere Clips unberührt).

**Loop-Preview:**
10. Playhead vor `rangeStart` → erreicht `rangeEnd` → wrap zu `rangeStart`
11. Playhead innerhalb Range → loopt
12. Playhead nach `rangeEnd` → spielt bis Ende, kein Loop
13. Stop → Playhead bleibt stehen
14. Keine Range → normales Play, unverändert
15. Wrap: Clip-Buffer-Offset = `rangeStart - clipStart` (Reconciler-Pfad)
16. **W2: Loop-Wrap funktioniert ohne sync-Soundtrack** (nur Per-Clip-Audio
    geladen) — currentTime wird trotzdem korrekt gewrappt (Treiber-Fallback
    aus Schritt 0 #6)

**Export:**
17. Range → nur Frames `[rangeStart, rangeEnd]`
18. Output-Frame-Index range-relativ (erster Frame = Index 0)
19. **`beatIndex`/`beatPhase` bei absoluter t** (Clip bei abs. Sekunde X →
    absolute Phase, nicht range-relativ)
20. **Automation: Keyframe bei t=5s, `rangeStart=10s`** → Export-Frame bei
    t=10s korrekt interpoliert (reine Funktion von t — verifiziert Seek-Modell)
21. **W1 Audio-Windowing — Clip im Fenster:** Clip bei t=12s, `rangeStart=10s`
    → `source.start(2, 0)` (rel ≥ 0)
22. **W1 Audio-Windowing — Clip ragt hinein:** Clip bei t=8s, `rangeStart=10s`
    → `source.start(0, 2)` (rel < 0, Buffer-Offset 2s, kein negativer when)
23. **W1 Guard rebased:** Clip, der erst nach `rangeEnd` beginnt, wird
    korrekt ge-skippt (range-relativer `totalDurationSec`-Vergleich)
24. Keine Range → identisch zur Baseline

**Interaktion/UI:**
25. Ctrl+Drag (+ metaKey) → `setExportRange`
26. Plain-Click → `clearExportRange`
27. Snap: Drag-Kanten rasten auf Beat/Bar
28. Overlay rendert Band nur wenn `exportRange !== null`

---

## Commits (Vorschlag)

```
feat(store): exportRange ephemeral state + set/clear (skip undo, no persist)
feat(fx): optional plugin.onSeek hook + particles pool reset (scaffolding)
feat(export): offline-render range bounds + range-relative output index
feat(export): audio windowing in mix-audio-offline (W1 split + guard rebase)
feat(preview): loop-wrap currentTime + seekCounter bump + onSeek per clip
feat(timeline): ctrl+drag range select + plain-click clear + snap
feat(timeline): range overlay (orange) + design tokens
docs: KNOWN_LIMITATIONS (particles ramp-up, audio wrap, dt=1/60)
test(9d): particles seek-reproducibility + audio window + loop + ui
```

9 Commits.

---

## Nicht im Scope

- Mehrere Ranges gleichzeitig
- Range numerisch / In-Out per Tastatur
- Range-Persistenz über Reload (ephemeral)
- Loop-Toggle unabhängig von Range (Range aktiv = Loop, keine Range = kein Loop)
- Audio-Wrap-Cross-Fade (bekannte Limitierung, kein neuer Defekt)
- **Pre-Roll / State-Cache** (verworfen Rev. 3)
- **Breites Plugin-Lifecycle** (`onSeek` bewusst eng — 11c braucht ihn nicht,
  stateless-Rewrite löscht ihn)
- **Particles stateless-Rewrite (B1 Option c)** — Nordstern, deferred,
  Lösch-Bedingung für den `onSeek`-Hook
- **W3 `dt`-Fix** — optional, sonst deferred (in KNOWN_LIMITATIONS)

---

## Architekt-Checkliste

- [ ] **0.0 Gate:** Particles als einziger akkumulierender FX gegengeprüft;
      kein weiterer FX akkumuliert (sonst zurückmelden)
- [ ] **W2:** Loop-Wrap-Treiber für den Soundtrack-losen Fall geklärt
      (Schritt 0 #6) — vor dem Wrap-Bau
- [ ] **W1:** Audio-Windowing als Fallunterscheidung (kein negativer `when`),
      Guard range-relativ rebased
- [ ] **B1 = (a) + DL2 = Pool-Wrap-Reset** umgesetzt, gekoppelt
      (Preview = Export)
- [ ] **`onSeek` eng:** nur Particles implementiert; Interface-Doku
      (Bedingung 1) + Scaffolding-Markierung mit Lösch-Bedingung (Bedingung 2)
- [ ] Render-Pfade korrekt (kein Geisterpfad offline-render.ts in renderer/)
- [ ] **Test 7 namentlich gegen Particles** (nicht gegen zustandslosen FX)
- [ ] Test 22 (Clip ragt hinein, Buffer-Offset statt negativer when) grün
- [ ] metaKey (macOS) neben ctrlKey
- [ ] Range nicht im Undo-Snapshot + nicht persistiert (Test 5 + 6)
- [ ] KNOWN_LIMITATIONS dokumentiert (ramp-up, audio-wrap, dt)

---

Rev. 4 — Seek-Modell + Particles als benannter Sonderfall (B1=(a), DL2=Pool-
Reset, gekoppelt). W1/W2 korrigiert. `onSeek` eng als Scaffolding mit Lösch-
Bedingung. Schritt 0.0 + W2 sind blockierend. ⚠️ = Schritt-0-Pflicht.
