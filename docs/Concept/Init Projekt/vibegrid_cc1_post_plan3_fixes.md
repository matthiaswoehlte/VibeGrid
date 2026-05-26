# CC #1 Feedback — nach Plan 3 QA

Plan 3 nicht freigegeben wegen einem Bug. 3 weitere Fixes.
Danach freigegeben für Plan 4.

---

## Fix 1: 🔴 contour.threshold — toter Param entfernen (MUSS)

**Entscheidung: Option (b) — Threshold fest auf 0.3, aus paramSchema entfernen**

```ts
// lib/fx/contour/index.ts — paramSchema ändern:
// ENTFERNEN:
threshold: {
  kind: 'slider',
  min: 0.05, max: 0.95, step: 0.05, default: 0.3,
  label: 'Edge threshold'
}

// BEHALTEN: color, dashLength, glow (alles was render() tatsächlich nutzt)

// Kommentar hinzufügen wo extractContours aufgerufen wird:
// Threshold hardcoded at 0.3 — good default for most images.
// v0.2: make configurable via preload(bitmap, signal, params?)
// which requires a params-aware cache key (bitmap + threshold tuple).
```

```ts
// lib/fx/contour/preload.ts — ContourPath Interface erweitern
// damit threshold-Wert dokumentiert ist:
export interface ContourPath {
  points: Array<[x: number, y: number]>;
  // threshold used during extraction — for future cache-key use
  threshold: number;
}
// In extractContours: { points, threshold } zurückgeben
```

Commit: `fix(fx): remove dead threshold param from contour — hardcode 0.3 (v0.2: configurable)`

---

## Fix 2: 🟡 sweep.ts RadialGradient Cast entfernen

```ts
// lib/fx/sweep.ts — Cast vereinfachen:
// STATT:
rc.ctx.fillStyle = grad as unknown as string;
// SO:
rc.ctx.fillStyle = grad;
// CanvasRenderingContext2D.fillStyle akzeptiert CanvasGradient direkt
```

Commit: `fix(fx): remove unnecessary cast in sweep fillStyle`

---

## Fix 3: 🟡 Image Aspect Ratio — Entscheidung: Cover

```ts
// lib/renderer/loop.ts — drawImage mit Cover-Logik ersetzen:

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  w: number,
  h: number
): void {
  const scale = Math.max(w / bitmap.width, h / bitmap.height);
  const sw = bitmap.width * scale;
  const sh = bitmap.height * scale;
  const sx = (w - sw) / 2;
  const sy = (h - sh) / 2;
  ctx.drawImage(bitmap, sx, sy, sw, sh);
}

// Im tick() — ersetzen:
// STATT: ctx!.drawImage(imageBitmap, 0, 0, w, h);
// SO:
drawImageCover(ctx!, imageBitmap, w, h);
```

Kommentar: `// object-fit: cover — maintains aspect ratio, crops edges`

Commit: `fix(renderer): drawImage with cover scaling (maintain aspect ratio)`

---

## Watchlist für Plan 5:

**image-cache.ts evict-Race:**
In Plan 5 wenn UI evict() aufruft — dort Guard einbauen:
```ts
// Nach bitmap resolve in inflight-Promise:
if (!inflight.has(mediaId)) return; // war bereits evicted
```
Kein Fix jetzt — erst wenn Plan 5 evict() tatsächlich aufruft.

**Engine-setBPM vs. Store-setBPM Divergenz:**
Plan 5 synchronisiert via useAudioEngine Hook.
Explizit in Plan 5 Spec adressieren.

---

Nach diesen 3 Fixes: Plan 4 (Storage & API Layer) schreiben.
