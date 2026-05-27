# Architekt-Entscheidung — Plan 9b: Timeline Multi-Select
### Nach CC #1 Pre-Review (post-8f.2, 1217 Tests)

❌ Nicht freigegeben — Rev. 2 erforderlich.

CC #1's Pre-Review ist vollständig und code-grounded. Ich bestätige alle Findings.
Zusätzlich stufe ich zwei CC #1-Wackler auf Blocker hoch.

---

## Hochgestuft: Blocker (von CC #1 als Wackler eingestuft)

### B4 — @dnd-kit ↔ raw PointerEvents (CC #1: W7)

CC #1 hat das als Wackler markiert — ich stufe es auf Blocker hoch.

Wenn @dnd-kit und der Group-Move-Handler beide auf `PointerDown` reagieren,
gibt es Race-Conditions die sich je nach Event-Timing unterschiedlich äußern:
manchmal Group-Move, manchmal Einzel-Drag, manchmal beides. Das ist nicht
debuggbar nach der Implementierung — es muss vorher entschieden sein.

**Pflicht in Rev. 2:** Eine der beiden Strategien explizit wählen und dokumentieren:

Option A — `onPointerDownCapture` auf dem selektierten Clip:
```ts
// Clip.tsx
onPointerDownCapture={(e) => {
  if (isSelected && !e.shiftKey) {
    e.stopPropagation()  // blockt @dnd-kit listeners
    startGroupMove(e)
  }
}}
```

Option B — @dnd-kit Sensor deaktivieren wenn Multi-Select aktiv:
```ts
// useSensor mit activationConstraint oder disabled-prop
// wenn selectedClipIds.size > 1 → dnd-kit disabled
```

Ohne diese Entscheidung wird CC #1 raten — und ein geratener Fix
bricht in einem der Szenarien.

### B5 — Undo-Batching (CC #1: D1)

Ebenfalls auf Blocker hochgestuft.

`moveSelectedClips` darf **keine N moveClip-Calls** intern machen.
Wenn 5 Clips selektiert sind und Group-Move eine Schleife über `moveClip`
läuft, hat Ctrl+Z 5 Undo-Schritte. Das ist ein UX-Bug, kein Impl-Detail.

Rev. 2 muss explizit spezifizieren: `moveSelectedClips`, `resizeSelectedClips`
und `duplicateSelectedClips` sind je **eine atomare Store-Mutation** —
alle Clips in einem einzigen Immer-Produce-Call, ein History-Entry.

---

## Bestätigte CC #1 Blocker

**B1** (ClipBand.tsx → Clip.tsx) — bestätigt, muss in File Map + Tests gefixt werden.

**B2** (TrackLane.tsx Geister-Datei) — bestätigt. Empfehlung: Rubberband-Logik
in `Tracks.tsx` einbauen (Option A). Kein neuer Component — das ist ein
Refactor der nicht im Scope von 9b liegt.

**B3** (selectedClipId Singular → Migration) — bestätigt, kritischster Punkt.
CC #1's Empfehlung ist korrekt:
```ts
// Derived, kein eigenes State-Feld mehr:
const selectedClipId = selectedClipIds.length === 1 ? selectedClipIds[0] : null

// Compat-Shim für alle bestehenden Callsites:
setSelectedClipId: (id: string | null) =>
  id ? selectClips([id]) : clearSelection()
```
Migration muss in einem eigenen Commit passieren, bevor die Multi-Select-Logic
gebaut wird. Sonst werden Inspector + AutomationEditor + Mobile InspectorSheet
während der Implementierung kaputt sein.

---

## Pflicht-Fixes für Rev. 2 (alle Blocker)

| # | Punkt | Quelle |
|---|---|---|
| B1 | Clip.tsx statt ClipBand.tsx in File Map + Tests | CC #1 |
| B2 | Rubberband-Logik in Tracks.tsx (kein TrackLane) | CC #1 |
| B3 | selectedClipId Migration-Strategie explizit + Commit-Plan | CC #1 |
| B4 | @dnd-kit Konflikt-Strategie wählen und dokumentieren | Architekt |
| B5 | Atomare Store-Mutation für alle Group-Ops spezifiziert | Architekt |

---

## Soll-Fixes für Rev. 2 (aus CC #1 Wackler)

| # | Punkt | Prio |
|---|---|---|
| W1 | `string[]` statt `Set<string>` — entscheiden und dokumentieren | Hoch |
| W2 | `snapBeat()` aus bestehender Codebase nutzen, kein paralleles System | Hoch |
| W5 | Deep-Clone für AutomationCurve-Params in duplicateClipWithCurves | Hoch |
| W6 | Input-Guard für Keyboard-Shortcuts | Mittel |
| W4 | Overlap-Verhalten bei duplicateSelectedClips spezifizieren | Mittel |
| D2 | Ctrl+D Offset = rightmost-edge - leftmost-edge (nicht längster Clip) | Mittel |
| D4 | Move-Preview einheitlich als Ghost (nicht optimistic Store-Mutation) | Hoch |
| D6 | Hit-Test: nur FX-Clips oder alle? Explizit entscheiden | Mittel |

W3, W8, W9, D3, D5 — CC #1 kann diese inline beim Implementieren entscheiden,
kein Plan-Update erforderlich.

---

## Was nicht geändert werden muss

Die Konzept-Architektur ist solide:
- AABB Hit-Test für Rubberband
- Rubberband als lokaler State (kein Store)
- Group-Resize: delta-basiert statt absolute Länge
- Automation-Kurven-Offset beim Duplicate
- Commit-Struktur granular
- Smoke-Test-Liste vollständig

---

## Nächster Schritt

CC #1 schreibt Rev. 2 des Plans mit den 5 Blocker-Fixes + 8 Soll-Fixes.
Danach kommt Rev. 2 hier rein zum finalen Review.

---

Architekt-Entscheidung — 2026-05-27
