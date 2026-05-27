# CC #1 Prompt — Plan 9b: Timeline Multi-Select, Group-Move, Group-Resize, Clip-Duplicate

**DAW-Style Timeline-Ergonomie.**
Rubberband-Selektion, synchrones Verschieben + Resize markierter Clips,
Shift+Drag zum Duplizieren ganzer Effektgruppen.

Baseline: HEAD post-Plan-9a (Preset-Packs live).

Schreibe nur den **Plan** — noch keinen Code.

---

## Schritt 0 — Codebase lesen (PFLICHT)

1. `lib/store/timeline-slice.ts` — exakte Clip-Shape lesen:
   - `startBeat`, `lengthBeats`, `kind`, `params`, `trackId` — Namen bestätigen
   - Bestehende Drag-Logik für einzelne Clips — wie wird `startBeat` heute geändert?
   - Bestehende Resize-Logik für einzelne Clips — `lengthBeats` Mutation
   - Welche Actions existieren: `moveClip`, `resizeClip`, `addClip`, o.ä.?
2. `components/Workspace/Timeline/` — Verzeichnisstruktur:
   - Welche Komponente rendert die Clip-Balken?
   - Wie wird `pixelsPerBeat` (Zoom) heute berechnet und weitergegeben?
   - Welche Komponente ist der scrollbare Container?
   - Wie werden Pointer-Events heute auf Clips registriert?
3. `lib/store/timeline-slice.ts` — gibt es bereits ein `selectedClipIds`-Feld?
4. `lib/presets/store-bridge.ts` — `setAutomationCurve`, `getAutomationCurves`
   (für Duplicate mit Kurven-Offset)
5. `lib/automation/types.ts` — `AutomationPoint<T>`-Shape
6. Aktuellen Test-Zahl notieren

---

## Feature-Übersicht

| Feature | Triggerung |
|---|---|
| Rubberband-Selektion | PointerDown auf leerem Track-Bereich → Drag |
| Group-Move | Drag auf selektiertem Clip |
| Group-Resize | Resize-Handle eines selektierten Clips ziehen |
| Copy-Drag | Shift gedrückt halten + Drag auf selektiertem Clip |
| Deselect | Click auf leeren Track-Bereich (kein Clip) |

---

## Datenmodell — Store-Erweiterung

```typescript
// lib/store/timeline-slice.ts MODIFY

// Neues State-Feld:
selectedClipIds: Set<string>;  // oder string[] — je nach Store-Pattern

// Neue Actions:
selectClips(ids: string[]): void
// → ersetzt aktuelle Selektion (kein Toggle)

addToSelection(ids: string[]): void
// → ergänzt (für zukünftiges Shift+Click auf einzelne Clips)

clearSelection(): void
// → selectedClipIds = leeres Set

moveSelectedClips(deltaBeats: number): void
// → für alle ids in selectedClipIds: clip.startBeat += deltaBeats
// → Guard: kein Clip darf startBeat < 0 haben nach dem Move
// → atomare Mutation — alle oder keiner

resizeSelectedClips(deltaBeats: number, edge: 'end' | 'start'): void
// → edge='end': alle lengthBeats += deltaBeats (Guard: min 0.5 Beats)
// → edge='start': alle startBeat += deltaBeats, lengthBeats -= deltaBeats
// → Guard: kein Clip bekommt lengthBeats < 0.5

duplicateSelectedClips(offsetBeats: number): void
// → für jeden Clip in selectedClipIds:
//   neuer Clip mit identischem kind, params-copy, trackId
//   startBeat = original.startBeat + offsetBeats
//   Automation-Kurven kopieren mit beat-Offset (alle Punkte + offsetBeats)
// → neue Clips werden selektiert (alte Selektion aufgehoben)
```

---

## Feature 1 — Rubberband-Selektion

### Koordinaten-System

```typescript
// Timeline-Koordinaten: { beat: number, trackIndex: number }
// Screen-Koordinaten: { x: number, y: number } (relativ zum scrollbaren Container)

function screenToTimeline(
  x: number, y: number,
  pixelsPerBeat: number,
  scrollLeft: number,
  tracks: Track[]
): { beat: number, trackIndex: number } {
  const beat = (x + scrollLeft) / pixelsPerBeat;
  const trackIndex = getTrackIndexAtY(y, tracks);
  return { beat, trackIndex };
}
```

### Rubberband-State (lokal in Timeline-Komponente, kein Store)

```typescript
type RubberbandState =
  | { active: false }
  | {
      active: true;
      startX: number;    // Container-relative px
      startY: number;
      currentX: number;
      currentY: number;
    };
```

### Ablauf

```
PointerDown auf leerem Track-Bereich (kein Clip unter Pointer):
  → clearSelection()
  → rubberbandState = { active: true, startX, startY, currentX: startX, currentY: startY }
  → setPointerCapture(e.pointerId)

PointerMove (während Rubberband aktiv):
  → rubberbandState.currentX = e.clientX - containerRect.left
  → rubberbandState.currentY = e.clientY - containerRect.top
  → Hit-Test: welche Clips überschneiden sich mit dem Rubberband-Rect?
  → selectClips(überschneidende Clip-IDs)

PointerUp:
  → rubberbandState = { active: false }
  → releasePointerCapture
  → Selektion bleibt erhalten
```

### Hit-Test Algorithmus

```typescript
function clipsInRubberband(
  rect: { x1: number, y1: number, x2: number, y2: number },  // px, container-relativ
  clips: Clip[],
  tracks: Track[],
  pixelsPerBeat: number,
  scrollLeft: number
): string[] {
  const normRect = normalizeRect(rect);  // x1 < x2, y1 < y2 sicherstellen

  return clips.filter(clip => {
    const clipX1 = clip.startBeat * pixelsPerBeat - scrollLeft;
    const clipX2 = (clip.startBeat + clip.lengthBeats) * pixelsPerBeat - scrollLeft;
    const trackY  = getTrackY(clip.trackId, tracks);
    const trackH  = TRACK_HEIGHT;  // konstant aus Design-Tokens

    // AABB-Überschneidung
    const xOverlap = clipX1 < normRect.x2 && clipX2 > normRect.x1;
    const yOverlap = trackY < normRect.y2 && trackY + trackH > normRect.y1;
    return xOverlap && yOverlap;
  }).map(c => c.id);
}
```

### Rubberband-Darstellung

SVG-Overlay über dem Timeline-Canvas:
```tsx
{rubberbandState.active && (
  <rect
    x={Math.min(rubberbandState.startX, rubberbandState.currentX)}
    y={Math.min(rubberbandState.startY, rubberbandState.currentY)}
    width={Math.abs(rubberbandState.currentX - rubberbandState.startX)}
    height={Math.abs(rubberbandState.currentY - rubberbandState.startY)}
    fill="rgba(168,107,255,0.08)"     // --a1 mit 8% Deckkraft
    stroke="#a86bff"
    strokeWidth={1}
    strokeDasharray="4 3"
  />
)}
```

---

## Feature 2 — Selektierter Clip: Highlight

Selektierte Clips bekommen `ring`-Farbe **Rot** (`#ff3b3b`):

```tsx
// In der Clip-Render-Komponente:
const isSelected = selectedClipIds.has(clip.id);

<div
  style={{
    backgroundColor: isSelected ? '#ff3b3b' : FX_CLIP_COLORS[clip.kind],
    boxShadow: isSelected ? '0 0 0 2px #ff3b3b, 0 0 8px rgba(255,59,59,0.4)' : undefined,
    // Glow-Effekt für klare Sichtbarkeit
  }}
/>
```

Clip-Beschriftung (Name, Icon) bleibt sichtbar — kein reines Rot-Block.

---

## Feature 3 — Group-Move

Drag auf einen **selektierten** Clip:

```
PointerDown auf selektiertem Clip:
  → dragState = { clipIds: [...selectedClipIds], startBeat: e.beat, mode: 'move' }
  → setPointerCapture

PointerMove:
  → deltaBeats = currentBeat - dragState.startBeat
  → Preview: alle selectedClips werden um deltaBeats verschoben (optimistisch)
  → Guard-Anzeige: roter Rand wenn ein Clip auf startBeat < 0 käme

PointerUp:
  → moveSelectedClips(deltaBeats) → Store-Commit
  → Snap: deltaBeats wird auf nächsten Beat gerundet (pixelsPerBeat-abhängig)
```

**Wichtig:** PointerDown auf einem **nicht-selektierten** Clip bricht die
Gruppenselektion nicht — er wird als Einzel-Clip gedraggt (altes Verhalten).
Nur Drag auf selektierten Clip löst Group-Move aus.

### Beat-Snap während Group-Move

```typescript
function snapToGrid(deltaBeats: number, snapMode: SnapMode): number {
  if (snapMode === 'off')  return deltaBeats;
  if (snapMode === 'beat') return Math.round(deltaBeats);
  if (snapMode === 'bar')  return Math.round(deltaBeats / 4) * 4;
  return deltaBeats;
}
```

---

## Feature 4 — Group-Resize

Resize-Handle an rechtem Clip-Rand (oder linkem für `start`-Edge):

```
PointerDown auf Resize-Handle eines selektierten Clips:
  → dragState = { clipIds: [...selectedClipIds], mode: 'resize', edge: 'end' }

PointerMove:
  → deltaBeats = currentBeat - originalEndBeat
  → resizeSelectedClips(deltaBeats, 'end') — Preview

PointerUp:
  → commit
```

**Resize-Regel:** Alle selektierten Clips werden um **dieselbe Anzahl Beats**
verlängert/verkürzt — nicht auf dieselbe absolute Länge. Ein 4-Beat-Clip und
ein 8-Beat-Clip, beide selektiert, werden beide um +2 Beats verlängert → 6 und 10 Beats.

**Min-Länge:** 0.5 Beats — kein Clip wird kleiner. Wenn der Guard greift,
wird für diesen Clip der Wert geclampt, die anderen laufen normal.

---

## Feature 5 — Copy-Drag (Shift+Drag)

Shift gehalten + PointerDown auf selektiertem Clip:

```
Shift + PointerDown auf selektiertem Clip:
  → dragState = { mode: 'copy', clipIds: [...selectedClipIds], startBeat }

PointerMove:
  → Ghost-Preview: transparente Kopien der Clips an neuer Position
  → Original-Clips bleiben an ihrem Platz (kein Verschieben)

PointerUp:
  → offsetBeats = endBeat - dragState.startBeat
  → duplicateSelectedClips(offsetBeats)
  → Neue Clips werden automatisch selektiert
  → Toast: "4 clips duplicated — Ctrl+Z to undo"
```

### Ghost-Preview während Copy-Drag

```tsx
{copyDragState.active && copyDragState.clipIds.map(id => {
  const clip = clips.find(c => c.id === id);
  return (
    <div
      key={`ghost-${id}`}
      style={{
        position: 'absolute',
        left: (clip.startBeat + copyDragState.deltaBeats) * pixelsPerBeat,
        opacity: 0.5,
        border: '1px dashed #ff3b3b',
        backgroundColor: '#ff3b3b33',
      }}
    />
  );
})}
```

### Automation-Kurven beim Duplicate

```typescript
function duplicateClipWithCurves(
  clip: Clip,
  offsetBeats: number,
  newId: string
): { clip: Clip, curves: Record<string, AutomationPoint<number>[]> } {
  const curves = getAutomationCurves(clip.id);
  const offsetCurves: typeof curves = {};

  for (const [key, points] of Object.entries(curves)) {
    offsetCurves[key] = points.map(p => ({
      ...p,
      beat: p.beat + offsetBeats,  // absolute Beats → ebenfalls verschieben
    }));
  }

  return {
    clip: {
      ...clip,
      id: newId,
      startBeat: clip.startBeat + offsetBeats,
      params: { ...clip.params },  // defensive copy
    },
    curves: offsetCurves,
  };
}
```

---

## Feature 6 — Deselect

```
Click auf leeren Track-Bereich (PointerDown + PointerUp ohne Drag, kein Clip):
  → clearSelection()

Escape-Taste:
  → clearSelection()

Click auf nicht-selektierten Clip:
  → clearSelection()
  → selectClips([clickedClipId])  // Einzelselektion
```

---

## Keyboard-Shortcuts (zusätzlich)

| Shortcut | Aktion |
|---|---|
| `Escape` | Selektion aufheben |
| `Ctrl+A` | Alle Clips selektieren |
| `Delete` / `Backspace` | Alle selektierten Clips löschen |
| `Ctrl+D` | Selektion an gleicher Position duplizieren (offsetBeats = lengthBeats des längsten Clips) |
| `←` / `→` (1 Beat) | Selektierte Clips um 1 Beat verschieben |
| `Shift+←` / `Shift+→` (1 Bar) | Selektierte Clips um 1 Takt verschieben |

---

## Cursor-Feedback

| Zustand | Cursor |
|---|---|
| Hover auf selektiertem Clip | `grab` |
| Drag Group-Move | `grabbing` |
| Shift+Hover auf selektiertem Clip | `copy` |
| Hover auf Resize-Handle (selektiert) | `ew-resize` |
| Rubberband aktiv | `crosshair` |
| Hover auf leerem Track-Bereich | `crosshair` |

---

## File Map

| Datei | Aktion |
|---|---|
| `lib/store/timeline-slice.ts` | MODIFY — `selectedClipIds`, `selectClips`, `clearSelection`, `moveSelectedClips`, `resizeSelectedClips`, `duplicateSelectedClips` |
| `lib/timeline/multi-select.ts` | CREATE — `clipsInRubberband`, `snapToGrid`, `duplicateClipWithCurves` |
| `components/Workspace/Timeline/ClipBand.tsx` | MODIFY — Selected-Highlight (rot + Glow) |
| `components/Workspace/Timeline/TrackLane.tsx` | MODIFY — Rubberband PointerDown/Move/Up, Deselect-Click |
| `components/Workspace/Timeline/RubberbandOverlay.tsx` | CREATE — SVG-Rubberband-Rect |
| `components/Workspace/Timeline/GhostClips.tsx` | CREATE — Copy-Drag Preview |
| `components/Workspace/Timeline/index.tsx` | MODIFY — Keyboard-Handler (Escape, Ctrl+A, Delete, Arrows) |

---

## Tests

**`tests/unit/timeline/multi-select.test.ts`** — ≥ 8:
- `clipsInRubberband`: Clip vollständig im Rect → selektiert
- `clipsInRubberband`: Clip nur teilweise im Rect → selektiert (Überschneidung reicht)
- `clipsInRubberband`: Clip außerhalb → nicht selektiert
- `clipsInRubberband`: Rect über mehrere Tracks → Clips in allen betroffenen Tracks selektiert
- `moveSelectedClips`: deltaBeats → alle startBeats korrekt angepasst
- `moveSelectedClips`: Guard → kein Clip bekommt startBeat < 0
- `resizeSelectedClips`: deltaBeats gleich für alle Clips
- `resizeSelectedClips`: Guard → kein Clip bekommt lengthBeats < 0.5
- `duplicateClipWithCurves`: neue ID, startBeat + offset, Kurven ebenfalls offsettet
- `duplicateClipWithCurves`: defensive copy — original params unverändert

**`tests/unit/store/timeline-multiselect.test.ts`** — ≥ 5:
- `selectClips`: ersetzt bestehende Selektion
- `clearSelection`: leert Set
- `duplicateSelectedClips`: neue Clips in Store, alte bleiben erhalten
- `duplicateSelectedClips`: neue Clips werden selektiert (alte abgewählt)
- Ctrl+D: Offset = längster selektierter Clip (lengthBeats)

**`tests/unit/components/ClipBand.test.tsx`** — ≥ 2:
- Selektierter Clip: roter Background + Glow-Shadow
- Nicht-selektierter Clip: normale FX_CLIP_COLORS-Farbe

Mindest: **≥ 15 neue Tests**

---

## Verification Gate

Baseline: **post-9a** (CC #1 bestätigt).
Ziel: **Baseline + ≥ 15**.

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Manuelle Smoke-Tests:**
```
# Rubberband: PointerDown auf leerem Track-Bereich → gestricheltes Rect sichtbar
# Rubberband über 3 Clips → alle 3 leuchten rot mit Glow
# Rubberband über leeren Bereich → keine Selektion
# Click auf leeren Track-Bereich → Selektion aufgehoben, Clips normale Farbe
# Escape → Selektion aufgehoben
# Group-Move: Drag auf rotem Clip → alle selektierten bewegen sich synchron
# Group-Move: Beat-Snap funktioniert (Clips rasten ein)
# Group-Move: Guard bei Timeline-Anfang → kein Clip geht auf startBeat < 0
# Group-Resize: Resize-Handle eines selektierten Clips → alle selektierten gleichzeitig
# Resize Guard: ein Clip ist bereits minimal → clampt, andere laufen normal
# Copy-Drag: Shift gedrückt + Drag → Ghost-Kopien sichtbar, Original bleibt
# Copy-Drag PointerUp → Kopien erscheinen, Automation-Kurven korrekt geshiftet
# Toast "4 clips duplicated"
# Ctrl+D → Duplikat direkt nach den Originals
# Ctrl+A → alle Clips rot
# Delete auf Selektion → alle selektierten weg
# Shift+→ → Selektion um 4 Beats rechts
# WebM-Export: Ausgewählte Clips exportieren normal (Selektion hat keinen Effekt auf Render)
```

---

## Commit-Struktur

```
feat(store): timeline-slice — selectedClipIds + selectClips + clearSelection
feat(store): timeline-slice — moveSelectedClips + resizeSelectedClips
feat(store): timeline-slice — duplicateSelectedClips mit Kurven-Offset
feat(timeline): multi-select — clipsInRubberband + duplicateClipWithCurves
feat(timeline): RubberbandOverlay — SVG-Rect mit lila Dashed-Border
feat(timeline): GhostClips — Copy-Drag Preview
feat(timeline): ClipBand — Selected-Highlight rot + Glow
feat(timeline): TrackLane — Rubberband PointerEvents + Deselect
feat(timeline): keyboard — Escape, Ctrl+A, Delete, Arrows, Ctrl+D
test: multi-select unit + store + ClipBand
```

---

## Out of Scope → Plan 9c

- Clip-Copy/Paste in System-Clipboard (Ctrl+C / Ctrl+V)
- Multi-Track-Selektion über Track-Header-Klick
- Snap-Zones zwischen selektierten Clips (relative Abstände beim Move erhalten)
- Undo-History-Panel (Undo-Stack ist bereits im Store, nur UI fehlt)

---

Abgabe: `vibegrid-plan-9b-timeline-multiselect.md`
