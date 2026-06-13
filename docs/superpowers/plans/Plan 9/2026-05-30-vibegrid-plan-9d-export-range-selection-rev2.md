# CC #1 Prompt — Plan 9d: Export Range Selection + Loop Preview (Rev. 2)

**Time-Selection auf dem Timeline-Header (Ctrl+Drag) → Loop-Preview und
Export beschränken sich auf den markierten Zeitausschnitt.**
Plain-Click auf den Header hebt die Range auf.

FL-Studio-Time-Selection / NLE-In-Out-Range-Äquivalent. Range ist
**ephemeral** — nicht Teil der Undo-History (wie Multi-Select aus 9b).

Baseline: HEAD post-Plan-11b. Test-Zahl + Store-Version in Schritt 0 bestätigen.

---

## Schritt 0 — Codebase lesen (PFLICHT)

1. ⚠️ **Header-Klick-Semantik heute.** Timeline-Header/Ruler-Komponente
   finden (exakter Pfad bestätigen). Macht ein normaler Linksklick heute
   schon etwas (Playhead-Seek)? Davon hängt ab ob Plain-Click-Clear
   konfliktfrei ist:
   - Header-Click seekt heute → Clear fällt mit Seek zusammen, kein Konflikt
   - Header-Click macht nichts → Plain-Click bekommt ausschließlich Clear-Semantik
   CC #1 dokumentiert die gefundene Semantik.

2. ⚠️ **Pointer-Event-Handler auf dem Header.** Bestehende
   `onPointerDown/Move/Up`-Logik. macOS: `metaKey` (Cmd) als Äquivalent
   zu `ctrlKey` mitprüfen.

3. ⚠️ **Pixel↔Zeit-Mapping.** Wie rechnet der Header Pixel-X in
   Sekunden/Beats um (Zoom-Level, Scroll-Offset)? Range-Drag braucht
   exakt dieselbe Funktion — nicht neu erfinden.

4. ⚠️ **Beat-Snap (Plan 8d).** Snap-Helper finden. Range-Kanten snappen
   beim Draggen auf Beat/Bar. Snap-Toggle/Modifier-Konvention bestätigen.

5. ⚠️ **Store-Shape + ephemeral-State-Präzedenz (9b).** `lib/store/index.ts`:
   Wo lebt Multi-Select-State aus Plan 9b? Ist er im Undo-Snapshot?
   9d folgt exakt diesem Präzedenzfall. Plan-10-`skip`-Flag bestätigen.

6. ⚠️ **Live-Preview-Playhead-State.** Wo lebt die aktuelle Playhead-
   Position im Store? Wie funktioniert Play/Stop/Seek heute? Spacebar-
   Handler finden. Das Loop-Verhalten hängt direkt an diesem Pfad.

7. ⚠️ **Audio-Engine — Clip-Seek.** Wie werden Audio-Clips und
   Sound-Effekte heute gestartet? Wo wird der Buffer-Offset gesetzt?
   Pre-Roll (Schritt unten) braucht den Seek-Point pro Clip bei
   `rangeStart` — nicht Start bei t=0.

8. ⚠️ **Offline-Render-Loop.** `lib/renderer/offline-render.ts` +
   `lib/renderer/loop.ts`: Wo startet/endet Frame-Emission? Wo werden
   Automation-Kurven, `beatIndex`, `beatPhase` ausgewertet?
   Pre-Roll-Strategie (Schritt unten) baut direkt darauf.

9. ⚠️ **Projektlänge / Timeline-Ende.** Woher kommt Gesamtdauer?
   (Für Clamp + Fallback „keine Range = volles Projekt".)

10. Test-Zahl + Store-Version notieren:
    `npm test -- --run 2>&1 | grep -E "Tests|passed" | tail -3`

---

## Feature 1 — Range Selection (Header-Interaktion)

### Interaktion

| Geste | Verhalten |
|---|---|
| **Ctrl+Drag** (Cmd macOS) über Header | Range aufziehen — dunkles Orange-Band, snappt auf Beat/Bar |
| **Plain-Click** auf Header | Range aufheben (+ ggf. Playhead-Seek, siehe Schritt 0 Punkt 1) |
| **Ctrl+Drag** bei existierender Range | Range neu setzen (alte verworfen) |

### State

```ts
exportRange: { start: number; end: number } | null  // Sekunden, absolut
```

- `null` = keine Range = normales Verhalten (Default)
- **Außerhalb des Undo-Snapshots** (siehe Undo-Behaviour)
- Set/Clear via Mutator mit `skip`-Flag (Plan-10-Pattern)

### Normalisierung (Pflicht)

- Rückwärts gezogen (`start > end`) → swappen
- Null-Länge (`start === end` nach Snap) → als `null` behandeln
- An Projektgrenzen clampen (`start >= 0`, `end <= projectDuration`)

---

## Feature 2 — Loop-Preview

### Loop-Verhalten (vollständig spezifiziert)

| Playhead-Position bei Play/Space | Verhalten |
|---|---|
| **Vor `rangeStart`** | Spielt normal ab; erreicht `rangeEnd` → springt zu `rangeStart`, loopt |
| **Innerhalb `[rangeStart, rangeEnd]`** | Loopt sofort zwischen start/end |
| **Nach `rangeEnd`** | Spielt bis Projektende, **kein** Loop |
| **Keine Range aktiv** | Normales Play-Verhalten, unverändert |

**Stop:** Playhead bleibt stehen wo er ist — kein Auto-Reset.

### Loop-Wrap: Pre-Roll beim Wrap-around

Bei jedem Wrap (`rangeEnd` → `rangeStart`) müssen **alle vier Schichten**
synchron auf den korrekten Zustand bei `rangeStart` zurückgesetzt werden:

1. **Automation-Kurven** — Keyframe-Interpolation ab t=0 bis `rangeStart`
   neu evaluieren → korrekter Parameterwert an der Startstelle
2. **Beat-Phase / `beatIndex`** — absolut berechnet, nicht range-relativ
3. **FX-Parameter mit Zustand** (Decay-Kurven etc.) — Pre-Roll-Stand
4. **Audio-Clips und Sound-Effekte** — Buffer-Offset pro Clip auf den
   korrekten Seek-Point bei `rangeStart` setzen (ein Clip, der bei t=5s
   beginnt, liegt bei `rangeStart=10s` bereits 5 Sekunden in seinen
   Buffer hinein — nicht von vorne starten)

Keines dieser vier darf isoliert behandelt werden — alle müssen beim
Wrap synchron zurückgesetzt werden.

---

## ⭐ Kritisch: Pre-Roll für Export UND Live-Preview

**Das ist die Stelle, die am ehesten lautlos falsch wird.**

### Das Problem

Automation-Kurven, FX-Parameter, Beat-Phase und Audio-Clips haben
Zustände, die von t=0 an aufgebaut werden. Wenn der Renderer einfach bei
`rangeStart` anfängt, fehlt ihm die Geschichte davor:

- Ein Color-Grade-Clip mit Hue-Shift-Kurve, die bei t=5s startet und bis
  t=35s interpoliert, liegt bei `rangeStart=30s` an der falschen Stelle
  wenn die Keyframes davor nicht evaluiert wurden
- Ein Sound-Effekt der bei t=8s beginnt liegt bei `rangeStart=10s` bereits
  2 Sekunden in seinen Buffer hinein — nicht von vorne
- `beatIndex`/`beatPhase` ist absolut, nicht range-relativ

### Die Lösung: Pre-Roll

Vor der ersten Frame-Emission (Export) bzw. vor dem ersten Audio-Sample
(Live-Preview) evaluiert der Renderer **alle vier Schichten von t=0 bis
`rangeStart`**, ohne Output zu produzieren:

```
Pre-Roll: t=0 → rangeStart   (kein Output, nur State aufbauen)
Render:   t=rangeStart → rangeEnd   (Output-Frames / Audio-Samples)
```

**Export:** Output-Frame-Index ist range-relativ (`outputFrame = (t - rangeStart) * fps`),
aber die Sampling-Zeit für alle Berechnungen bleibt **absolut**. Das Video
beginnt bei Frame 0, aber ein Clip bei absoluter Sekunde 30 wird mit
absoluter Phase gerendert.

**Live-Preview:** Beim ersten Play ab einer Range-Position und bei jedem
Loop-Wrap wird Pre-Roll ausgeführt bevor Audio/Video startet.

**Kein Pre-Roll nötig wenn:** Playhead ist nach `rangeEnd` (spielt bis
Projektende ohne Loop) — normaler Pfad, unverändert.

---

## Feature 3 — Export mit Range

- Range aktiv → Offline-Renderer emittiert nur Frames `[rangeStart, rangeEnd]`
- **Pre-Roll** wie oben beschrieben (alle vier Schichten)
- Output-Frame-Index range-relativ, Sampling-Zeit absolut
- Audio-Export: Buffer-Offset = `rangeStart`, Länge = `rangeEnd - rangeStart`,
  korrekte Seek-Position pro Clip (Pre-Roll)
- Keine Range → identisch zur Baseline (volles Projekt)

---

## Design-Token (NEU)

```css
--range-select-fill: rgba(255,140,0,0.18)   /* Band-Füllung */
--range-select-edge: rgba(255,140,0,0.85)   /* Kanten/Griffe */
```

Klar abgesetzt von Multi-Select-Optik (9b). Ort der Token-Datei in
Schritt 0 bestätigen.

---

## Undo-Behaviour

| Action | Behandlung |
|---|---|
| Range erstellen (Ctrl+Drag) | `skip` — kein Undo-Eintrag |
| Range aufheben (Plain-Click) | `skip` — kein Undo-Eintrag |
| Undo/Redo während Range aktiv | Range bleibt **unverändert** |

Range ist nicht Teil des Undo-Snapshots. Undo/Redo darf Range weder
zurücksetzen noch wiederbeleben. Exakt wie Multi-Select aus 9b.

---

## Dateien (Erwartung — Pfade in Schritt 0 bestätigen)

| Datei | Aktion |
|---|---|
| `lib/store/index.ts` | MODIFY — `exportRange`-State + `set/clearExportRange` (`skip`) |
| `lib/renderer/offline-render.ts` | MODIFY — Pre-Roll + Range-Bounds + range-relativer Output-Index |
| Audio-Export-Modul (⚠️ Pfad) | MODIFY — Buffer-Offset + Clip-Seek-Points via Pre-Roll |
| Live-Preview-Loop (⚠️ Pfad) | MODIFY — Loop-Wrap-Logik + Pre-Roll bei Wrap + Play-Verhalten |
| Timeline-Header-Komponente (⚠️ Pfad) | MODIFY — Ctrl+Drag Range, Plain-Click Clear, Pixel↔Zeit + Snap |
| Range-Overlay-Komponente | CREATE — Orange-Band auf dem Header |
| Token-Datei (⚠️ Pfad) | MODIFY — `--range-select-fill` / `--range-select-edge` |

---

## Tests

**Store/State:**
1. `setExportRange` setzt `{start,end}`, `clearExportRange` → `null`
2. Rückwärts-Range → geswappt gespeichert
3. Null-Länge → `null`
4. Clamp an `[0, projectDuration]`
5. Undo/Redo lässt `exportRange` unberührt
6. `exportRange` nicht im Undo-Snapshot

**Loop-Preview:**
7. Playhead vor `rangeStart` → erreicht `rangeEnd` → springt zu `rangeStart`
8. Playhead innerhalb Range → loopt
9. Playhead nach `rangeEnd` → spielt bis Ende, kein Loop
10. Stop → Playhead bleibt stehen, kein Reset
11. Keine Range → normales Play, unverändert
12. **Loop-Wrap: Automation-Kurven-State korrekt bei `rangeStart`**
    (Regressions-Anker: Keyframe vor `rangeStart` beeinflusst Wert danach)
13. **Loop-Wrap: Audio-Clip-Buffer-Offset korrekt bei `rangeStart`**
    (Clip der bei t=8s beginnt, liegt bei `rangeStart=10s` 2s in Buffer)

**Pre-Roll / Export (kritische Korrektheitstests):**
14. Export mit Range → Loop emittiert nur Frames `[rangeStart, rangeEnd]`
15. Output-Frame-Index range-relativ (erster Frame = Index 0)
16. **`beatIndex`/`beatPhase` bei absoluter `t`** — Clip bei abs. Sekunde X
    wird mit absoluter Phase gerendert, nicht range-relativ
17. **Automation-Kurve: Keyframe bei t=5s, `rangeStart=10s`** → Export-Frame
    bei t=10s hat korrekten interpolierten Wert (Pre-Roll evaluiert t=0→10s)
18. **Audio-Pre-Roll: Sound-Effekt bei t=8s, `rangeStart=10s`** → Audio-
    Buffer-Offset = 2s in den Clip (nicht von vorne)
19. Keine Range → identisch zur Baseline (volles Projekt)

**Interaktion/UI:**
20. Ctrl+Drag (+ metaKey) → `setExportRange`
21. Plain-Click → `clearExportRange`
22. Snap: Drag-Kanten rasten auf Beat/Bar
23. Overlay rendert Band nur wenn `exportRange !== null`

---

## Commits (Vorschlag)

```
feat(store): exportRange ephemeral state + set/clear (skip undo)
feat(renderer): pre-roll engine — evaluate all 4 layers t=0→rangeStart
feat(renderer): offline-render range bounds + range-relative output index
feat(audio): export buffer offset + clip seek-points via pre-roll
feat(preview): loop-wrap logic + pre-roll on wrap + play-from-before-range
feat(timeline): ctrl+drag range select + plain-click clear + snap
feat(timeline): range overlay (orange) + design tokens
test(9d): store + pre-roll correctness + audio offset + loop + interaction
```

8 Commits.

---

## Nicht im Scope

- Mehrere Ranges gleichzeitig
- Range numerisch eingeben / In-Out-Marker per Tastatur
- Range-Persistenz über Reload (ephemeral)
- Loop-Toggle unabhängig von Range (kein separater Loop-Button —
  Range aktiv = Loop aktiv, keine Range = kein Loop)

---

## Architekt-Checkliste

- [ ] Schritt 0 Punkt 1: Header-Klick-Semantik dokumentiert
- [ ] Schritt 0 Punkt 5: 9b-ephemeral-Pfad als Vorbild bestätigt
- [ ] Schritt 0 Punkt 6: Playhead-State + Spacebar-Handler gefunden
- [ ] Schritt 0 Punkt 7: Audio-Clip-Seek-Mechanismus gefunden
- [ ] Schritt 0 Punkt 8: Automation-Evaluierungs-Pfad gefunden
- [ ] Pre-Roll deckt alle vier Schichten: Automation, Beat-Phase, FX-State, Audio
- [ ] Loop-Wrap setzt alle vier synchron zurück
- [ ] Test 16 + 17 + 18 grün (Pre-Roll-Korrektheit)
- [ ] metaKey (macOS) neben ctrlKey
- [ ] Range nicht im Undo-Snapshot — Test 5 + 6 grün

---

Rev. 2 — vollständige Spezifikation. Alle ⚠️-Punkte sind Schritt-0-Pflicht.
