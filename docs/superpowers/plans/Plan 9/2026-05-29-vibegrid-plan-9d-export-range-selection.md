# CC #1 Prompt — Plan 9d: Export Range Selection (Rev. 1 — Skelett)

**Time-Selection auf dem Timeline-Header (Ctrl+Drag) → nur der markierte
Zeitausschnitt wird exportiert.** Plain-Click auf den Header hebt die
Range wieder auf → Export rendert wieder das ganze Projekt.

FL-Studio-Time-Selection / NLE-In-Out-Range-Äquivalent. Range ist
**ephemeral** — nicht Teil der Undo-History (wie Multi-Select aus 9b).

Baseline: HEAD post-Plan-11a (oder aktueller — Test-Zahl + Store-Version
in Schritt 0 bestätigen).

> **Rev. 1 ist ein Skelett vom Architekt.** Die mit ⚠️ markierten Punkte
> sind ungeklärte Schritt-0-Fragen — CC #1 verifiziert sie gegen den Code
> und dokumentiert die Antworten im Implementation-Header, **bevor** er
> implementiert. Pfade/Signaturen unten sind Erwartungen, keine
> verifizierten Fakten — CC #1 liest den Code.
>
> **Reviewer-Pre-Verifikation (2026-05-29):** Schritt-0-Punkte 1-8 unten
> mit `✅ verifiziert` markiert und mit konkreten Datei:Zeile-Refs
> beantwortet. Plus neue Section *„Reviewer-Ergänzungen — Risiken die
> der Architekt nicht sehen konnte"* nach den Tests. Pfad-Korrekturen
> direkt in der Dateien-Tabelle.

---

## Schritt 0 — Codebase lesen (PFLICHT)

1. ✅ **Header-Klick-Semantik (verifiziert).**
   Komponente: **`components/Workspace/Timeline/Ruler.tsx`**.
   Heutiges Verhalten (`Ruler.tsx:34-60`):
   - `onPointerDown` → `seekFromClient(e.clientX, target)` → `setPlayhead` + `engine.seek(seconds)`
   - Plus Drag-Scrub: `target.setPointerCapture(e.pointerId)` + pointermove-Listener auf demselben target
   - Heißt: **jeder Plain-Click seekt schon heute**.
   **Konsequenz für Plan-9d:** Range-Clear via Plain-Click läuft konfliktfrei
   neben Seek (1. Klausel oben). `Ctrl/Cmd` modifiziert zu Range-Create
   und unterdrückt den Seek-Default in der gleichen Handler-Routine.

2. ✅ **Pointer-Event-Handler (verifiziert).**
   `Ruler.tsx:34` nutzt `onPointerDown` (CLAUDE.md-konform). `e.ctrlKey`/`e.metaKey`
   wird **noch nicht** ausgewertet — Modifier-Check muss neu eingebaut werden.
   Konvention: `if (e.ctrlKey || e.metaKey)` für macOS-Cmd-Parität.

3. ✅ **Pixel↔Zeit-Mapping (verifiziert).**
   `Ruler.tsx:7,18-19,22-32`:
   ```ts
   const BEAT_PX_BASE = 40;
   const zoom = useAppStore((s) => s.ui.zoom);
   const px = BEAT_PX_BASE * zoom;
   // seekFromClient:
   const rect = target.getBoundingClientRect();
   const localX = Math.max(0, clientX - rect.left);
   const beat = Math.max(0, Math.min(totalBeats, localX / px));
   const seconds = (beat * 60) / grid.bpm + grid.offsetMs / 1000;
   ```
   **Range-Drag nutzt exakt diese Formel** — `seekFromClient` als Pattern-
   Vorlage replizieren (oder besser: in `lib/timeline/`-Helper extrahieren
   und beide aufrufen).
   **⚠️ Wichtig:** `grid.offsetMs / 1000` darf nicht vergessen werden — sonst
   driftet Range gegen Audio bei Songs mit non-null offset.

4. ✅ **Beat-Snap (verifiziert vorhanden, Source-of-Truth).**
   Snap-Logik lebt in: `lib/store/timeline-slice.ts`, `lib/timeline/selectors.ts`,
   `components/Workspace/Timeline/Tracks.tsx`. State-Felder: `ui.clipSnap`,
   `ui.automationSnap`. CC #1 prüft welcher Snap-Helper das richtige Niveau
   bietet (Beat oder Bar) und ob ein neuer `ui.rangeSnap`-Slot nötig ist —
   oder die Range den `clipSnap`-Default mitnutzt (saubererer Default).

5. ✅ **Store-Shape + 9b-Präzedenz (verifiziert).**
   `lib/store/index.ts:113`: `selectedClipIds: []` lebt in `ui`-Slice.
   Mutators (`lib/store/index.ts:131-173`) alle via
   `recordingSet('...', mutator, { skip: true })` — siehe z.B. Z. 131
   für `setSelectedClipIds`. **`exportRange` folgt exakt diesem Pattern:**
   - State: `ui.exportRange: { start: number; end: number } | null`
   - Mutators: `recordingSet('SetExportRange', ..., { skip: true })` und
     `recordingSet('ClearExportRange', ..., { skip: true })`
   - ESLint-Regel `no-bare-set-in-store` greift automatisch.

6. ✅ **Offline-Render-Loop (verifiziert — Pfade korrigieren).**
   **Pfadkorrektur:** Datei heißt nicht `lib/renderer/offline-render.ts`,
   sondern:
   - **`lib/renderer/offline-tick.ts`** — `makeOfflineRenderer().renderAt(timeSec, videoFrames?)` (single-frame-Render)
   - **`lib/export/offline-render.ts`** — Orchestrator: `renderOffline(deps, options)`, hier lebt der Frame-Loop

   Zeit-Auswertung (verifiziert):
   - `offline-tick.ts:46-72`: `renderAt(timeSec)` setzt `currentTime = timeSec`
     im Closure-Scope; `getCurrentTime` reicht das in den shared `createRenderer`-
     Loop (`lib/renderer/loop.ts`) weiter
   - `loop.ts:259`: `const beats = ((time - grid.offsetMs / 1000) * grid.bpm) / 60;`
     — **alle Beat/Phase-Berechnungen, FX-Sampling und Automation-Resolve
     hängen am absoluten `time`** (was als `timeSec` reinkommt). Range-Loop
     muss `timeSec ∈ [start, end]` (absolut) übergeben.
   - Frame-Total: `offline-render.ts:130-131`:
     `const durationSec = deps.audioDurationSec; const totalFrames = Math.ceil(durationSec * fps);`
     Loop läuft typisch `for (let f = 0; f < totalFrames; f++) { ... renderAt(f / fps); ... }`.
     **Range-Anpassung:**
     `const firstFrame = Math.floor(start * fps);`
     `const lastFrame  = Math.ceil(end * fps);`
     `for (let f = firstFrame; f < lastFrame; f++) { renderAt(f / fps); /* encoder timestamp = (f - firstFrame) / fps */ }`

7. ✅ **Audio-Export-Pfad (verifiziert — komplexer als das Skelett vermutet).**
   `lib/export/mix-audio-offline.ts:52-58`:
   `mixAudioOffline(audioClips, mediaRefs, bpm, totalDurationSec, videoAudioClips)`.
   Internals (`mix-audio-offline.ts:59-90+`):
   - Bus-Größe: `OfflineAudioContext(2, totalSamples, EXPORT_SAMPLE_RATE)` wo
     `totalSamples = Math.ceil(totalDurationSec * 48000)`
   - Pro Clip: `const startSec = (clip.startBeat * 60) / bpm; source.start(startSec); ...`
   - Volume-Automation: 0.1-Beat-Raster via `setValueAtTime` auf GainNode
   - Out-of-bounds-Drop: `if (startSec >= totalDurationSec) continue;` (Z. 78)

   **⚠️ Architekt-Lücke:** das Skelett-Snippet *„Range → Buffer-Offset = `start`,
   Länge = `end-start`"* beschreibt **Post-Mix-Slicing**, nicht **Pre-Mix-Range**.
   Pre-Mix ist effizienter aber erfordert API-Erweiterung. Siehe Reviewer-
   Ergänzungen unten (Punkt R1).

8. ✅ **Projektlänge (verifiziert).**
   Im Orchestrator (`lib/export/offline-render.ts:130`):
   `const durationSec = deps.audioDurationSec;` — der **Caller** liefert das.
   Der Caller ist der Studio-Export-Trigger (CC #1 findet via grep nach
   `renderOffline(` — vermutlich in `components/Workspace/Toolbar.tsx`
   oder einem Export-Hook).
   Für Range-Clamp: derselbe Caller muss `projectDuration` lesen (auch
   für Range-Validierung im Ruler). Single Source of Truth: vermutlich
   `audioEngine.getDecodedBuffer()?.duration ?? 0` plus last-clip-end-fallback.

9. Aktuelle Test-Zahl + Store-Version notieren:
   `npm test -- --run 2>&1 | grep -E "Tests|passed" | tail -3`

---

## Feature — Export Range

### Interaktion

| Geste | Verhalten |
|---|---|
| **Ctrl+Drag** (Cmd auf macOS) über Header | Range aufziehen — dunkles Orange-Band, snappt auf Beat/Bar |
| **Plain-Click** auf Header | Bestehende Range aufheben (+ ggf. Playhead-Seek, siehe Schritt 0 Punkt 1) |
| **Ctrl+Drag** bei existierender Range | Range neu setzen (alte verworfen) |
| Export mit aktiver Range | Nur `[start, end]` wird gerendert (Video + Audio) |
| Export ohne Range | Volles Projekt (heutiges Verhalten, unverändert) |

### State

```ts
// Erwartete Shape — exakten Ort + Slice-Konvention an 9b-Präzedenz anpassen
exportRange: { start: number; end: number } | null   // Sekunden, absolut
```

- `null` = keine Range = volles Projekt (Default).
- **Außerhalb des Undo-Snapshots** (siehe Undo-Behaviour).
- Set/Clear via Mutator mit `skip`-Flag (Plan-10-Pattern).

### Normalisierung (Pflicht)

- Rückwärts gezogen (`start > end`) → swappen.
- Null-Länge (`start === end` nach Snap) → als `null` behandeln (keine Range).
- An Projektgrenzen clampen (`start >= 0`, `end <= projectDuration`).

---

## ⭐ Kritisch: Absolute vs. range-relative Zeit

**Das ist die Stelle, die am ehesten kaputtgeht.** Der Offline-Renderer
emittiert mit Range nur Frames zwischen `start` und `end`. Aber:

- **Output-Video** beginnt bei **Frame 0** (Sekunde 0 im exportierten File).
- **Sampling-Zeit** für FX-Choreographie, Automation-Kurven, `beatIndex`
  und `beatPhase` bleibt **absolut** — also die echte Timeline-Position.

Wird das verwechselt (z.B. ein Clip bei absoluter Sekunde 30 so gerendert,
als läge er bei Sekunde 0), verschiebt sich die komplette Beat-Sync-Choreo
und die Automation greift an der falschen Stelle.

**Konkret:** Die Render-Schleife iteriert von `start` bis `end`, aber jeder
`rc` (RenderContext) wird mit der **absoluten** `t` konstruiert. Nur der
**Output-Frame-Index** ist range-relativ (`outputFrame = (t - start) * fps`).

CC #1 verifiziert in Schritt 0 Punkt 6, wo `beatIndex`/`beatPhase` herkommen,
und stellt sicher, dass Range nur den Loop-Bereich und den Output-Index
beeinflusst — nicht das Zeit-Argument der Auswertung.

---

## Audio-Trim mit Offset

Audio-Export bekommt denselben Range: Offset `start` in den AudioBuffer,
Länge `end - start`. **Nicht** von Anfang kopieren und hoffen, dass es passt.
CC #1 verifiziert in Schritt 0 Punkt 7, wo der Buffer gemischt wird, und
reicht den Offset dort durch.

---

## Snapping

Range-Kanten snappen beim Draggen auf Beat/Bar (Plan-8d-Helper, Schritt 0
Punkt 4). Konsistent mit Timeline-Default-Snap. Modifier zum Deaktivieren
nur, falls die bestehende Snap-Konvention das schon vorsieht — sonst nicht
neu erfinden.

---

## Design-Token (NEU)

„Dunkles Orange" existiert nicht in den Tokens (Akzente sind `--a1` Lila,
`--a2` Blau, `--a3` Teal). Neues Token, klar abgesetzt von der
Multi-Select-Optik (9b):

```css
--range-select-fill: rgba(255,140,0,0.18)   /* Band-Füllung */
--range-select-edge: rgba(255,140,0,0.85)    /* Kanten/Griffe */
```

Werte sind Vorschlag — final mit dem Dark-Mode-Look abstimmen. In die
Token-Datei (Schritt 0: Ort bestätigen, vermutlich `globals.css` o.ä.).

---

## Undo-Behaviour

Range ist **ephemeral** — wie Multi-Select (9b), wie eine Textmarkierung.

| Action | Behandlung |
|---|---|
| Range erstellen (Ctrl+Drag) | `skip` — kein Undo-Eintrag |
| Range aufheben (Plain-Click) | `skip` — kein Undo-Eintrag |
| Undo/Redo während Range aktiv | Range bleibt **unverändert** (nicht Teil des Snapshots) |

Folgeeffekt explizit: Ein Undo/Redo darf die Range weder zurücksetzen noch
wiederbeleben. Wenn 9b das für Multi-Select korrekt macht → exakt dasselbe
Verhalten, demselben Code-Pfad folgen.

---

## Dateien (Pfade reviewer-verifiziert)

| Datei | Aktion |
|---|---|
| `lib/store/index.ts` | MODIFY — `ui.exportRange`-State (initialisierter null) + `setExportRange` / `clearExportRange` Mutators (alle `recordingSet(..., { skip: true })`, Z. 113 + 131 als Vorbild) |
| `lib/store/types.ts` | MODIFY — `UIState.exportRange: { start: number; end: number } \| null` |
| **`lib/export/offline-render.ts`** | MODIFY — `firstFrame`/`lastFrame`-Loop-Bounds, `audioDurationSec` durch Caller bereits range-geclamped ODER hier abklemmen, Encoder-Timestamps range-relativ (`(f - firstFrame) / fps`) |
| **`lib/export/mix-audio-offline.ts`** | MODIFY — Signatur um `rangeStartSec?: number` erweitern, Bus-Größe = range-Länge, Clip-Offsets = `startSec - rangeStartSec`, Out-of-Range-Drop (siehe Reviewer-R1) |
| **`components/Workspace/Timeline/Ruler.tsx`** | MODIFY — `onPointerDown` um `ctrlKey \|\| metaKey`-Branch erweitern: Range-Drag-Flow analog zum existierenden Seek-Scrub-Flow (`setPointerCapture` + pointermove/up-Listener). Plain-Click-Pfad bleibt (Seek + Range-Clear in einem) |
| `components/Workspace/Timeline/RangeOverlay.tsx` | CREATE — Orange-Band über dem Ruler, Position aus `ui.exportRange` × `BEAT_PX_BASE * zoom` |
| `app/globals.css` (Reviewer-Erwartung, CC #1 bestätigt) | MODIFY — `--range-select-fill` + `--range-select-edge` Tokens |
| Studio-Export-Trigger (⚠️ Pfad in Schritt 0) | MODIFY — `useAppStore((s) => s.ui.exportRange)` lesen + an `renderOffline(deps, { ...rangeOptions })` durchreichen (siehe Reviewer-R5) |

---

## Tests (Skelett — CC #1 finalisiert Zahlen)

**Store/State:**
1. `setExportRange` setzt `{start,end}`, `clearExportRange` → `null`.
2. Rückwärts-Range (`start>end`) → geswappt gespeichert.
3. Null-Länge → `null`.
4. Clamp an `[0, projectDuration]`.
5. **Undo/Redo lässt `exportRange` unberührt** (set Range → mutate clip →
   undo → Range noch da).
6. `exportRange` nicht im Undo-Snapshot (skip-Flag greift, kein History-Eintrag).

**Renderer (der kritische Teil):**
7. Range aktiv → Loop emittiert nur Frames in `[start,end]`.
8. **Output-Frame-Index range-relativ** (erster Frame = Index 0).
9. **`beatIndex`/`beatPhase` bei absoluter `t`** — Clip bei abs. Sekunde X
   wird mit abs. Phase gerendert, nicht range-relativ. (Regressions-Anker
   für den Hauptfallstrick.)
10. Keine Range → identisch zur Baseline (volles Projekt).

**Audio:**
11. Range → Buffer-Offset = `start`, Länge = `end-start`.

**Interaktion/UI:**
12. Ctrl+Drag (+ metaKey) → `setExportRange`.
13. Plain-Click → `clearExportRange` + Seek (beide passieren — verifiziert: Plain-Click seekt schon heute).
14. Snap: Drag-Kanten rasten auf Beat/Bar.
15. Overlay rendert Band nur wenn `exportRange !== null`.

**Reviewer-Ergänzungen (Pflicht):**
16. **`grid.offsetMs ≠ 0`**: Range mit `offsetMs=350` → Beat-Sync-FX feuern bei korrekten absoluten Sekunden (Reviewer-R2).
17. **Multi-Select × Range orthogonal**: 3 Clips selektiert → Ctrl+Drag im Ruler → Range aktiv + Selektion unverändert (Reviewer-R5).
18. **Persist-Shape**: `exportRange` nicht im persistierten Snapshot (Reviewer-R6).
19. **`mixAudioOffline(rangeStartSec)`**: Clips komplett vor `rangeStart` werden gedroppt; Clip der die Range-Kante überschneidet startet bei `0` mit `currentTime - rangeStart`-Offset im Buffer (Reviewer-R1).
20. **Volume-Automation über Range-Start**: Kurve beginnt VOR `rangeStart` und reicht hinein → erster Wert bei range-Start korrekt (nicht 0).
21. **Video-DecoderPool Range-Seek**: Range = `[30, 45]` auf Video das bei `0` startet → Pool seekt korrekt zu Frame 900, nicht Frame 0 (Reviewer-R4).
22. **Encoder-Timestamps range-relativ**: Erste Frame-Timestamp = 0, nicht `start * 1e6` (Mikrosekunden für WebCodecs).

---

## Commits (Vorschlag)

```
feat(store): exportRange ephemeral state + set/clear (skip undo)
feat(renderer): offline-render range bounds — absolute sampling, relative output index
feat(audio): export buffer offset for range
feat(timeline): ctrl+drag range select on header + plain-click clear + snap
feat(timeline): range overlay (orange) + design tokens
test(9d): store + renderer absolute-time + audio offset + interaction
```

6 Commits.

---

## Nicht im Scope

- Mehrere Ranges gleichzeitig (eine Range, wie FL Studio Time-Selection).
- Range numerisch eingeben / In-Out-Marker per Tastatur.
- Range als Loop-Region für die Live-Preview (nur Export hier).
- Range-Persistenz über Reload (ephemeral, stirbt mit der Session — außer
  9b-Präzedenz macht es anders).

---

## Reviewer-Ergänzungen — Risiken die der Architekt nicht sehen konnte

### R1. `mixAudioOffline`-API-Erweiterung ist substantieller als „Buffer-Offset"

Skelett-Snippet *„Range → Buffer-Offset = `start`, Länge = `end-start`"*
suggeriert Post-Mix-Slicing. Real ist `mixAudioOffline` (`lib/export/mix-audio-offline.ts:52-90+`)
eine **OfflineAudioContext-Pipeline** die jeden Clip mit `source.start(startSec)`
auf einem `totalSamples`-langen Bus platziert. Pre-Mix-Range ist effizienter
und vermeidet das Mischen von Material das nachher weggeworfen würde —
braucht aber **fünf** Änderungen, nicht eine:

1. **Signatur**: `rangeStartSec?: number` Parameter hinzufügen
2. **Bus-Größe**: `totalSamples = Math.ceil((totalDurationSec - rangeStartSec) * 48000)` falls Range aktiv
3. **Clip-Drop**: Clips die komplett außerhalb `[rangeStart, rangeEnd]` liegen überspringen (analog zum bestehenden `if (startSec >= totalDurationSec) continue;` in Z. 78)
4. **Clip-Offset**: `source.start(Math.max(0, startSec - rangeStartSec))`
5. **Volume-Automation-Raster**: `setValueAtTime`-Events ebenfalls range-relativ verschieben (Bestands-Code in der `0.1-Beat-Raster`-Section Z. 39-45)

Plus Test-Fall: Volume-Automation-Kurve, die VOR rangeStart beginnt und IN
range hineinreicht → Anfangs-Wert muss bei range-Start korrekt anwesend sein
(nicht bei 0).

### R2. `grid.offsetMs` Berücksichtigung an drei Stellen

`loop.ts:259` rechnet `beats = ((time - grid.offsetMs / 1000) * grid.bpm) / 60`.
`Ruler.tsx:29-30` rechnet `seconds = (beat * 60) / grid.bpm + grid.offsetMs / 1000`.
Beide nutzen offsetMs konsistent.

**Range hat denselben Zwang:**
- Ruler-Drag muss `start/end` als **absolute Sekunden inklusive offsetMs** speichern
- Offline-Loop nutzt diese als absolute `timeSec` direkt — kein Re-Apply von offsetMs
- Audio-Mix-Offset (R1) muss offsetMs-konsistent rechnen

Pflicht-Test (Test #9 vom Plan-Skelett um diesen Case erweitern):
**Range mit `grid.offsetMs = 350` → Beat-Sync-FX feuern bei korrekten
absoluten Sekunden, nicht bei range-relativen.**

### R3. Export-Trigger — wer liest `exportRange`?

Plan File-Map listete keinen Export-Trigger-Pfad. Verifikation: `renderOffline`
wird vom Studio-UI getriggert (vermutlich Toolbar-Export-Button). CC #1
findet die Call-Site via grep nach `renderOffline(` (vermutlich
`components/Workspace/Toolbar.tsx` oder ein Export-Hook in `lib/hooks/`).

Dort muss:
```ts
const exportRange = useAppStore((s) => s.ui.exportRange);
// ... bei Click:
const deps: OfflineRenderDeps = { ...baseDeps,
  audioDurationSec: exportRange
    ? exportRange.end - exportRange.start
    : totalDurationSec,
};
const options: OfflineRenderOptions = { ...baseOptions,
  // Reviewer-empfohlenes neues Feld:
  rangeStartSec: exportRange?.start,
};
```

`OfflineRenderOptions` (Z. 25-31 in `offline-render.ts`) muss um
`rangeStartSec?: number` erweitert werden (passt zum optionalen-Felder-Stil
der existierenden `width?`/`height?`/`fps?`-Optionen).

### R4. `videoDecoderPool` + Range — bisher nicht adressiert

`offline-render.ts:71-72`: `videoDecoderPool.getFrameAt(mediaId, timeSec)`
wird mit absoluter Zeit aufgerufen. Pool akkumuliert Decoder-State über
Frame-Sequenz.

**Risiko:** Wenn Range bei `t=30s` startet, springt der Pool von Decoder-
Reset direkt zu Frame ~900 (30s × 30fps). Das ist viele I-/P-/B-Frames
über — Pool muss korrekt seeken bzw. ein ganzes GOP-Backfill machen.
Memory hat einen Eintrag `decoder_pool_cross_export_state.md` der genau
diese Klasse von Problemen flaggt.

**Plan 8d Hotfix-Bundle** hat `resetAllSources()` per Export eingeführt
(siehe `decoder-pool.ts`). Bei Range muss `resetAllSources()` ebenfalls
am Loop-Start aufgerufen werden, dann der Pool auf `firstFrame * (1/fps)`
seeken bevor der eigentliche Render-Loop startet.

Pflicht-Test: Range mit Video-Clip der bei abs. Sekunde 0 startet und
bis Sekunde 60 läuft, Range = [30, 45]. Verifizieren dass die ersten
gerenderten Frames das Video bei Sekunde 30 zeigen, nicht bei Sekunde 0.

### R5. Multi-Select × Range Interaktion

Beide ephemeral (`ui.selectedClipIds` aus 9b, `ui.exportRange` neu).
Klärung: stören sie sich? **Mein Vote:** orthogonal — Range wird auf
Ruler aufgezogen (nur Header-Area), Multi-Select auf Clip-Area. Plain-
Click im Header räumt nur Range, nicht Multi-Select. Plain-Click im
Clip-Bereich räumt nur Multi-Select, nicht Range.

Test: Multi-Select 3 Clips → Ctrl+Drag im Ruler → Range aktiv +
Multi-Select unverändert. Plain-Click im Ruler → Range weg + Multi-
Select unverändert.

### R6. Persist-Shape — `exportRange` darf NICHT persistiert werden

`lib/store/persist-shape.ts` definiert was localStorage überlebt. 9b's
`selectedClipIds` ist vermutlich aus dem Persist ausgeklammert (Standard-
Pattern für ephemeral UI-State). 9d folgt analog.

Pflicht-Test: `persist-shape.test.ts` ergänzen — `exportRange` nicht
im persistierten Snapshot.

### R7. `qualityManager.setOffline(true)` und Range-Loop

`offline-render.ts:115`: `qualityManager.setOffline(true)` friert WebGL-
Quality-Manager auf scale=1.0 für die gesamte Render-Dauer. Bei Range:
das `try/finally`-Wrapper-Pattern (Z. 116-121) bleibt unverändert — Range
ändert nur die Loop-Bounds innerhalb. Kein Eingriff nötig.

### R8. UI-Hint im Export-Button-Tooltip

Wenn Range aktiv: Export-Button-Label/Tooltip sollte das anzeigen
(z.B. „Export 12 of 36 s (range)"). Out-of-scope für 9d-Core aber als
Quick-Polish-Follow-up sinnvoll. Plan-Footer-Nicht-im-Scope-Liste
explizit ergänzen.

---

## Architekt-Checkliste — offene Punkte für CC #1

- [✅] Schritt 0 Punkt 1: Header-Klick seekt schon heute via `Ruler.tsx:34-60` — Plain-Click räumt Range + seekt in einem
- [✅] Schritt 0 Punkt 5: 9b-Pattern in `ui.selectedClipIds` + `recordingSet(..., { skip: true })` — exakt replizieren
- [✅] Schritt 0 Punkt 6: absolute `time` in `loop.ts:259` verifiziert; Range nur Loop-Bounds + Output-Index
- [ ] Audio-Offset-Pfad: `mixAudioOffline` API um `rangeStartSec` erweitern (Reviewer-R1) — NICHT post-mix slicen
- [ ] metaKey (macOS) neben ctrlKey im Ruler-Handler
- [ ] Snap-Helper aus 8d wiederverwendet, nicht neu gebaut — Source: `lib/timeline/selectors.ts` + `lib/store/timeline-slice.ts`
- [ ] Range nicht im Undo-Snapshot — Test 5 + 6 grün
- [ ] **Reviewer-R1**: `mixAudioOffline`-Signatur 5-Stellen-Refactor
- [ ] **Reviewer-R2**: `grid.offsetMs ≠ 0` Test-Fall (Test #16)
- [ ] **Reviewer-R3**: Export-Trigger-Callsite gefunden + `exportRange` durchgereicht
- [ ] **Reviewer-R4**: `videoDecoderPool` seekt korrekt nach `firstFrame` — `resetAllSources()`-Aufruf am Range-Loop-Start verifiziert
- [ ] **Reviewer-R5**: Multi-Select × Range orthogonal (Test #17)
- [ ] **Reviewer-R6**: `persist-shape.ts` exkludiert `exportRange` (Test #18)
- [ ] **Reviewer-R8**: Quick-Polish-Followup („Export Xs of Ys") als Out-of-Scope-Eintrag im Plan-Footer

---

Rev. 1 — Architekt-Skelett. ⚠️-Punkte sind Schritt-0-Pflicht. Nach CC #1
Schritt-0-Verifikation wird das zu Rev. 2 (mit echten Pfaden/Signaturen).
Subdivision-Cap-Constraint (16×) hier nicht berührt — Range betrifft keine
FX-Subdivision.
