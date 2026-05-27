# Addendum — Architekt-Entscheidung Plan 9b
### 4 offene Mikro-Entscheidungen (nach CC #1 Meta-Review)

Ergänzt zur Hauptentscheidung vom 2026-05-27. Alle 4 Punkte sind jetzt
festgeschrieben — CC #1 kann Rev. 2 ohne Rückfragen schreiben.

---

### L1 — B4: @dnd-kit Strategie → **Option A**

`onPointerDownCapture` + `stopPropagation` auf dem selektierten Clip.

Option B scheidet aus: `@dnd-kit disabled wenn selectedClipIds.length > 1`
blockt auch PointerDown auf nicht-selektierten Clips — das bricht das
explizit zugesicherte Single-Drag-Verhalten (Plan Z. 222–224).

```ts
// Clip.tsx
onPointerDownCapture={(e) => {
  if (isSelected && !e.shiftKey) {
    e.stopPropagation()
    startGroupMove(e)
  }
}}
```

---

### L2 — W4: Overlap bei duplicateSelectedClips → **Stille Skip mit Toast**

Konsistent mit Plan 9a (preset-pack apply). Clips die ohne Overlap platziert
werden können erscheinen, überlappende werden still übersprungen.

Toast: `"X of Y clips duplicated (Z overlap)"` wenn mindestens 1 Skip.

---

### L3 — D6: Hit-Test Clip-Kinds → **Alle Kinds selektierbar, Group-Move filtert**

Rubberband selektiert alle Clip-Kinds (FX, Image, Video, Audio).
Group-Move prüft pro Clip via bestehender `canDropOnTrack`-Validation —
Clips die nicht bewegt werden können bleiben stehen, Toast zeigt Anzahl
blockierter Clips. Kein Hard-Crash, kein Silent-Fail.

---

### L4 — W3: Resize Min-Clamp → **Einzeln klemmen** (wie im Smoke-Test)

Plan-9b-Smoke: *"ein Clip ist bereits minimal → clampt, andere laufen normal"* —
das ist bewusst bestätigt. Jeder Clip klemmt unabhängig auf `0.5 Beats`.
Relative Längen-Verhältnisse können dabei auseinanderdriften — das ist
akzeptiert, weil die Alternative (alle clampen sobald einer am Min ist)
den Resize für alle blockiert sobald ein kurzer Clip in der Gruppe ist.

---

Entscheidung komplett. CC #1 kann Rev. 2 schreiben.

Addendum — 2026-05-27
