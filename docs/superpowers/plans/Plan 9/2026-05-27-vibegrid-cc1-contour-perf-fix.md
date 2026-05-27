# CC #1 Task — Contour Performance Fix

**Ziel:** 191ms-Spike eliminieren + Steady-State von ~6ms auf ~1.5ms senken.
Kein Worker. Zwei Schritte: Cache-Fix + Half-Resolution.

Baseline: HEAD post-8f.2 (1248 Tests).

---

## Schritt 0 — Contour-Code lesen (PFLICHT, vor allem anderen)

Lies `lib/fx/plugins/contour.ts` (oder wo der Contour-FX lebt) vollständig.
Beantworte diese Fragen bevor du irgendetwas änderst:

1. Gibt es einen Edge-Cache? Nach welchem Key wird gecacht
   (`imageBitmapKey`? etwas anderes)?
2. Läuft die Edge-Extraction (Sobel o.ä.) **synchron** auf dem Main Thread?
3. Auf welcher Resolution läuft der Sobel-Filter aktuell
   (volle Bitmap-Größe? skaliert)?
4. Wird der Cache invalidiert wenn `imageBitmapKey` wechselt?

Schreibe deine Antworten als kurzen Kommentar-Block bevor du anfängst.

---

## Schritt 1 — Cache-Bug fixen (falls kaputt)

Wenn der Edge-Cache nicht korrekt auf `imageBitmapKey` keyed ist oder
bei jedem Frame neu berechnet wird: fix das zuerst, als eigener Commit.

Erwartetes Ergebnis: bei statischen Image-Clips läuft Sobel nur einmal,
nicht bei jedem Frame.

---

## Schritt 2 — Half-Resolution Edge-Extraction

Skaliere das Quell-Bitmap vor dem Sobel-Filter auf halbe Auflösung:

```ts
// Statt Sobel direkt auf rc.imageBitmap (z.B. 1920×1080):
const EDGE_SCALE = 0.5  // Konstante, leicht änderbar

// Temp-OffscreenCanvas in halber Größe:
const w = Math.round(rc.imageBitmap.width * EDGE_SCALE)
const h = Math.round(rc.imageBitmap.height * EDGE_SCALE)
const offscreen = new OffscreenCanvas(w, h)
const ctx2d = offscreen.getContext('2d')!
ctx2d.drawImage(rc.imageBitmap, 0, 0, w, h)
const scaledData = ctx2d.getImageData(0, 0, w, h)

// Sobel auf scaledData statt auf vollem Bitmap
```

Edge-Punkte nach dem Sobel wieder auf Original-Koordinaten hochskalieren
(× 1/EDGE_SCALE) vor dem Polyline-Render.

**Wichtig:** `EDGE_SCALE` als benannte Konstante exportieren —
kein Magic-Number inline.

---

## Schritt 3 — Re-Messen

Dieselbe Timeline wie in der Diagnose-Session.
Neue `performance.measure()`-Werte für `fx-Contour` notieren
(avg + max). Erwartung: avg ~1.5ms, max < 50ms.

---

## Undo-Behaviour

| Action | Behandlung |
|---|---|
| Contour-Param-Änderungen | bestehend — unverändert |
| Kein neuer Store-State | — |

*(Reine Renderer-Optimierung — kein neuer Store-State, kein Undo-Impact.)*

---

## Tests

- Existing Contour-Tests müssen alle grün bleiben
- Neuer Unit-Test: Edge-Cache-Key-Invalidierung
  (neuer `imageBitmapKey` → Cache-Miss → Re-Extraction)
- Neuer Unit-Test: `EDGE_SCALE = 0.5` →
  Output-Koordinaten korrekt auf Original-Größe hochskaliert

Mindest: **+2 Tests**

---

## Commits

```
fix(fx-contour): edge-cache keyed correctly on imageBitmapKey
perf(fx-contour): half-resolution edge-extraction (EDGE_SCALE = 0.5)
test(fx-contour): cache invalidation + coordinate upscale
```

3 Commits. Schritt 1 (Cache-Fix) und Schritt 2 (Half-Res) sind
separate Commits — auch wenn beides klein ist.
