# CC #1 Prompt — Plan 8e: FX-Pack (9 Beat-Sync-Effekte, Rev. 3)

> Rev. 4 — alle 3 Blocker + Pflicht-Politur (D/E/F/G/H) aus CC1-Review (Rev. 3).
> B1: RGBSplit Offscreen-pro-Kanal. B2: select {value,label}[]. B3: imageBitmap-Guard.
> F: step-Werte überall. G: BeatFlash/Pulse Render-Order. H: containRect Pflicht-Export.

---

## Kontext

Baseline: HEAD post-8d. Exakte Test-Zahl: `npm test -- --run 2>&1 | grep -E "Tests|passed"` in Schritt 0.

Schreibe nur den **Plan** — noch keinen Code.

---

## Schritt 0 — Codebase lesen (PFLICHT)

1. `lib/fx/zoom-pulse.ts` komplett — Master-Template für Kategorie-A
2. `lib/fx/sunray.ts` komplett — Master-Template für Kategorie-B + flowMode-Variation
3. `lib/fx/text.ts` — color-picker paramSchema + label-Felder
4. `lib/fx/index.ts` — register()-Aufruf-Muster
5. `lib/renderer/types.ts` — `FxPlugin<P>`-Shape komplett (alle Pflichtfelder),
   `RenderContext`-Shape (`beatIndex`, `beatPhase`, `flowMode`, `imageBitmap`,
   `clipId`, `clipStartSec`, `clipDurationSec`, `width`, `height`)
6. `lib/renderer/loop.ts` Z. ~197–210 — `drawImageContain`-Mathematik, exportiert oder privat?
7. `lib/timeline/plugin-mapping.ts` komplett — alle Maps + Arrays lesen,
   insbesondere `PLUGIN_KIND_TO_TRACK_KIND`, `TRACK_KIND_TO_PLUGIN_KIND`,
   `RENDER_ORDER_TRACK_KIND` (aktueller Inhalt vollständig aufschreiben)
8. `lib/utils/color.ts` — `hexToRgba`-Signatur
9. `lib/utils/prng.ts` — existiert? (falls ja: Signatur notieren)
10. `lib/fx/pulse.ts` — Entscheidung: BeatFlash = Erweiterung von Pulse ODER neues beat-flash.ts?
    **Ergebnis im Plan-Header dokumentieren. Anzahl FX = 9 oder 10 je nach Entscheidung.**
11. Aktuelle Test-Zahl notieren

---

## [Fix B3] Naming-Konvention — ZWEI verschiedene Strings pro FX

| Stelle | Format | Beispiel BeatFlash |
|---|---|---|
| `FxKind` (types.ts Union) | PascalCase | `'BeatFlash'` |
| `PluginFxKind` (plugin-mapping.ts) | PascalCase | `'BeatFlash'` |
| `plugin.kind` (im Plugin-Objekt) | PascalCase | `'BeatFlash'` |
| `TRACK_FX_KINDS` | kebab-case | `'beat-flash'` |
| `clip.kind` (Store) | kebab-case | `'beat-flash'` |

Beide Strings müssen konsistent sein — die Maps in plugin-mapping.ts übersetzen zwischen beiden.

---

## [Fix B4] Integration-Checkliste — 7 Stellen (nicht 6)

Jeder neue FX braucht Einträge an exakt **7 Stellen**:

```
1. lib/fx/<name>.ts                         CREATE
2. lib/fx/index.ts                          MODIFY — register(plugin)
3. lib/renderer/types.ts                    MODIFY — FxKind | 'BeatFlash' (PascalCase)
4. lib/timeline/plugin-mapping.ts           MODIFY — 5 Stellen:
   4a. TRACK_FX_KINDS.add('beat-flash')     (kebab)
   4b. PluginFxKind | 'BeatFlash'           (Pascal)
   4c. RENDER_ORDER_TRACK_KIND              (an korrekte Position)
   4d. FX_DISPLAY_NAME.set('BeatFlash', 'Beat Flash')
   4e. FX_CLIP_COLORS.set('BeatFlash', '#RRGGBB')   ← 6-stellig!
   4f. PLUGIN_KIND_TO_TRACK_KIND['BeatFlash'] = 'beat-flash'
   4g. TRACK_KIND_TO_PLUGIN_KIND['beat-flash'] = 'BeatFlash'
5. tests/unit/fx/<name>.test.ts             CREATE — ≥ 5 Tests
```

4f + 4g sind **Pflicht** — ohne sie löst `lib/renderer/loop.ts:435` den Plugin nie auf.

---

## [Fix A] Master-Skelett — jeder neue FX folgt diesem Template

```typescript
// Referenz: lib/fx/zoom-pulse.ts + lib/fx/sunray.ts

// [Fix B2] Contain-Mathematik — EINMAL HIER, dann in jedem Kat-A-FX inline
function containRect(rc: RenderContext) {
  const bm = rc.imageBitmap;
  const scale = Math.min(rc.width / bm.width, rc.height / bm.height);
  const sw = bm.width * scale, sh = bm.height * scale;
  const sx = (rc.width - sw) / 2, sy = (rc.height - sh) / 2;
  return { sx, sy, sw, sh };
}
// ctx.drawImage(rc.imageBitmap, sx, sy, sw, sh)  ← NIEMALS drawImage(bm,0,0,w,h)

// [Fix B1] Per-Clip-State: module-scope Map, KEIN this in render()
const stateByClip = new Map<string, OffscreenCanvas>();

export const myFxPlugin: FxPlugin<MyParams> = {
  id:            'my-fx',          // kebab (eindeutig, für Fehlermeldungen)
  name:          'My FX',          // Display-Name (auch in FX_DISPLAY_NAME)
  kind:          'MyFx',           // PascalCase — muss FxKind-Union matchen
  defaultTrigger: 'beat',          // [Fix W13] alle 9 FX: 'beat'
  preloadState:  'ready',
  paramSchema: {
    // [Fix D17+B2] label Pflicht + select braucht {value,label}[]:
    intensity: { kind: 'slider', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.8 },
    color:     { kind: 'color',  label: 'Color',     default: '#ffffff' },
    mode: {
      kind: 'select', label: 'Blend Mode',
      options: [
        { value: 'screen',  label: 'Screen'  },
        { value: 'overlay', label: 'Overlay' },
      ],
      default: 'screen',
    },
  },
  getDefaultParams: () => ({ intensity: 0.8, color: '#ffffff', mode: 'screen' }),
  async preload() {},

  render(rc: RenderContext, params: MyParams) {
    // flowMode zuerst
    if (rc.flowMode) return;  // oder flowMode-spezifischer Branch
    // envelope berechnen
    const env = Math.max(0, 1 - rc.beatPhase / params.decay);
    if (env < 0.01) return;  // [Fix B5] kein Re-Draw — Bild schon gezeichnet
    // ...FX-Logik...
  },

  dispose() {
    stateByClip.clear();  // Speicher freigeben bei HMR
  },
};
```

**Kategorie A — Image-Modifying** (ZoomPunch, ScreenShake, RGBSplit, GlitchSlice):

**[Fix B3] imageBitmap-Guard Pflicht in jedem Kat-A-FX:**
```typescript
if (!rc.imageBitmap) return;  // Option (b) — self-contained guard
```
Oder: `lib/renderer/loop.ts` Guard-Erweiterung (Option a, siehe File Map).

```typescript
// Immer mit containRect — NIEMALS drawImage(bm, 0, 0, rc.width, rc.height)
const { sx, sy, sw, sh } = containRect(rc);
ctx.save();
// ... transform ...
ctx.drawImage(rc.imageBitmap, sx, sy, sw, sh);
ctx.restore();
```

**[Fix H] containRect() — verbindlich aus loop.ts exportieren (nicht optional):**
Jeder Kat-A-FX importiert `import { containRect } from '@/lib/renderer/loop'`.
File-Map: `lib/renderer/loop.ts MODIFY — containRect als named export` (Pflicht, nicht optional).

**[Fix F] Param-Schema-Übersetzungsregel für die FX-Specs:**
Kommentar `// slider, A–B, Default D, step S, label 'L'` entspricht:
```typescript
{ kind: 'slider', label: 'L', min: A, max: B, step: S, default: D }
```
Kommentar `// select, ['v1','v2'], Default D, label 'L'` entspricht:
```typescript
{ kind: 'select', label: 'L', options: [{value:'v1',label:'V1'},{value:'v2',label:'V2'}], default: D }
```
**Alle Select-Params müssen `{value,label}[]` nutzen — kein `string[]`.**

**[Fix E] Offscreen-Canvas Clip-Remove-Leak (KNOWN_LIMITATIONS):**
`grainOffscreenByClip`, `glitchOffscreenByClip`, `rgbOffByClip` wachsen mit jedem
Clip-Add-Remove-Zyklus. `dispose()` räumt nur bei HMR auf. Export-Pfad nicht betroffen.
KNOWN_LIMITATIONS-Eintrag: "Per-Clip-Offscreens werden nicht bei Clip-Remove freigegeben.
HMR oder Seiten-Reload räumt auf. Bei langen Edit-Sessions (viele Clip-Add/Remove-Zyklen)
ca. 8–16 MB pro genutztem FX."

**[Fix G] BeatFlash/Pulse Render-Order-Disambiguierung:**
- Falls Schritt-0-Entscheidung = **MODIFY pulse.ts**: kein neuer Render-Order-Eintrag.
  `'pulse'` bleibt an bestehender Position.
- Falls Schritt-0-Entscheidung = **CREATE beat-flash.ts**: `'beat-flash'` an gezeigter
  Position einfügen. `'pulse'` bleibt ebenfalls erhalten.

---

## [Fix B2+B5] Render-Regeln für Kategorie-A-FX

```typescript
render(rc, params) {
  if (rc.flowMode) return;
  const env = Math.max(0, 1 - rc.beatPhase / params.decay);
  if (env < 0.01) return;  // [Fix B5] KEIN Re-Draw — einfach return

  const { sx, sy, sw, sh } = containRect(rc);
  ctx.save();
  // Transform hier
  ctx.drawImage(rc.imageBitmap, sx, sy, sw, sh);
  ctx.restore();
}
```

---

## Render-Reihenfolge in RENDER_ORDER_TRACK_KIND

Bestehende Entries (aus Schritt 0 lesen) + neue Positionen:

```
image          (bestehend, Basis)
video          (bestehend)
'dissolve'     (bestehend, image-modifying)
'contour'      (bestehend, image-modifying)
'zoom-pulse'   (bestehend, image-modifying)
--- NEUE IMAGE-MODIFYING FX ---
'rgb-split'
'zoom-punch'
'screen-shake'
'glitch-slice'
--- BESTEHENDE OVERLAY FX ---
'sweep'        (bestehend)
'particles'    (bestehend)
'pulse'        (bestehend)
'sunray'       (bestehend)
'text'         (bestehend)
--- NEUE OVERLAY FX ---
'beat-flash'
'vignette-breathe'
'lens-flare-burst'
'film-grain-burst'
'letterbox-squeeze'   ← ALLERLETZTES
```

CC #1 bestätigt bestehende Reihenfolge in Schritt 0 und flicht an den richtigen Stellen ein.

---

## Flow-Mode-Tabelle

| FX | flowMode |
|---|---|
| BeatFlash | `return` |
| RGBSplit | `return` |
| ZoomPunch | `return` |
| ScreenShake | `return` |
| GlitchSlice | `return` |
| VignetteBreathe | statisch bei `baseSize` |
| LensFlareBurst | `return` |
| FilmGrainBurst | `return` |
| LetterboxSqueeze | statisch bei `intensity × targetBarH` |

---

## FX-Specs Rev. 3

### FX 1: BeatFlash / Pulse-Erweiterung *(Schritt-0-Entscheidung)*

```typescript
interface BeatFlashParams {
  intensity:  number;  // slider, 0–1, step 0.01, Default 0.8, label 'Intensity'
  color:      string;  // color, Default '#ffffff', label 'Color'
  duration:   number;  // slider, 0.01–1 Beats, step 0.01, Default 0.1, label 'Duration'
  blendMode:  string;  // select [{value:'screen',label:'Screen'},{value:'overlay',label:'Overlay'},{value:'normal',label:'Normal'}], Default 'screen', label 'Blend'
}
// Kategorie B — Overlay
render(rc, params) {
  if (rc.flowMode) return;
  const env = Math.max(0, 1 - rc.beatPhase / params.duration);
  if (env < 0.01) return;
  ctx.save();
  ctx.globalAlpha = params.intensity * env;
  ctx.globalCompositeOperation = params.blendMode as GlobalCompositeOperation;
  ctx.fillStyle = params.color;
  ctx.fillRect(0, 0, rc.width, rc.height);
  ctx.restore();
}
```

---

### FX 2: RGBSplit

**[Fix B1]** Composite-Tint auf Hauptcanvas zerstört Original. Korrekt: pro Kanal
einen Offscreen aufbauen (clear → drawImage → multiply-tint), dann per `screen`
auf Hauptcanvas compositen.

```typescript
interface RGBSplitParams {
  offset:    number;  // slider, 0–0.05 fraction of width, step 0.001, Default 0.004, label 'Offset'
  decay:     number;  // slider, 0.01–0.5 Beats, step 0.01, Default 0.15, label 'Decay'
  intensity: number;  // slider, 0–1, step 0.01, Default 0.6, label 'Intensity'
}
// Kategorie A — Image-Modifying
// [Fix B1] Zwei Offscreens (R+B), module-scope, rc.clipId-keyed
const rgbOffByClip = new Map<string, { r: OffscreenCanvas; b: OffscreenCanvas }>();

render(rc, params) {
  if (!rc.imageBitmap) return;  // [Fix B3]
  if (rc.flowMode) return;
  const env = Math.max(0, 1 - rc.beatPhase / params.decay);
  if (env < 0.01) return;

  const { sx, sy, sw, sh } = containRect(rc);
  const ox = rc.width * params.offset * env;

  // Lazy-init Offscreens
  let pair = rgbOffByClip.get(rc.clipId);
  if (!pair || pair.r.width !== rc.width) {
    pair = {
      r: new OffscreenCanvas(rc.width, rc.height),
      b: new OffscreenCanvas(rc.width, rc.height),
    };
    rgbOffByClip.set(rc.clipId, pair);
  }

  // Original zuerst zeichnen
  ctx.drawImage(rc.imageBitmap, sx, sy, sw, sh);

  // Rot-Kanal-Offscreen: bitmap mit +offset, Blau+Grün wegmultiplizieren
  const rCtx = pair.r.getContext('2d')!;
  rCtx.clearRect(0, 0, rc.width, rc.height);
  rCtx.drawImage(rc.imageBitmap, sx + ox, sy, sw, sh);
  rCtx.globalCompositeOperation = 'multiply';
  rCtx.fillStyle = 'rgba(255,0,0,1)';  // nur R-Kanal behalten
  rCtx.fillRect(0, 0, rc.width, rc.height);
  rCtx.globalCompositeOperation = 'source-over';

  // Blau-Kanal-Offscreen: bitmap mit -offset
  const bCtx = pair.b.getContext('2d')!;
  bCtx.clearRect(0, 0, rc.width, rc.height);
  bCtx.drawImage(rc.imageBitmap, sx - ox, sy, sw, sh);
  bCtx.globalCompositeOperation = 'multiply';
  bCtx.fillStyle = 'rgba(0,0,255,1)';  // nur B-Kanal behalten
  bCtx.fillRect(0, 0, rc.width, rc.height);
  bCtx.globalCompositeOperation = 'source-over';

  // Kanal-Offscreens per 'screen' auf Hauptcanvas compositen
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = params.intensity * env;
  ctx.drawImage(pair.r, 0, 0);
  ctx.drawImage(pair.b, 0, 0);
  ctx.restore();
},
dispose() { rgbOffByClip.clear(); }
```

---

### FX 3: ZoomPunch

```typescript
interface ZoomPunchParams {
  strength:   number;  // slider, 1.0–1.3, step 0.01, Default 1.12, label 'Strength'
  attack:     number;  // slider, 0.01–0.1 Beats, step 0.01, Default 0.02, label 'Attack'
  decay:      number;  // slider, 0.01–0.5 Beats, step 0.01, Default 0.15, label 'Decay'
  direction:  string;  // select [{value:'in',label:'Zoom In'},{value:'out',label:'Zoom Out'}], Default 'in', label 'Direction'
  // direction='out': scale < 1 am Peak — schwarze Letterbox-Ränder sind intentional (Zoom-Out-Effekt)
}
// Kategorie A
render(rc, params) {
  if (!rc.imageBitmap) return;  // [Fix B3]
  if (rc.flowMode) return;
  const p = rc.beatPhase;
  let scale: number;
  if (p < params.attack) {
    scale = 1 + (params.strength - 1) * (p / params.attack);
  } else {
    scale = 1 + (params.strength - 1) * Math.max(0, 1 - (p - params.attack) / params.decay);
  }
  if (params.direction === 'out') scale = 2 - scale;
  if (Math.abs(scale - 1) < 0.001) return;  // [Fix W4] identity transform → skip

  const { sx, sy, sw, sh } = containRect(rc);
  const cx = rc.width / 2, cy = rc.height / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
  ctx.drawImage(rc.imageBitmap, sx, sy, sw, sh);
  ctx.restore();
}
```

---

### FX 4: ScreenShake

```typescript
interface ScreenShakeParams {
  intensity:  number;  // slider, 0–0.03 fraction of width, step 0.001, Default 0.004, label 'Intensity'
  frequency:  number;  // slider, 0.5–4, step 0.1, Default 2, label 'Frequency'
  decay:      number;  // slider, 0–1 Beats, step 0.01, Default 0.4, label 'Decay'
  axis:       string;  // select [{value:'both',label:'Both'},{value:'x',label:'Horizontal'},{value:'y',label:'Vertical'}], Default 'both', label 'Axis'
}
// Kategorie A
render(rc, params) {
  if (!rc.imageBitmap) return;  // [Fix B3]
  if (rc.flowMode) return;
  const env = Math.max(0, 1 - rc.beatPhase / params.decay);
  if (env < 0.01) return;

  const px = rc.width * params.intensity;
  const t = rc.beatPhase * params.frequency * Math.PI * 2;
  const dx = params.axis !== 'y' ? Math.sin(t) * px * env : 0;
  const dy = params.axis !== 'x' ? Math.cos(t * 1.3) * px * env : 0;

  const { sx, sy, sw, sh } = containRect(rc);
  ctx.save();
  ctx.translate(dx, dy);
  ctx.drawImage(rc.imageBitmap, sx, sy, sw, sh);
  ctx.restore();
}
```

---

### FX 5: VignetteBreathe

**[Fix D14] Umbenannt von VignettePulse.** Mit `baseSize=0` = echter Puls (geht auf 0).
Mit `baseSize>0` = Atmen zwischen zwei Größen.

```typescript
interface VignetteBreatheParams {
  color:     string;  // color, Default '#000000', label 'Color'
  baseSize:  number;  // slider, 0–0.8, step 0.01, Default 0.0, label 'Base Size'
  peakSize:  number;  // slider, 0–1, step 0.01, Default 0.5, label 'Peak Size'
  intensity: number;  // slider, 0–1, step 0.01, Default 0.7, label 'Intensity'
  decay:     number;  // slider, 0–1 Beats, step 0.01, Default 0.3, label 'Decay'
}
// Kategorie B — Overlay
render(rc, params) {
  const env = rc.flowMode ? 0 : Math.max(0, 1 - rc.beatPhase / params.decay);
  const vigSize = params.baseSize + (params.peakSize - params.baseSize) * env;
  if (vigSize < 0.001) return;

  const { width: w, height: h } = rc;
  const r = Math.min(w, h);
  const inner = r * (1 - vigSize);
  const outer = r * 1.4;
  const grad = ctx.createRadialGradient(w/2, h/2, inner, w/2, h/2, outer);
  grad.addColorStop(0, hexToRgba(params.color, 0));
  grad.addColorStop(1, hexToRgba(params.color, params.intensity));
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
```

---

### FX 6: LensFlareBurst *(unverändert zu Rev. 2 außer Skeleton-Pattern)*

```typescript
interface LensFlareBurstParams {
  color:     string;  // color, Default '#ffffff', label 'Color'
  intensity: number;  // slider, 0–1, step 0.01, Default 0.6, label 'Intensity'
  rayCount:  number;  // slider, 4–16, step 1, Default 8, label 'Ray Count'
  rayLength: number;  // slider, 0.2–1.0 fraction of width, step 0.05, Default 0.5, label 'Ray Length'
  centerX:   number;  // slider, 0–1, step 0.01, Default 0.5, label 'Center X'
  centerY:   number;  // slider, 0–1, step 0.01, Default 0.5, label 'Center Y'
  decay:     number;  // slider, 0–0.5 Beats, step 0.01, Default 0.2, label 'Decay'
}
// Kategorie B — Overlay
render(rc, params) {
  if (rc.flowMode) return;
  const env = Math.max(0, 1 - rc.beatPhase / params.decay);
  if (env < 0.01) return;
  const { width: w, height: h } = rc;
  const cx = w * params.centerX, cy = h * params.centerY;
  const len = w * params.rayLength * env;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < params.rayCount; i++) {
    const angle = (i / params.rayCount) * Math.PI * 2;
    const ex = cx + Math.cos(angle) * len;
    const ey = cy + Math.sin(angle) * len;
    const grad = ctx.createLinearGradient(cx, cy, ex, ey);
    grad.addColorStop(0, hexToRgba(params.color, params.intensity * env));
    grad.addColorStop(1, hexToRgba(params.color, 0));
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey);
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(1, 3 * env);
    ctx.stroke();
  }
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 50 * env);
  glow.addColorStop(0, hexToRgba(params.color, params.intensity * env));
  glow.addColorStop(1, hexToRgba(params.color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
```

---

### FX 7: FilmGrainBurst

**[Fix B1]** module-scope Map mit `rc.clipId`. Offscreen wird lazy-init.

```typescript
interface FilmGrainBurstParams {
  intensity:  number;  // slider, 0–1, step 0.01, Default 0.4, label 'Intensity'
  decay:      number;  // slider, 0–0.5 Beats, step 0.01, Default 0.15, label 'Decay'
  grainSize:  number;  // slider, 1–4, step 1, Default 1, label 'Grain Size'
  colorMode:  string;  // select [{value:'white',label:'White'},{value:'colored',label:'Colored'},{value:'black',label:'Black'}], Default 'white', label 'Color Mode'
}
// Kategorie B — Overlay
const grainOffscreenByClip = new Map<string, OffscreenCanvas>();  // [Fix B1]

render(rc, params) {
  if (rc.flowMode) return;
  const env = Math.max(0, 1 - rc.beatPhase / params.decay);
  if (env < 0.02) return;

  const scale = Math.max(1, Math.round(params.grainSize));
  const gw = Math.ceil(rc.width / scale);
  const gh = Math.ceil(rc.height / scale);

  let off = grainOffscreenByClip.get(rc.clipId);
  if (!off || off.width !== gw || off.height !== gh) {
    off = new OffscreenCanvas(gw, gh);
    grainOffscreenByClip.set(rc.clipId, off);
  }
  const gCtx = off.getContext('2d')!;
  const imgData = gCtx.createImageData(gw, gh);
  const d = imgData.data;
  const eff = params.intensity * env;
  for (let i = 0; i < d.length; i += 4) {
    const v = (Math.random() - 0.5) * 255 * eff;
    d[i]   = params.colorMode === 'black' ? 0 : 128 + v;
    d[i+1] = params.colorMode === 'colored' ? 128 + (Math.random()-0.5)*255*eff :
             params.colorMode === 'black' ? 0 : 128 + v;
    d[i+2] = params.colorMode === 'black' ? 0 : 128 + v;
    d[i+3] = Math.abs(v);
  }
  gCtx.putImageData(imgData, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(off, 0, 0, rc.width, rc.height);
  ctx.restore();
},
dispose() { grainOffscreenByClip.clear(); }
```

---

### FX 8: GlitchSlice

**[Fix B6]** Bitmap-Koordinaten-Problem: pre-render bitmap auf canvas-großen Offscreen,
dann aus Offscreen (Canvas-Koordinaten) slicen. Module-scope Map.

```typescript
interface GlitchSliceParams {
  sliceCount: number;  // slider, 2–8, step 1, Default 4, label 'Slices'
  maxOffset:  number;  // slider, 0–0.05 fraction of width, step 0.001, Default 0.01, label 'Offset'
  decay:      number;  // slider, 0.01–0.3 Beats, step 0.01, Default 0.08, label 'Decay'
  seed:       number;  // slider, 0–999, step 1, Default 42, label 'Seed'
  axis:       string;  // select [{value:'h',label:'Horizontal'},{value:'v',label:'Vertical'}], Default 'h', label 'Axis'
}
// Kategorie A — Image-Modifying
const glitchOffscreenByClip = new Map<string, OffscreenCanvas>();

render(rc, params) {
  if (!rc.imageBitmap) return;  // [Fix B3]
  const env = Math.max(0, 1 - rc.beatPhase / params.decay);
  if (env < 0.01) return;

  // [Fix B6] Pre-render bitmap (mit contain) auf Canvas-großen Offscreen
  let off = glitchOffscreenByClip.get(rc.clipId);
  if (!off || off.width !== rc.width) {
    off = new OffscreenCanvas(rc.width, rc.height);
    glitchOffscreenByClip.set(rc.clipId, off);
  }
  const oCtx = off.getContext('2d')!;
  oCtx.clearRect(0, 0, rc.width, rc.height);
  const { sx, sy, sw, sh } = containRect(rc);
  oCtx.drawImage(rc.imageBitmap, sx, sy, sw, sh);
  // Jetzt ist off in Canvas-Koordinaten — safe zum Slicen

  const rand = mulberry32(params.seed + rc.beatIndex);  // lib/utils/prng.ts
  const { width: w, height: h } = rc;
  const isH = params.axis === 'h';
  const sliceSize = (isH ? h : w) / params.sliceCount;
  const maxPx = w * params.maxOffset * env;

  for (let i = 0; i < params.sliceCount; i++) {
    const offset = (rand() - 0.5) * 2 * maxPx;
    if (isH) {
      const sy2 = i * sliceSize;
      // src UND dst in Canvas-Coords (off hat Canvas-Größe)
      ctx.drawImage(off, 0, sy2, w, sliceSize, offset, sy2, w, sliceSize);
    } else {
      const sx2 = i * sliceSize;
      ctx.drawImage(off, sx2, 0, sliceSize, h, sx2, offset, sliceSize, h);
    }
  }
},
dispose() { glitchOffscreenByClip.clear(); }
```

---

### FX 9: LetterboxSqueeze *(flowMode statisch, unverändert zu Rev. 2)*

```typescript
interface LetterboxSqueezeParams {
  targetRatio: string;  // select [{value:'2.35:1',label:'2.35:1 Scope'},{value:'2.39:1',label:'2.39:1 Ultra'},{value:'1.85:1',label:'1.85:1 Flat'}], Default '2.35:1', label 'Ratio'
  attack:      number;  // slider, 0.01–0.2 Beats, step 0.01, Default 0.05, label 'Attack'
  decay:       number;  // slider, 0.01–1 Beats, step 0.01, Default 0.4, label 'Decay'
  intensity:   number;  // slider, 0–1, step 0.01, Default 1.0, label 'Intensity'
  color:       string;  // color, Default '#000000', label 'Color'
}
// Kategorie B — Overlay
render(rc, params) {
  const { width: w, height: h } = rc;
  const ratio = parseFloat(params.targetRatio);
  const targetBarH = Math.max(0, (h - w / ratio) / 2);
  if (targetBarH <= 1) return;

  let env: number;
  if (rc.flowMode) {
    env = params.intensity;
  } else {
    const p = rc.beatPhase;
    env = p < params.attack
      ? params.intensity * (p / params.attack)
      : params.intensity * Math.max(0, 1 - (p - params.attack) / params.decay);
  }
  if (env < 0.001) return;

  const barH = targetBarH * env;
  ctx.fillStyle = params.color;
  ctx.fillRect(0, 0, w, barH);
  ctx.fillRect(0, h - barH, w, barH);
}
```

---

## File Map

| Datei | Aktion |
|---|---|
| `lib/utils/prng.ts` | CREATE (falls nicht vorhanden) — mulberry32 |
| `lib/fx/beat-flash.ts` ODER `lib/fx/pulse.ts` | CREATE/MODIFY — Schritt-0-Entscheidung |
| `lib/fx/rgb-split.ts` | CREATE |
| `lib/fx/zoom-punch.ts` | CREATE |
| `lib/fx/screen-shake.ts` | CREATE |
| `lib/fx/vignette-breathe.ts` | CREATE |
| `lib/fx/lens-flare-burst.ts` | CREATE |
| `lib/fx/film-grain-burst.ts` | CREATE |
| `lib/fx/glitch-slice.ts` | CREATE |
| `lib/fx/letterbox-squeeze.ts` | CREATE |
| `lib/fx/index.ts` | MODIFY — 9 neue register()-Aufrufe |
| `lib/renderer/types.ts` | MODIFY — FxKind-Union (9 neue PascalCase) |
| `lib/timeline/plugin-mapping.ts` | MODIFY — 7 Stellen × 9 FX |
| `lib/renderer/loop.ts` | MODIFY — [Fix H] `containRect` als named export (Pflicht) + [Fix B3] `CAT_A_KINDS`-Guard um 4 neue Kinds erweitern: `'ZoomPunch','ScreenShake','RGBSplit','GlitchSlice'` |
| `docs/KNOWN_LIMITATIONS.md` | MODIFY — RGBSplit Composite-Approx + FilmGrain Perf + Offscreen-Clip-Remove-Leak + ColorGradeShift → 8f |

---

## Tests

**Pflicht-5 pro FX** (`tests/unit/fx/<name>.test.ts`):

```
1. env=0 (intensity=0 oder beatPhase > decay) → kein Draw-Call, return sofort
2. beatPhase=0 → maximaler Effekt, relevante ctx-Methoden aufgerufen
3. flowMode=true → korrekte Behandlung laut Tabelle (return oder statisch)
4. ctx.save()/restore() Disziplin → globalCompositeOperation nach FX unverändert
5. FX-spezifischer Edge-Case (siehe unten)
```

**Spezifische Tests:**
- `GlitchSlice`: `seed=42, beatIndex=0` vs `seed=42, beatIndex=1` → verschiedene offsets
- `GlitchSlice`: `seed=42, beatIndex=0` zweimal → identische offsets (Reproduzierbarkeit)
- `ScreenShake`: `axis='x'` → dy === 0
- `ScreenShake`: `axis='y'` → dx === 0
- `ZoomPunch`: `attack=0.01` (min) → kein NaN in scale
- `ZoomPunch`: `direction='out'` → scale < 1 am beatPhase=0
- `LetterboxSqueeze`: `w/h = 16/9, ratio=2.35` → barH > 0
- `LetterboxSqueeze`: `flowMode=true` → barH = intensity × targetBarH (statisch)
- `VignetteBreathe`: `baseSize=0, flowMode=true` → vigSize === 0, kein Draw
- `FilmGrainBurst`: `grainSize=2` → Offscreen-Dim < rc.width (Performance-Pfad)
- `FilmGrainBurst`: `dispose()` → grainOffscreenByClip.size === 0
- `GlitchSlice`: `dispose()` → glitchOffscreenByClip.size === 0
- `plugin-mapping.ts`: alle 9 neuen Kinds in **allen 5 Maps** vorhanden (Integrations-Test)
- `plugin-mapping.ts`: PLUGIN_KIND_TO_TRACK_KIND + TRACK_KIND_TO_PLUGIN_KIND round-trip korrekt

Mindest: **≥ 50 neue Tests**

---

## Verification Gate

Baseline: `npm test -- --run 2>&1 | grep -E "Tests|passed"` (CC #1 bestätigt in Schritt 0).
Ziel: **Baseline + ≥ 50**.

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Manuelle Smoke-Tests (WebM):**
```
# Alle 9 FX in FX-Library — korrekte Display-Namen, distinkte Clip-Farben
# Drag auf Video-Clip → Inspector zeigt paramSchema mit labels
# Kein FX-Clip rendern als schwarzer Frame (TRACK_KIND_TO_PLUGIN_KIND fehlt → schwarzes Bild)
# ZoomPunch direction='out' → Zoom-Out sichtbar (kein Zoom-In)
# ScreenShake axis='x' → keine Y-Bewegung sichtbar
# GlitchSlice seed=42 → gleiche Slice-Positionen in zwei unabhängigen Previews
# VignetteBreathe baseSize=0 → Vignette verschwindet zwischen Beats komplett
# VignetteBreathe flowMode → statische Vignette bei baseSize sichtbar
# LetterboxSqueeze flowMode → statische Balken sichtbar
# FilmGrainBurst grainSize=3 → spürbar schneller als grainSize=1
# RGBSplit → kein Strecken des Bildes (Aspect-Fit erhalten)
# WebM-Export: alle 9 FX ohne Freeze oder schwarzen Frame
# Automation: ZoomPunch strength als Kurve → sichtbare Beat-Variation
```

---

## Commit-Struktur

```
feat(utils): prng — mulberry32
feat(renderer): loop — containRect export + CAT_A_KINDS guard erweitern
feat(fx): beat-flash / pulse-extend
feat(fx): rgb-split — offscreen-per-channel composite
feat(fx): zoom-punch — scale===1 early return
feat(fx): screen-shake — fraction-of-width
feat(fx): vignette-breathe
feat(fx): lens-flare-burst
feat(fx): film-grain-burst — clipId-keyed offscreen + dispose
feat(fx): glitch-slice — contain-offscreen + prng
feat(fx): letterbox-squeeze — flowMode static
feat(fx): types + registry + plugin-mapping — alle 9 FX, 7 Stellen je
docs(limitations): RGBSplit approx + FilmGrain perf + Offscreen-Leak + ColorGradeShift → 8f
test: ≥50 neue Tests inkl. Integrations-Test plugin-mapping
```

---

## Out of Scope → Plan 8f

- **ColorGradeShift** — ctx.filter bricht OffscreenCanvas-Export in Safari
- WaveformFX, ParticleBurst, Web-Worker FilmGrain

---

Abgabe: `2026-05-25-vibegrid-plan-8e-v3-fx-pack.md`
