# CC Feedback — Plan 3: Renderer + FX Plugins

✅ Freigegeben mit Antworten auf alle 7 Open Questions + drei Anmerkungen.

---

## Antworten auf die 7 Open Questions

**1. Contour Algorithm — Sobel + Flood statt vollem Canny:**
✅ Akzeptiert für v0.1. Simplified Canny reicht für den visuellen Effekt.
Kommentar im Code ist korrekt: NMS + Hysteresis als v0.2-Upgrade dokumentiert.
Kein Scope-Upgrade jetzt.

**2. RENDER_ORDER — contour → sweep → particles → pulse:**
✅ Reihenfolge so beibehalten. Pulse gehört als letztes — es ist ein
Full-Frame-Overlay und soll über allem liegen, auch über Particles.
Die vorgeschlagene Reihenfolge ist korrekt.

**3. Pulse fade math — `decay = max(0, 1 - beatPhase * 4)` als Param:**
Nein — kein zusätzlicher Param. Das ist ein Implementierungsdetail,
kein User-facing Parameter. `intensity` Slider ist genug Kontrolle.
Weniger Params = einfacherer Inspector.

**4. Sweep gradient drawing — fillRect vs arc:**
✅ `fillRect` mit Bounding Box beibehalten. `ctx.arc()` + `fill()`
schneidet den Gradienten an den Kreiskanten ab — sieht schlechter aus.
`fillRect` mit radial gradient ist visuell besser für weiche Orbs.

**5. ImageBitmap cache eviction — kein LRU für v0.1:**
✅ Akzeptiert — unbounded cache für v0.1. Normale User-Session
lädt 3-5 Bilder. Als TODO-Kommentar in `image-cache.ts` dokumentieren:
`// TODO v0.2: add LRU eviction (cap: 8 bitmaps)`

**6. Particles spawn global statt per-clip:**
✅ Akzeptiert für v0.1. Einschränkung im Code dokumentieren:
`// v0.1: module-level state — single particles track expected`

**7. DPR test — nur Wiring, nicht Auto-firing:**
✅ Akzeptiert. jsdom ResizeObserver feuert nicht.
Manuelle Smoke + e2e in Plan 6 decken das echte DPR-Verhalten ab.

---

## Anmerkung 1: particles.ts — module-level Pool ist ein Test-Isolation-Problem

```ts
// AKTUELL — module-level, bleibt zwischen Tests bestehen:
let pool: Particle[] = makePool();
let lastSpawnBeat: number | null = null;
```

Tests die `particlesPlugin.render()` aufrufen könnten sich
gegenseitig beeinflussen wenn Pool-State überläuft.

**Fix:**
```ts
// particlesPlugin.dispose() in jedem Particles-Test in afterEach aufrufen:
afterEach(() => {
  particlesPlugin.dispose();
});
```

Alternativ Pool in plugin-Instanz statt module-level verschieben —
aber das ist ein größeres Refactor. Für v0.1: `dispose()` in afterEach.
Bitte im Test explizit ergänzen.

---

## Anmerkung 2: contour.ts — OffscreenCanvas Guard fehlt

`preload()` nutzt `OffscreenCanvas`. In der App (Browser) ist das
verfügbar — aber es fehlt ein `isClient()` Guard:

```ts
// lib/fx/contour/index.ts — in preload():
async preload(imageBitmap, signal) {
  if (!isClient()) return;  // ← Guard hinzufügen
  // ... OffscreenCanvas Nutzung
}
```

Ohne Guard bricht der Next.js SSR-Build wenn contour irgendwo
auf Server-Side importiert wird. Konsistent mit CLAUDE.md Regel #1.

---

## Anmerkung 3: loop.ts — `sliceKind` cast ist fragil

```ts
// AKTUELL:
const sliceKind = kind.toLowerCase() as keyof typeof fxByKind;
```

`RENDER_ORDER` enthält `'Contour' | 'Pulse' | 'Sweep' | 'Particle'`.
`activeFxClipsByKind` gibt `Record<FxKind, Clip[]>` zurück wo
`FxKind = 'contour' | 'sweep' | 'pulse' | 'particles'`.

`'Particle'.toLowerCase()` → `'particle'` aber der Key heißt `'particles'`.
Das ist ein stiller Bug — `fxByKind['particle']` ist `undefined`.

**Fix:**
```ts
// lib/renderer/loop.ts — explizites Mapping statt toLowerCase():
const KIND_TO_TRACK: Record<FxPlugin['kind'], FxKind> = {
  Contour:  'contour',
  Pulse:    'pulse',
  Sweep:    'sweep',
  Particle: 'particles'  // ← Particle ≠ particles ohne dieses Mapping
};

// In der Render-Schleife:
const sliceKind = KIND_TO_TRACK[kind];
const clips = fxByKind[sliceKind] ?? [];
```

Das ist ein echter Bug — Particles würden nie rendern ohne diesen Fix.

---

## Bestätigung: Was explizit gut ist ✅

- `_resetRegistryForTests()` und `_resetRendererForTests()` — sauber
- `deps.rafCallback` Injectable für deterministischen Loop-Test — sehr gut
- `seekCounter` Pattern für lastFired-State-Clear — elegant
- `StubOffscreen` direkt im Test statt global — richtig isoliert
- `resolveColor()` für CSS-Variable-Support geplant — wichtig für Accent-Themes
- Explicit `registerBuiltInPlugins()` statt Side-Effect-Import — sauber
- `TODO v0.2` Kommentare für LRU und Particle-Multi-Instance — professionell
