# CC #1 Prompt — Plan 8f.1: WebGL2 Foundation + ColorGradeShift

> Rev. 3 — alle 3 Blocker, 7 Wackler, 8 Doku-Lücken aus CC1-Review adressiert.
> Gesplittet: 8f.1 = Infra + ColorGradeShift. 8f.2 = RetroVHS (folgt).

Baseline: HEAD post-Plan-8e (1170 Tests).

---

## Schritt 0 — Codebase lesen (PFLICHT)

1. `lib/renderer/loop.ts` — wo wird `performance.now()` im Render-Tick genutzt?
   Wo ist der Offline-Export-Pfad (`lib/export/offline-render.ts` o.ä.)?
2. `lib/renderer/types.ts` — RenderContext komplett, FxPlugin<P>
3. `lib/fx/glitch-slice.ts` — `dispose()`-Aufrufpunkt: wer ruft's wann?
4. `lib/store/` — wo lebt UIState? Wie werden transiente Felder gehandhabt?
5. `lib/timeline/plugin-mapping.ts` — **8 Stellen** bestätigen (nicht 7):
   TRACK_FX_KINDS, PluginFxKind, RENDER_ORDER, FX_DISPLAY_NAME, FX_CLIP_COLORS,
   PLUGIN_KIND_TO_TRACK_KIND, TRACK_KIND_TO_PLUGIN_KIND, **FxKind in types.ts**
6. Ob `isClient()` oder equivalentes Guard in der Codebase existiert
7. Aktuellen Test-Zahl

---

## Architektur

```
lib/renderer/webgl/
  capabilities.ts    — Device-Check (SSR-safe, einmalig)
  quality.ts         — FPS-Wächter + Auto-Scaling (offline-aware)
  context.ts         — WebGL2-Context pro Clip + Location-Cache
  shader.ts          — Compile + WeakMap-Program-Cache + Precision-Adapt
  texture.ts         — ImageBitmap → WebGL2-Texture (mit Reuse)
  quad.ts            — Einheits-Quad-Buffer (einmalig pro GL-Context)
  pipeline.ts        — renderGlFx() — einzige API die FX aufrufen
  programs/
    color-grade.ts   — GLSL + Uniform-Types
```

---

## Modul 1 — capabilities.ts [Fix B1]

```typescript
// lib/renderer/webgl/capabilities.ts
// [W-FINAL-1] Einziger Import-Block — kein Duplikat, kein 'client-only'
// isClient() aus utils ist ausreichend (+ OffscreenCanvas-Guard in getDeviceCapabilities)
import { isClient } from '@/lib/utils/is-client';

export interface DeviceCapabilities {
  webgl2:         boolean;
  maxTextureSize: number;
  highPrecision:  boolean;
  isMobile:       boolean;
  tier:           'high' | 'mid' | 'low';
  maxParticles:   number;   // reserviert für Plan 8g
  maxRaySteps:    number;   // reserviert für Plan 8g
}

let cached: DeviceCapabilities | null = null;

export function getDeviceCapabilities(): DeviceCapabilities {
  // [Fix B1+W3] SSR-Guard: isClient() aus utils + OffscreenCanvas-Check
  if (!isClient() || typeof OffscreenCanvas === 'undefined') {
    return { webgl2:false, maxTextureSize:0, highPrecision:false,
             isMobile:false, tier:'low', maxParticles:0, maxRaySteps:0 };
  }
  if (cached) return cached;

  const isMobile = navigator.maxTouchPoints > 1 ||
    /Android|iPhone|iPad/i.test(navigator.userAgent);

  const testCanvas = new OffscreenCanvas(1, 1);
  const gl = testCanvas.getContext('webgl2') as WebGL2RenderingContext | null;

  if (!gl) {
    cached = { webgl2:false, maxTextureSize:0, highPrecision:false,
               isMobile, tier:'low', maxParticles:0, maxRaySteps:0 };
    return cached;
  }

  const maxTex  = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const precFmt = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const highPrc = precFmt !== null && precFmt.precision > 0;

  const tier: DeviceCapabilities['tier'] =
    (!isMobile && maxTex >= 16384) ? 'high' :
    (maxTex >= 8192 || (!isMobile && maxTex >= 4096)) ? 'mid' : 'low';

  cached = {
    webgl2: true, maxTextureSize: maxTex, highPrecision: highPrc,
    isMobile, tier,
    maxParticles: tier === 'high' ? 500 : tier === 'mid' ? 200 : 80,
    maxRaySteps:  tier === 'high' ? 64  : tier === 'mid' ? 32  : 16,
  };
  return cached;
}

// Test-Seam
export function _overrideCapabilities(c: DeviceCapabilities): void { cached = c; }
export function _resetCapabilities(): void { cached = null; }
```

---

## Modul 2 — quality.ts [Fix B2, W3, W6]

```typescript
// lib/renderer/webgl/quality.ts

export type QualityScale = 1.0 | 0.75 | 0.5;
const LEVELS: QualityScale[]  = [1.0, 0.75, 0.5];
const FPS_WINDOW     = 30;
const DOWN_FPS       = 45;
const UP_FPS         = 55;
const FRAMES_DOWN    = 20;
const FRAMES_UP      = 60;   // [W6] Asymmetrie: 3× mehr für Scale-Up

export interface QualityState {
  scale:      QualityScale;
  userPinned: boolean;
  avgFps:     number;
  tier:       DeviceCapabilities['tier'];
  offline:    boolean;
}

class QualityManager {
  private hist:        number[] = [];
  private lastMs       = 0;
  private below        = 0;
  private above        = 0;
  private idx          = 0;
  private _pinned      = false;
  private _offline     = false;  // [Fix B2]

  // Aufgerufen aus loop.ts bei jedem Live-Preview-Frame
  recordFrame(nowMs: number): void {
    if (this._offline) return;  // [Fix B2] Export-Pfad: kein Scaling
    if (this.lastMs > 0) {
      const fps = 1000 / (nowMs - this.lastMs);
      this.hist.push(fps);
      if (this.hist.length > FPS_WINDOW) this.hist.shift();
    }
    this.lastMs = nowMs;
    if (!this._pinned) this.adjust();
  }

  // [Fix B2] Offline-Export: Quality-Scaling einfrieren auf 1.0
  setOffline(offline: boolean): void {
    this._offline = offline;
    if (offline) { this.idx = 0; this.below = 0; this.above = 0; }
  }

  get scale(): QualityScale { return (this._pinned || this._offline) ? 1.0 : LEVELS[this.idx]; }
  get avgFps(): number {
    if (!this.hist.length) return 60;
    return this.hist.reduce((a, b) => a + b) / this.hist.length;
  }

  // [Fix W3] pinToMax: beide Seiten des Store-<->Manager-Bindings hier
  pinToMax(pin: boolean): void {
    this._pinned = pin;
    if (pin) { this.idx = 0; this.below = 0; }
    // Store-Persistierung: Caller schreibt in localStorage ('vg_quality_pinned')
    // Bewusste Entscheidung: kein Zustand im Redux-Store (vermeidet STORE_VERSION-Bump)
  }

  getState(): QualityState {
    return { scale: this.scale, userPinned: this._pinned,
             avgFps: Math.round(this.avgFps), tier: getDeviceCapabilities().tier,
             offline: this._offline };
  }

  // [W6] Erste FPS_WINDOW Frames: kein Scaling — absichtlich, dokumentiert
  private adjust(): void {
    if (this.hist.length < FPS_WINDOW) return;
    const avg = this.avgFps;
    if (avg < DOWN_FPS) {
      this.above = 0;
      if (++this.below >= FRAMES_DOWN && this.idx < LEVELS.length - 1) {
        this.idx++; this.below = 0;
        console.info(`[VibeGrid] WebGL quality → ${LEVELS[this.idx]}× (FPS ${avg.toFixed(0)})`);
      }
    } else if (avg > UP_FPS) {
      this.below = 0;
      if (++this.above >= FRAMES_UP && this.idx > 0) {
        this.idx--; this.above = 0;
        console.info(`[VibeGrid] WebGL quality → ${LEVELS[this.idx]}× (FPS ${avg.toFixed(0)})`);
      }
    } else { this.below = 0; this.above = 0; }
  }
}

export const qualityManager = new QualityManager();
```

**Integration in Renderer-Loop (MODIFY):**
```typescript
// lib/renderer/loop.ts
import { qualityManager } from '@/lib/renderer/webgl/quality';
// In RAF-Callback:
qualityManager.recordFrame(performance.now());

// lib/export/offline-render.ts
import { qualityManager } from '@/lib/renderer/webgl/quality';
// [Fix W1] try/finally: verhindert _offline=true stuck bei Export-Fehler
qualityManager.setOffline(true);
try {
  // ... Export-Logik ...
} finally {
  qualityManager.setOffline(false);
}
```

**[Fix W3] qualityPinned localStorage-Anbindung:**
```typescript
// components/Workspace/QualityIndicator.tsx (beim Mount):
useEffect(() => {
  const pinned = localStorage.getItem('vg_quality_pinned') === 'true';
  qualityManager.pinToMax(pinned);
}, []);

// On Toggle:
const handlePin = (pin: boolean) => {
  qualityManager.pinToMax(pin);
  localStorage.setItem('vg_quality_pinned', String(pin));
};
```

---

## Modul 3 — context.ts [B-FINAL-1: eine kanonische Implementierung]

```typescript
// lib/renderer/webgl/context.ts

interface ProgramLocations {
  attribs: { a_position: number; a_texCoord: number };
  uniforms: Map<string, WebGLUniformLocation | null>;
}

export interface GlContext {
  canvas:    OffscreenCanvas;
  gl:        WebGL2RenderingContext;
  lost:      boolean;
  scale:     QualityScale;
  locations: WeakMap<WebGLProgram, ProgramLocations>;
}

const contextByClip = new Map<string, GlContext>();

// [Fix B2] Test-Seam ZUERST deklariert
type GlContextFactory = (clipId: string, w: number, h: number) => GlContext | null;
let _factory: GlContextFactory | null = null;
export function _overrideContextFactory(f: GlContextFactory | null): void { _factory = f; }

// EINE kanonische Implementierung [Fix B-FINAL-1]
export function getGlContext(clipId: string, w: number, h: number): GlContext | null {
  // [Fix B2] Factory-Check ZUERST — verhindert OffscreenCanvas-Zugriff in jsdom
  if (_factory) {
    const r = _factory(clipId, w, h);
    if (r) contextByClip.set(clipId, r);
    return r ?? null;
  }

  const caps  = getDeviceCapabilities();
  if (!caps.webgl2) return null;

  const scale = qualityManager.scale;
  const safeW = Math.min(Math.ceil(w * scale), caps.maxTextureSize);
  const safeH = Math.min(Math.ceil(h * scale), caps.maxTextureSize);

  const ex = contextByClip.get(clipId);
  if (ex && !ex.lost && ex.canvas.width === safeW && ex.canvas.height === safeH) return ex;
  if (ex) disposeContext(clipId);

  const canvas = new OffscreenCanvas(safeW, safeH);
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
  if (!gl) return null;

  canvas.addEventListener('webglcontextlost',     (e) => {
    e.preventDefault();
    const c = contextByClip.get(clipId);
    if (c) c.lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => { contextByClip.delete(clipId); });

  const ctx: GlContext = { canvas, gl, lost: false, scale, locations: new WeakMap() };
  contextByClip.set(clipId, ctx);
  return ctx;
}

export function disposeContext(clipId: string): void {
  const ctx = contextByClip.get(clipId);
  if (!ctx) return;
  ctx.gl.getExtension('WEBGL_lose_context')?.loseContext();
  contextByClip.delete(clipId);
}
export function disposeAllContexts(): void {
  for (const id of [...contextByClip.keys()]) disposeContext(id);
}
```

**[Fix B1+D-FINAL-2] React-Hook + konkreter Mount-Punkt:**

```typescript
// lib/hooks/useWebGLClipCleanup.ts  [Fix W-FINAL-2: lib/hooks/ nicht hooks/]
import { disposeContext, disposeAllContexts } from '@/lib/renderer/webgl/context';
import { useEffect, useRef } from 'react';

export function useWebGLClipCleanup(clipIds: string[]): void {
  const prevRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const curr = new Set(clipIds);
    for (const id of prevRef.current) {
      if (!curr.has(id)) disposeContext(id);
    }
    prevRef.current = curr;
  }, [clipIds]);
  useEffect(() => () => { disposeAllContexts(); }, []);
}
```

**Mount-Punkt [Fix D-FINAL-2]:** `components/Workspace/Timeline/Tracks.tsx` —
die Komponente die alle Clips aller Tracks rendert und daher jeden Clip-Lifecycle sieht.
File-Map-Eintrag: `components/Workspace/Timeline/Tracks.tsx | MODIFY — useWebGLClipCleanup`.

```typescript
// In Tracks.tsx:
const clipIds = useAppStore(s => s.timeline.clips.map(c => c.id));
useWebGLClipCleanup(clipIds);
```

---

## [Fix B-FINAL-2] WebGL Mock-Skeleton

```typescript
// tests/setup/webgl-mock.ts  (CREATE, ~150 LOC)

import { vi } from 'vitest';
import { _overrideContextFactory } from '@/lib/renderer/webgl/context';
import type { GlContext } from '@/lib/renderer/webgl/context';

// GL-Konstanten (alle in pipeline.ts + shader.ts + texture.ts genutzten)
const C = {
  TEXTURE_2D: 0x0DE1, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
  TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
  TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
  CLAMP_TO_EDGE: 0x812F, LINEAR: 0x2601,
  VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30,
  ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88B4,
  COLOR_BUFFER_BIT: 0x4000, TRIANGLE_STRIP: 0x0005,
  COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82,
  FLOAT: 0x1406, UNPACK_FLIP_Y_WEBGL: 0x9240,
  MAX_TEXTURE_SIZE: 0x0D33, HIGH_FLOAT: 0x8DF2,
};

export function createMockGL(): WebGL2RenderingContext {
  return {
    ...C,
    // Textures
    createTexture:  vi.fn(() => ({})),
    bindTexture:    vi.fn(),
    texParameteri:  vi.fn(),
    texImage2D:     vi.fn(),
    texSubImage2D:  vi.fn(),
    pixelStorei:    vi.fn(),
    activeTexture:  vi.fn(),
    // Buffers
    createBuffer:   vi.fn(() => ({})),
    bindBuffer:     vi.fn(),
    bufferData:     vi.fn(),
    // Shaders
    createShader:   vi.fn(() => ({})),
    shaderSource:   vi.fn(),
    compileShader:  vi.fn(),
    getShaderParameter:  vi.fn(() => true),   // COMPILE_STATUS ok
    getShaderInfoLog:    vi.fn(() => ''),
    deleteShader:        vi.fn(),
    // Programs
    createProgram:  vi.fn(() => ({})),
    attachShader:   vi.fn(),
    linkProgram:    vi.fn(),
    getProgramParameter: vi.fn(() => true),   // LINK_STATUS ok
    getProgramInfoLog:   vi.fn(() => ''),
    useProgram:     vi.fn(),
    // Attributes + Uniforms
    getAttribLocation:    vi.fn(() => 0),
    getUniformLocation:   vi.fn(() => ({})),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer:  vi.fn(),
    uniform1i:   vi.fn(), uniform1f:  vi.fn(),
    uniform2f:   vi.fn(), uniform2fv: vi.fn(),
    uniform4f:   vi.fn(), uniform4fv: vi.fn(),
    // Render
    viewport:    vi.fn(), clearColor: vi.fn(), clear: vi.fn(),
    drawArrays:  vi.fn(),
    // Misc
    getExtension: vi.fn(() => ({ loseContext: vi.fn() })),
    getParameter: vi.fn((p: number) =>
      p === C.MAX_TEXTURE_SIZE ? 4096 : 0),
    getShaderPrecisionFormat: vi.fn(() =>
      ({ precision: 23, rangeMin: 127, rangeMax: 127 })),
  } as unknown as WebGL2RenderingContext;
}

export function setupWebGLMock(): WebGL2RenderingContext {
  const gl = createMockGL();
  _overrideContextFactory((_clipId, w, h) => ({
    canvas:    { width: w, height: h } as OffscreenCanvas,
    gl,
    lost:      false,
    scale:     1.0,
    locations: new WeakMap(),
  } as GlContext));
  return gl;
}

export function teardownWebGLMock(): void {
  _overrideContextFactory(null);
}
```

---

## Modul 4 — shader.ts [W4 Location-Cache]

```typescript
// lib/renderer/webgl/shader.ts

export const VERT_SRC = `#version 300 es
in vec2 a_position; in vec2 a_texCoord; out vec2 v_texCoord;
void main(){ gl_Position=vec4(a_position,0.,1.); v_texCoord=a_texCoord; }`;

// Program-Cache: per GL-Context
const programCache = new WeakMap<WebGL2RenderingContext, Map<string, WebGLProgram>>();

export function getOrCompileProgram(gl: WebGL2RenderingContext, fragSrc: string): WebGLProgram {
  const caps    = getDeviceCapabilities();
  const adapted = caps.highPrecision ? fragSrc
    : fragSrc.replace(/precision highp/g, 'precision mediump');

  let map = programCache.get(gl);
  if (!map) { map = new Map(); programCache.set(gl, map); }
  const cached = map.get(adapted);
  if (cached) return cached;

  const prog = link(gl, compile(gl, gl.VERTEX_SHADER, VERT_SRC),
                        compile(gl, gl.FRAGMENT_SHADER, adapted));
  map.set(adapted, prog);
  return prog;
}

// [Fix W4] Locations cachen — einmalig nach Link, pro Program
export function getLocations(
  gl: WebGL2RenderingContext,
  prog: WebGLProgram,
  cache: WeakMap<WebGLProgram, ProgramLocations>,
  uniformNames: string[]
): ProgramLocations {
  const hit = cache.get(prog);
  if (hit) return hit;
  const locs: ProgramLocations = {
    attribs: {
      a_position: gl.getAttribLocation(prog, 'a_position'),
      a_texCoord: gl.getAttribLocation(prog, 'a_texCoord'),
    },
    uniforms: new Map(uniformNames.map(n => [n, gl.getUniformLocation(prog, n)])),
  };
  cache.set(prog, locs);
  return locs;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(`[WebGL Shader] ${gl.getShaderInfoLog(s)}\n${src}`);
  return s;
}
function link(gl: WebGL2RenderingContext, v: WebGLShader, f: WebGLShader): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p,v); gl.attachShader(p,f); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(`[WebGL Link] ${gl.getProgramInfoLog(p)}`);
  gl.deleteShader(v); gl.deleteShader(f);
  return p;
}
```

---

## Modul 5 — texture.ts [Fix B3]

```typescript
// lib/renderer/webgl/texture.ts

// [Fix B3] Vollständige Spec:
// Ein Texture-Slot pro GL-Context, wird per texSubImage2D aktualisiert.
// texSubImage2D statt texImage2D: kein GPU-Realloc pro Frame (~3–5 ms gespart bei 4K).
// UNPACK_FLIP_Y: false — GLSL y-Achse = oben-links, ImageBitmap = oben-links: übereinstimmend.
// ImageBitmap aus captureVideoFrame ist synchron consumed (WebGL2-Spec §4.1): kein Race.

interface TextureEntry { tex: WebGLTexture; width: number; height: number; }
const textureByCtx = new WeakMap<WebGL2RenderingContext, TextureEntry>();

export function uploadImageBitmap(
  gl: WebGL2RenderingContext,
  bm: ImageBitmap
): WebGLTexture {
  let entry = textureByCtx.get(gl);

  if (!entry) {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Alloc mit leeren Daten in Bitmap-Größe
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, bm.width, bm.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    entry = { tex, width: bm.width, height: bm.height };
    textureByCtx.set(gl, entry);
  }

  gl.bindTexture(gl.TEXTURE_2D, entry.tex);

  if (entry.width !== bm.width || entry.height !== bm.height) {
    // Größe geändert (z.B. nach Export-Auflösungs-Wechsel) → neu allozieren
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, bm.width, bm.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    entry.width  = bm.width;
    entry.height = bm.height;
  }

  // [Fix B3] texSubImage2D: update ohne Realloc
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bm);
  return entry.tex;
}
```

---

## Modul 6 — quad.ts [Doc 1]

```typescript
// lib/renderer/webgl/quad.ts
// Einheits-Quad: 2 Dreiecke (TRIANGLE_STRIP), 4 Vertices
// Layout: [x, y, u, v] — 4 floats × 4 bytes = 16 Bytes/Vertex
// Koordinaten: clip-space (-1..1) × tex-space (0..1)
// Singleton pro GL-Context via WeakMap

const quadByCtx = new WeakMap<WebGL2RenderingContext, WebGLBuffer>();

export function getQuadBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const hit = quadByCtx.get(gl);
  if (hit) return hit;

  const data = new Float32Array([
  //   x      y     u    v
    -1.0, -1.0,   0.0, 0.0,   // unten-links
     1.0, -1.0,   1.0, 0.0,   // unten-rechts
    -1.0,  1.0,   0.0, 1.0,   // oben-links
     1.0,  1.0,   1.0, 1.0,   // oben-rechts
  ]);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  quadByCtx.set(gl, buf);
  return buf;
}
```

---

## Modul 7 — pipeline.ts [W4 + W1]

```typescript
// lib/renderer/webgl/pipeline.ts
// [Fix W1] u_max_iterations ENTFERNT — wird in Plan 8g mit ersten echten Konsumenten eingeführt

export type Uniforms = Record<string, number | readonly [number,number] | readonly [number,number,number,number]>;
export type UniformNames = readonly string[];  // pro Program: alle erwarteten Uniform-Namen

export function renderGlFx(args: {
  rc:           RenderContext;
  fragSrc:      string;
  uniforms:     Uniforms;
  uniformNames: UniformNames;   // für Location-Cache-Seed
}): void {
  const { rc, fragSrc, uniforms, uniformNames } = args;
  if (!rc.imageBitmap) return;

  const caps = getDeviceCapabilities();
  if (!caps.webgl2) return;  // [Doc 3] FX übersprungen — Plugin.preloadState='error' → Inspector-Warning

  const glCtx = getGlContext(rc.clipId, rc.width, rc.height);
  if (!glCtx) return;

  const { gl, canvas, locations } = glCtx;
  const { sx, sy, sw, sh } = containRect(rc);

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const prog = getOrCompileProgram(gl, fragSrc);
  gl.useProgram(prog);

  // [Fix W4] Locations gecacht — kein getAttribLocation per Frame
  // [Fix W-FINAL-4] as const + Spread = No-Op → einfach string[]
  const allUniformNames = ['u_image', 'u_contain', 'u_resolution', ...uniformNames];
  const locs = getLocations(gl, prog, locations, allUniformNames);

  // Quad-Setup
  const buf    = getQuadBuffer(gl);
  const stride = 16;  // 4 floats × 4 bytes
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(locs.attribs.a_position);
  gl.vertexAttribPointer(locs.attribs.a_position, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(locs.attribs.a_texCoord);
  gl.vertexAttribPointer(locs.attribs.a_texCoord, 2, gl.FLOAT, false, stride, 8);

  // Standard-Uniforms
  uploadImageBitmap(gl, rc.imageBitmap);
  gl.uniform1i(locs.uniforms.get('u_image')!, 0);
  gl.uniform4f(locs.uniforms.get('u_contain')!,
    sx/rc.width, sy/rc.height, sw/rc.width, sh/rc.height);
  gl.uniform2f(locs.uniforms.get('u_resolution')!, canvas.width, canvas.height);

  // FX-Uniforms
  for (const [name, val] of Object.entries(uniforms)) {
    const loc = locs.uniforms.get(name);
    if (!loc) continue;
    if (typeof val === 'number')  gl.uniform1f(loc, val);
    else if (val.length === 2)    gl.uniform2fv(loc, val);
    else if (val.length === 4)    gl.uniform4fv(loc, val);
  }

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // [Fix W5] KNOWN_LIMITATIONS: drawImage ~8MB/Frame bei 1080p, ~32MB bei 4K
  rc.ctx.drawImage(canvas, 0, 0, rc.width, rc.height);
}
```

---

## ColorGradeShift Plugin + vollständiges paramSchema [Doc 4, W2]

```typescript
// lib/fx/color-grade-shift.ts

// [Fix W2] Explizit: preloadState wird in preload() mutiert.
// FxPlugin<P> hat preloadState: PreloadState (NICHT readonly).
// Kein bestehendes Plugin tut das — dieser FX ist der erste.

export const colorGradeShiftPlugin: FxPlugin<ColorGradeShiftParams> = {
  id:             'color-grade-shift',
  name:           'Color Grade',
  kind:           'ColorGradeShift',
  defaultTrigger: 'beat',
  preloadState:   'loading',  // wird in preload() überschrieben
  paramSchema: {
    saturation: { kind:'slider', label:'Saturation', min:1.0, max:4.0, step:0.1,  default:2.0 },
    contrast:   { kind:'slider', label:'Contrast',   min:1.0, max:2.0, step:0.05, default:1.3 },
    brightness: { kind:'slider', label:'Brightness', min:0.7, max:1.5, step:0.05, default:1.1 },
    hueShift:   { kind:'slider', label:'Hue Shift',  min:-180,max:180, step:1,    default:0   },
    decay:      { kind:'slider', label:'Decay',      min:0.01,max:0.5, step:0.01, default:0.25 },
  },
  getDefaultParams: () => ({
    saturation:2.0, contrast:1.3, brightness:1.1, hueShift:0, decay:0.25
  }),

  async preload() {
    // [Fix W2] Mutation erlaubt, kein readonly
    const test = new OffscreenCanvas(1,1);
    const gl   = test.getContext('webgl2');
    this.preloadState = gl ? 'ready' : 'error';
    // [Doc 3] preloadState='error' → Inspector zeigt:
    // "WebGL2 not available. Update to Safari 17+ or Chrome 69+"
  },

  render(rc, params) {
    if (!rc.imageBitmap)  return;
    if (rc.flowMode)      return;
    const env = Math.max(0, 1 - rc.beatPhase / params.decay);
    if (env < 0.01)       return;

    renderGlFx({
      rc,
      fragSrc: COLOR_GRADE_FRAG_SRC,
      uniformNames: ['u_saturation','u_contrast','u_brightness','u_hue_shift','u_env'],
      uniforms: {
        u_saturation: params.saturation,
        u_contrast:   params.contrast,
        u_brightness: params.brightness,
        u_hue_shift:  params.hueShift,
        u_env:        env,
      },
    });
  },

  // [Fix B1] dispose() hat keine Args (Interface-Constraint).
  // Cleanup via useWebGLClipCleanup Hook — siehe Modul 3.
  dispose() { /* Hook übernimmt cleanup — hier nichts nötig */ },
};
```

**GLSL ColorGradeShift** — identisch mit Rev. 2 (korrekt, keine Änderung nötig).

---

## Integration-Checkliste (8 Stellen, nicht 7) [Doc 8]

```
1. lib/fx/color-grade-shift.ts                CREATE
2. lib/fx/index.ts                            MODIFY — register()
3. lib/renderer/types.ts                      MODIFY — FxKind | 'ColorGradeShift'  ← Stelle 8
4. lib/timeline/plugin-mapping.ts             MODIFY — 7 Stellen:
   4a. TRACK_FX_KINDS.add('color-grade-shift')
   4b. PluginFxKind | 'ColorGradeShift'
   4c. RENDER_ORDER_TRACK_KIND
   4d. FX_DISPLAY_NAME
   4e. FX_CLIP_COLORS
   4f. PLUGIN_KIND_TO_TRACK_KIND['ColorGradeShift'] = 'color-grade-shift'
   4g. TRACK_KIND_TO_PLUGIN_KIND['color-grade-shift'] = 'ColorGradeShift'
5. lib/renderer/loop.ts                       MODIFY — qualityManager.recordFrame()
6. lib/export/offline-render.ts               MODIFY — setOffline(true/false) + try/finally
7. tests/                                     CREATE

**Stellen-Zähler [Fix W-FINAL-3]:** einheitlich "7 Stellen in plugin-mapping.ts + 1 Stelle in types.ts = 8 Gesamt".
```

---

## File Map

| Datei | Aktion |
|---|---|
| `lib/renderer/webgl/capabilities.ts` | CREATE — isClient() SSR-guard, kein Duplikat |
| `lib/renderer/webgl/quality.ts` | CREATE — FPS-Wächter + offline-flag |
| `lib/renderer/webgl/context.ts` | CREATE — eine kanonische Impl. + Factory-Seam |
| `lib/renderer/webgl/shader.ts` | CREATE — Precision-Adapt + Location-Cache |
| `lib/renderer/webgl/texture.ts` | CREATE — texSubImage2D + Reuse |
| `lib/renderer/webgl/quad.ts` | CREATE — Einheits-Quad |
| `lib/renderer/webgl/pipeline.ts` | CREATE |
| `lib/renderer/webgl/programs/color-grade.ts` | CREATE — GLSL |
| `lib/fx/color-grade-shift.ts` | CREATE |
| `lib/fx/index.ts` | MODIFY |
| `lib/renderer/types.ts` | MODIFY — FxKind (Stelle 8 von 8) |
| `lib/renderer/loop.ts` | MODIFY — recordFrame |
| `lib/export/offline-render.ts` | MODIFY — setOffline + try/finally |
| `lib/timeline/plugin-mapping.ts` | MODIFY — 7 Stellen (4a–4g) |
| `lib/hooks/useWebGLClipCleanup.ts` | CREATE — per-Clip dispose [Fix W-FINAL-2: lib/hooks/] |
| `components/Workspace/Timeline/Tracks.tsx` | MODIFY — useWebGLClipCleanup einhängen [Fix D-FINAL-2] |
| `components/Workspace/QualityIndicator.tsx` | CREATE — FPS + Scale + Pin |
| `components/Workspace/WorkspaceHeader.tsx` | MODIFY — QualityIndicator einhängen |
| `components/Inspector/` | MODIFY — preloadState='error' Banner |
| `tests/setup/webgl-mock.ts` | CREATE — Mock-GL-Skeleton (vollständig im Plan) |
| `docs/KNOWN_LIMITATIONS.md` | MODIFY |

---

## Tests + Mocking [Fix B-FINAL-2 vollständig]

**Mock-GL-Skeleton** — vollständiger Code im Abschnitt "WebGL Mock-Skeleton" oben.
`createMockGL()` liefert alle 35+ Methoden + Konstanten die pipeline.ts/shader.ts/texture.ts nutzen.

**[Fix D4] `_resetCapabilities()` in jedem Test-beforeEach:**
```typescript
import { setupWebGLMock, teardownWebGLMock } from '../../setup/webgl-mock';
import { _resetCapabilities } from '@/lib/renderer/webgl/capabilities';

beforeEach(() => {
  _resetCapabilities();   // Caps-Cache leeren
  setupWebGLMock();
});
afterEach(() => teardownWebGLMock());
```

`tests/unit/webgl/capabilities.test.ts` — ≥ 5:
- SSR-Guard: `isClient()=false` → webgl2=false, kein OffscreenCanvas-Aufruf
- `tier='high'` bei maxTex≥16384 + !isMobile
- `tier='low'` bei maxTex=4096 + isMobile=true
- Cache: zweiter Aufruf gibt selbes Objekt zurück
- `_resetCapabilities()` → nächster Aufruf detektiert neu

`tests/unit/webgl/quality.test.ts` — ≥ 7:
- 20 Frames unter 45 FPS → scale 1.0→0.75
- Hysterese: 19 Frames → kein Change
- 60 Frames über 55 FPS → scale-up
- `setOffline(true)` → recordFrame tut nichts, scale bleibt 1.0
- `setOffline(true)` + Export → scale=1.0 erzwungen
- `pinToMax(true)` → scale immer 1.0 egal FPS
- `setOffline(false)` nach Export → Scaling wieder aktiv

`tests/unit/webgl/texture.test.ts` — ≥ 3:
- Erster Upload: texImage2D aufgerufen (Alloc)
- Zweiter Upload gleiche Größe: texSubImage2D aufgerufen (kein Realloc)
- Größe geändert: texImage2D wieder aufgerufen

`tests/unit/webgl/shader.test.ts` — ≥ 3:
- Program kompiliert ohne Fehler (COLOR_GRADE_FRAG_SRC)
- Cache-Hit: zweiter Aufruf = selbes Objekt
- `highPrecision=false` → adapted Src enthält 'mediump' statt 'highp'

`tests/unit/fx/color-grade-shift.test.ts` — ≥ 5:
- `env=0` → renderGlFx nicht aufgerufen
- `flowMode=true` → renderGlFx nicht aufgerufen
- `preload()` + WebGL2 verfügbar → preloadState='ready' [Fix W2]
- `preload()` + kein WebGL2 → preloadState='error'
- Alle 5 Uniforms in renderGlFx-Aufruf enthalten

Mindest: **≥ 23 neue Tests**

---

## Verification Gate

Baseline: **1170 Tests**.
Ziel: **≥ 1193**.

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Manuelle Smoke-Tests:**
```
# QualityIndicator: 'HIGH · 60 FPS · 1.0×' auf Desktop Chrome
# CPU-Throttling 6×: nach 20 Frames scale → 0.75, QualityIndicator orange
# Unthrottle: nach 60 Frames scale → 1.0 zurück
# "Pin to Maximum" Toggle → kein Scale-Down bei Throttling
# Pin überlebt Page-Reload (localStorage)
# ColorGradeShift: hueShift=180 → Farbumkehr auf Beat
# WebM-Export mit ColorGradeShift: kein Scale-Change während Export
# Context-Loss via WEBGL_lose_context.loseContext() (nicht DevTools!):
#   → FX recovered nächsten Frame [Doc 7]
# Next.js Build ohne WebGL-Error auf Server (SSR-Guard [Fix B1])
# Low-Tier Simulation (_overrideCapabilities): 'LOW' Badge im QualityIndicator
```

---

## KNOWN_LIMITATIONS — neue Einträge

```
WebGL2 Requirement: Safari 17+ (Sept 2023), Chrome 69+, Firefox 105+.
Older Safari: ColorGradeShift + RetroVHS (Plan 8f.2) are skipped silently.
Inspector shows "WebGL2 not available" warning.

drawImage Bandwidth: WebGL result composited via drawImage() per frame.
At 1080p: ~8 MB/frame. At 4K: ~32 MB/frame. On thermal-limited Mobile,
use quality scale 0.5 (auto) or reduce concurrent WebGL FX.

Quality Scale Warmup: First 30 frames after load, auto-scaling is inactive.
FPS-based adjustment begins after 30-frame baseline window.
```

---

## Commit-Struktur

```
feat(webgl): capabilities — SSR-safe Device-Check + Tier
feat(webgl): quality — FPS-Wächter + offline-flag + pin-to-max
feat(webgl): context — per-Clip Context + Location-Cache + Test-Seam
feat(webgl): shader — Compile + Cache + Precision-Adapt
feat(webgl): texture — texSubImage2D Reuse + FLIP_Y
feat(webgl): quad — Einheits-Quad-Buffer
feat(webgl): pipeline — renderGlFx ohne u_max_iterations
feat(webgl): programs/color-grade — GLSL
feat(fx): color-grade-shift — preloadState-Mutation + preload()-Check
feat(renderer): loop — qualityManager.recordFrame()
feat(export): offline-render — qualityManager.setOffline()
feat(ui): QualityIndicator — FPS + Scale + Tier + Pin-Toggle
feat(fx): types + registry + plugin-mapping — 8 Stellen
docs(limitations): WebGL2 + bandwidth + warmup
test: capabilities + quality + texture + shader + color-grade-shift
```

---

## Out of Scope → Plan 8f.2

RetroVHS FX (baut auf dieser stabilen Infrastruktur auf).
Kein neuer Architektur-Aufwand — ein FX + GLSL + Tests.

Abgabe: `vibegrid-plan-8f1-webgl-foundation.md`
