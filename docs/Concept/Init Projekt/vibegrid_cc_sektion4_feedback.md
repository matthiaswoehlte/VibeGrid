# CC Feedback — Design Sektion 4: Timeline-Modul

✅ Freigegeben mit folgenden Korrekturen und Ergänzungen:

## Bug: snapBeats() Mapping ist falsch

Die snap-Werte beziehen sich auf Beat-Subdivisions, nicht Beat-Multiplikatoren:

```typescript
// FALSCH (aktuell):
const div = { '1/4': 1, '1/8': 0.5, '1/16': 0.25 }[snap];

// RICHTIG:
const div = { '1/4': 0.25, '1/8': 0.125, '1/16': 0.0625 }[snap];
```

Alternativ: Wenn `'1/4'` einen Quarter-Note-Beat meint (= 1 Beat im 4/4 Grid),
dann Benennung ändern zu `'beat' | 'half' | 'quarter'` zur Klarheit.
Bitte mit `BeatGrid.beatsPerBar` abstimmen.

## Ergänzung: Clip-Overlap Validation

```typescript
// lib/timeline/operations.ts — hinzufügen:
export function hasOverlap(
  state: TimelineState,
  trackId: string,
  startBeat: number,
  lengthBeats: number,
  excludeClipId?: string
): boolean

// addClip() und moveClip() sollen hasOverlap() intern prüfen.
// Bei Konflikt: OperationError werfen — kein silent overwrite.
// UI zeigt Toast: "Clip overlaps existing clip"
```

## Korrektur: activeFxClipsByKind Return-Type

```typescript
// FALSCH (aktuell) — schließt 'image' ein:
Record<TrackKind, Clip[]>

// RICHTIG — 'image' explizit ausschließen:
Record<Exclude<TrackKind, 'image'>, Clip[]>
```

Macht den Renderer-Code typsicher —
kein versehentliches FX-Rendering auf Image-Tracks.
