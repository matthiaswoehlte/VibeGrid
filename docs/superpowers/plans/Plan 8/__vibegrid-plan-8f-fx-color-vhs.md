# CC #1 Prompt — Plan 8f: WebGL2-Renderer + Dynamic Quality Management + ColorGradeShift + RetroVHS

**Einmal richtig bauen — für Desktop und Mobile.**
WebGL2-Renderer mit Device-Capabilities-Check, FPS-basiertem Auto-Scaling,
Smart-Asset-Management und User-Override. ColorGradeShift + RetroVHS als
erste WebGL2-FX. Alle zukünftigen FX (Particles, Sunray-Rebuild, Bloom)
erben die gesamte Infrastruktur automatisch.

Baseline: HEAD post-Plan-8e.

---

## Schritt 0 — Codebase lesen (PFLICHT)

1. `lib/fx/zoom-pulse.ts` + `lib/fx/glitch-slice.ts` — containRect, imageBitmap-Guard,
   module-scope Map mit rc.clipId, dispose()
2. `lib/renderer/loop.ts` — wo wird der Render-Tick ausgelöst? Was ist der genaue
   Aufrufpunkt für FX-render()? `performance.now()` verfügbar?
3. `lib/renderer/types.ts` — RenderContext komplett, FxPlugin<P>
4. `lib/timeline/plugin-mapping.ts` — RENDER_ORDER + alle 5 Maps (aktueller Stand)
5. `lib/store/` — wie werden User-Preferences heute persistiert?
   (für Quality-Override-Setting)
6. `lib/utils/prng.ts` — mulberry32
7. Aktuelle Test-Zahl

---

## Architektur: lib/renderer/webgl/

```
lib/renderer/webgl/
  capabilities.ts   — Device-Check (einmalig beim Start)
  quality.ts        — FPS-Wächter + Auto-Scaling-Manager
  context.ts        — WebGL2-Context pro Clip (nutzt capabilities + quality)
  shader.ts         — GLSL kompilieren + cachen + Precision-Adaptation
  texture.ts        — ImageBitmap → Texture
  quad.ts           — Einheits-Quad-Buffer
  pipeline.ts       — renderGlFx() — die einzige API die FX aufrufen
  programs/
    color-grade.ts  — GLSL + Uniform-Types für ColorGradeShift
    retro-vhs.ts    — GLSL + Uniform-Types für RetroVHS
```

---

## Modul 1 — capabilities.ts

**Einmalig beim App-Start**, Ergebnis gecacht. Alles andere baut darauf auf.

```typescript
// lib/renderer/webgl/capabilities.ts

export interface DeviceCapabilities {
  webgl2:         boolean;
  maxTextureSize: number;        // GPU-Limit: 4096 auf altem Mobile, 16384+ Desktop
  highPrecision:  boolean;       // fragment shader highp support
  isMobile:       boolean;       // touch-basierte Heuristik
  tier:           'high' | 'mid' | 'low';
  // Abgeleitete Asset-Limits (für Smart Asset Management):
  maxParticles:   number;        // Particles-FX in Plan 8g
  maxRaySteps:    number;        // Sunray-Rebuild, Bloom in Plan 8g
  maxTextWidth:   number;        // TextFX WebGL-Upgrade
}

let cached: DeviceCapabilities | null = null;

export function getDeviceCapabilities(): DeviceCapabilities {
  if (cached) return cached;

  // Mobile-Heuristik: maxTouchPoints zuverlässiger als User-Agent
  const isMobile =
    navigator.maxTouchPoints > 1 ||
    /Android|iPhone|iPad/i.test(navigator.userAgent);

  // WebGL2-Test auf minimalem OffscreenCanvas
  const testCanvas = new OffscreenCanvas(1, 1);
  const gl = testCanvas.getContext('webgl2') as WebGL2RenderingContext | null;

  if (!gl) {
    cached = {
      webgl2: false, maxTextureSize: 0, highPrecision: false,
      isMobile, tier: 'low',
      maxParticles: 0, maxRaySteps: 0, maxTextWidth: 0,
    };
    return cached;
  }

  const maxTex  = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const precFmt = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const highPrc = precFmt !== null && precFmt.precision > 0;

  // Tier-Klassifikation
  let tier: DeviceCapabilities['tier'];
  if (!isMobile && maxTex >= 16384) {
    tier = 'high';   // Desktop-GPU, modernes MacBook+
  } else if (maxTex >= 8192 || (!isMobile && maxTex >= 4096)) {
    tier = 'mid';    // modernes Mobile (iPhone 14+, Pixel 7+) oder Mid-Desktop
  } else {
    tier = 'low';    // altes Mobile, Budget-Android
  }

  cached = {
    webgl2: true,
    maxTextureSize: maxTex,
    highPrecision:  highPrc,
    isMobile,
    tier,
    maxParticles: tier === 'high' ? 500 : tier === 'mid' ? 200 : 80,
    maxRaySteps:  tier === 'high' ? 64  : tier === 'mid' ? 32  : 16,
    maxTextWidth: tier === 'high' ? 2048 : tier === 'mid' ? 1024 : 512,
  };

  return cached;
}

// Für Tests: Capabilities überschreiben
export function _overrideCapabilities(c: DeviceCapabilities): void {
  cached = c;
}
```

---

## Modul 2 — quality.ts

**FPS-Wächter mit Hysterese** — verhindert Oszillation + überhitzte Phones.

```typescript
// lib/renderer/webgl/quality.ts

export type QualityScale = 1.0 | 0.75 | 0.5;
const SCALE_LEVELS: QualityScale[] = [1.0, 0.75, 0.5];

const FPS_WINDOW         = 30;   // Frames für Rolling-Average
const DOWN_THRESHOLD     = 45;   // FPS unter diesem Wert → runterskalieren
const UP_THRESHOLD       = 55;   // FPS über diesem Wert → hochskalieren
const FRAMES_TO_DOWN     = 20;   // Frames unter Threshold bis Aktion
const FRAMES_TO_UP       = 60;   // extra Hysterese für Scale-Up (3× mehr)

export interface QualityState {
  scale:        QualityScale;
  userPinned:   boolean;   // User hat "Always Maximum" gewählt
  avgFps:       number;    // für UI-Anzeige
  tier:         DeviceCapabilities['tier'];
}

class QualityManager {
  private fpsHistory:    number[] = [];
  private lastFrameMs  = 0;
  private framesBelow  = 0;
  private framesAbove  = 0;
  private scaleIdx     = 0;
  private userPinned   = false;

  // Aufgerufen aus lib/renderer/loop.ts bei jedem Frame
  recordFrame(nowMs: number): void {
    if (this.lastFrameMs > 0) {
      const fps = 1000 / (nowMs - this.lastFrameMs);
      this.fpsHistory.push(fps);
      if (this.fpsHistory.length > FPS_WINDOW) this.fpsHistory.shift();
    }
    this.lastFrameMs = nowMs;
    if (!this.userPinned) this.adjust();
  }

  get scale(): QualityScale {
    return this.userPinned ? 1.0 : SCALE_LEVELS[this.scaleIdx];
  }

  get avgFps(): number {
    if (this.fpsHistory.length === 0) return 60;
    return this.fpsHistory.reduce((a, b) => a + b) / this.fpsHistory.length;
  }

  // User kann "Always Maximum" pinnen (in Settings gespeichert)
  pinToMax(pin: boolean): void {
    this.userPinned = pin;
    if (pin) { this.scaleIdx = 0; this.framesBelow = 0; }
  }

  getState(): QualityState {
    return {
      scale:      this.scale,
      userPinned: this.userPinned,
      avgFps:     Math.round(this.avgFps),
      tier:       getDeviceCapabilities().tier,
    };
  }

  private adjust(): void {
    if (this.fpsHistory.length < FPS_WINDOW) return;
    const avg = this.avgFps;

    if (avg < DOWN_THRESHOLD) {
      this.framesAbove = 0;
      if (++this.framesBelow >= FRAMES_TO_DOWN &&
          this.scaleIdx < SCALE_LEVELS.length - 1) {
        this.scaleIdx++;
        this.framesBelow = 0;
        console.info(
          `[VibeGrid WebGL] FPS ${avg.toFixed(1)} → quality scale ${SCALE_LEVELS[this.scaleIdx]}`
        );
      }
    } else if (avg > UP_THRESHOLD) {
      this.framesBelow = 0;
      if (++this.framesAbove >= FRAMES_TO_UP && this.scaleIdx > 0) {
        this.scaleIdx--;
        this.framesAbove = 0;
        console.info(
          `[VibeGrid WebGL] FPS ${avg.toFixed(1)} → quality scale ${SCALE_LEVELS[this.scaleIdx]}`
        );
      }
    } else {
      // FPS im grünen Bereich — Zähler zurücksetzen
      this.framesBelow = 0;
      this.framesAbove = 0;
    }
  }
}

export const qualityManager = new QualityManager();
// Singleton — wird in loop.ts + pipeline.ts + UI importiert
```

**Integration in loop.ts:**
```typescript
// lib/renderer/loop.ts MODIFY
import { qualityManager } from '@/lib/renderer/webgl/quality';

// Innerhalb des Render-Ticks (RAF-Callback):
qualityManager.recordFrame(performance.now());
```

---

## Modul 3 — context.ts (mit Capabilities + Quality)

```typescript
// lib/renderer/webgl/context.ts

interface GlContext {
  canvas: OffscreenCanvas;
  gl:     WebGL2RenderingContext;
  lost:   boolean;
  scale:  QualityScale;   // Skala bei der dieser Context erstellt wurde
}

const contextByClip = new Map<string, GlContext>();

export function getGlContext(
  clipId: string,
  width:  number,
  height: number
): GlContext | null {
  const caps    = getDeviceCapabilities();
  if (!caps.webgl2) return null;

  const scale   = qualityManager.scale;
  const scaledW = Math.ceil(width  * scale);
  const scaledH = Math.ceil(height * scale);

  // Größen-Clamp: GPU-Limit respektieren
  const safeW = Math.min(scaledW, caps.maxTextureSize);
  const safeH = Math.min(scaledH, caps.maxTextureSize);

  const existing = contextByClip.get(clipId);
  const needsRebuild =
    !existing ||
    existing.lost ||
    existing.canvas.width  !== safeW ||
    existing.canvas.height !== safeH;

  if (!needsRebuild) return existing!;

  // Alten Context explizit freigeben
  if (existing) disposeContext(clipId);

  const canvas = new OffscreenCanvas(safeW, safeH);
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
  if (!gl) return null;

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    const ctx = contextByClip.get(clipId);
    if (ctx) ctx.lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextByClip.delete(clipId);
  });

  const ctx: GlContext = { canvas, gl, lost: false, scale };
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

---

## Modul 4 — shader.ts (Precision-Adaptation)

```typescript
// lib/renderer/webgl/shader.ts

export const VERTEX_SHADER_SRC = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord  = a_texCoord;
}`;

// WeakMap-Cache: GL-Context → (fragSrc → Program)
const cache = new WeakMap<WebGL2RenderingContext, Map<string, WebGLProgram>>();

export function getOrCompileProgram(
  gl: WebGL2RenderingContext, fragSrc: string
): WebGLProgram {
  // Precision-Adaptation: highp → mediump wenn GPU es nicht unterstützt
  const caps    = getDeviceCapabilities();
  const adapted = caps.highPrecision
    ? fragSrc
    : fragSrc.replace(/precision highp/g, 'precision mediump');

  let map = cache.get(gl);
  if (!map) { map = new Map(); cache.set(gl, map); }

  let prog = map.get(adapted);
  if (prog) return prog;

  const vert = compile(gl, gl.VERTEX_SHADER,   VERTEX_SHADER_SRC);
  const frag = compile(gl, gl.FRAGMENT_SHADER, adapted);
  prog = gl.createProgram()!;
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`[WebGL] Link error: ${gl.getProgramInfoLog(prog)}`);
  }
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  map.set(adapted, prog);
  return prog;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`[WebGL] Shader error: ${gl.getShaderInfoLog(s)}\n---\n${src}`);
  }
  return s;
}
```

---

## Modul 5 — pipeline.ts (Haupt-API)

```typescript
// lib/renderer/webgl/pipeline.ts

export type Uniforms = Record<string, number | [number, number] | [number, number, number, number]>;

export function renderGlFx(args: {
  rc:      RenderContext;
  fragSrc: string;
  uniforms: Uniforms;
}): void {
  const { rc, fragSrc, uniforms } = args;
  if (!rc.imageBitmap) return;

  const caps = getDeviceCapabilities();
  if (!caps.webgl2) return;  // kein Fallback — FX wird übersprungen

  const glCtx = getGlContext(rc.clipId, rc.width, rc.height);
  if (!glCtx) return;

  const { gl, canvas } = glCtx;
  const { sx, sy, sw, sh } = containRect(rc);

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const prog = getOrCompileProgram(gl, fragSrc);
  gl.useProgram(prog);

  // Quad-Buffer Setup
  const buf    = getQuadBuffer(gl);
  const stride = 4 * 4;  // 4 floats × 4 bytes
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  for (const [name, size, offset] of [
    ['a_position', 2, 0] as const,
    ['a_texCoord', 2, 2] as const,
  ]) {
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
  }

  // Standard-Uniforms (alle Shader bekommen diese)
  uploadImageBitmap(gl, rc.imageBitmap);
  gl.uniform1i(gl.getUniformLocation(prog, 'u_image'), 0);
  gl.uniform4f(gl.getUniformLocation(prog, 'u_contain'),
    sx / rc.width, sy / rc.height, sw / rc.width, sh / rc.height);
  gl.uniform2f(gl.getUniformLocation(prog, 'u_resolution'), canvas.width, canvas.height);

  // Smart Asset Management: Device-Limits als Uniforms
  gl.uniform1f(gl.getUniformLocation(prog, 'u_max_iterations'),
    getDeviceCapabilities().maxRaySteps);

  // FX-spezifische Uniforms
  for (const [name, value] of Object.entries(uniforms)) {
    const loc = gl.getUniformLocation(prog, name);
    if (!loc) continue;
    if (typeof value === 'number') gl.uniform1f(loc, value);
    else if (value.length === 2)   gl.uniform2fv(loc, value);
    else if (value.length === 4)   gl.uniform4fv(loc, value);
  }

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Auf Haupt-Canvas compositen (skaliertes Ergebnis → volle Canvas-Größe)
  rc.ctx.drawImage(canvas, 0, 0, rc.width, rc.height);
}
```

---

## GLSL: ColorGradeShift

```glsl
// lib/renderer/webgl/programs/color-grade.ts → COLOR_GRADE_FRAG_SRC

#version 300 es
precision highp float;       /* → 'mediump' auf Low-Tier via shader.ts */

uniform sampler2D u_image;
uniform vec4  u_contain;     /* sx/w, sy/h, sw/w, sh/h */
uniform vec2  u_resolution;
uniform float u_saturation;
uniform float u_contrast;
uniform float u_brightness;
uniform float u_hue_shift;
uniform float u_env;

in  vec2 v_texCoord;
out vec4 fragColor;

vec3 rgb2hsl(vec3 c) {
  float mx=max(max(c.r,c.g),c.b), mn=min(min(c.r,c.g),c.b);
  float l=(mx+mn)*.5;
  if(mx==mn) return vec3(0.,0.,l);
  float d=mx-mn, s=l>.5?d/(2.-mx-mn):d/(mx+mn);
  float h;
  if(mx==c.r)      h=(c.g-c.b)/d+(c.g<c.b?6.:0.);
  else if(mx==c.g) h=(c.b-c.r)/d+2.;
  else             h=(c.r-c.g)/d+4.;
  return vec3(h/6.,s,l);
}
float h2r(float p,float q,float t){
  if(t<0.)t+=1.; if(t>1.)t-=1.;
  if(t<1./6.) return p+(q-p)*6.*t;
  if(t<.5)    return q;
  if(t<2./3.) return p+(q-p)*(2./3.-t)*6.;
  return p;
}
vec3 hsl2rgb(vec3 hsl){
  if(hsl.y==0.) return vec3(hsl.z);
  float q=hsl.z<.5?hsl.z*(1.+hsl.y):hsl.z+hsl.y-hsl.z*hsl.y;
  float p=2.*hsl.z-q;
  return vec3(h2r(p,q,hsl.x+1./3.),h2r(p,q,hsl.x),h2r(p,q,hsl.x-1./3.));
}

void main() {
  vec2 uv    = u_contain.xy + v_texCoord * u_contain.zw;
  vec4 color = texture(u_image, uv);
  vec3 rgb   = color.rgb;

  rgb *= mix(1., u_brightness, u_env);
  rgb  = (rgb-.5)*mix(1.,u_contrast,u_env)+.5;

  float lum = dot(rgb, vec3(.299,.587,.114));
  rgb = mix(vec3(lum), rgb, mix(1.,u_saturation,u_env));

  float hs = u_hue_shift*u_env/360.;
  if(abs(hs)>.001){
    vec3 hsl=rgb2hsl(rgb); hsl.x=fract(hsl.x+hs); rgb=hsl2rgb(hsl);
  }

  fragColor = vec4(clamp(rgb,0.,1.), color.a);
}
```

---

## GLSL: RetroVHS

```glsl
#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform vec4  u_contain;
uniform vec2  u_resolution;
uniform float u_env;
uniform float u_beat_phase;
uniform float u_beat_index;
uniform float u_scanline_opacity;
uniform float u_scanline_spacing;
uniform float u_color_fringe;
uniform float u_dropout_intensity;
uniform float u_dropout_count;
uniform float u_warp_intensity;
uniform float u_seed;
uniform float u_max_iterations;   /* Smart Asset: max Dropout-Iterationen */

in  vec2 v_texCoord;
out vec4 fragColor;

float rand(vec2 co, float s){
  return fract(sin(dot(co+s,vec2(127.1,311.7)))*43758.5453);
}

void main(){
  vec2 uv = u_contain.xy + v_texCoord * u_contain.zw;

  /* Tape Warp */
  float warpX = uv.x + sin(uv.y*40.+u_beat_phase*3.14159)*u_warp_intensity*u_env;
  vec2 wuv = vec2(clamp(warpX,0.,1.), uv.y);

  /* Color Fringe (persistent — läuft auch ohne u_env) */
  vec4 col;
  col.r = texture(u_image, wuv+vec2(u_color_fringe,0.)).r;
  col.g = texture(u_image, wuv).g;
  col.b = texture(u_image, wuv-vec2(u_color_fringe,0.)).b;
  col.a = texture(u_image, wuv).a;

  /* Scanlines (persistent) */
  float lineY  = floor(v_texCoord.y * u_resolution.y);
  float onLine = step(max(u_scanline_spacing-1.,0.), mod(lineY,max(u_scanline_spacing,1.)));
  col.rgb -= onLine * u_scanline_opacity;

  /* Tape Dropout (beat-synchron, Device-Limit via u_max_iterations) */
  float maxD = min(u_dropout_count, u_max_iterations);
  for(float i=0.; i<8.; i++){
    if(i>=maxD) break;
    float dy=rand(vec2(i,.1), u_seed+u_beat_index);
    float dx=rand(vec2(i,.2), u_seed+u_beat_index);
    float dw=rand(vec2(i,.3), u_seed+u_beat_index)*.3+.05;
    float dh=.003;
    float inX=step(dx,v_texCoord.x)*step(v_texCoord.x,dx+dw);
    float inY=step(dy,v_texCoord.y)*step(v_texCoord.y,dy+dh);
    col.rgb=mix(col.rgb,vec3(1.), inX*inY*u_dropout_intensity*u_env);
  }

  fragColor = vec4(clamp(col.rgb,0.,1.), col.a);
}
```

---

## FX-Plugins (Schablone)

```typescript
// Beide FX folgen exakt dem Plan-8e-Plugin-Pattern:
// id, name, kind (PascalCase), defaultTrigger: 'beat',
// preloadState (mit WebGL2-Check in preload()),
// paramSchema ({value,label}[], step-Werte überall),
// render() ruft renderGlFx() auf

// ColorGradeShift flowMode: return (kein Dauerlook)
// RetroVHS flowMode: renderGlFx() mit u_env=1.0, u_dropout_intensity=0
//   → Scanlines + Fringe dauerhaft, Dropout aus

// RENDER_ORDER: beide nach GlitchSlice, vor Overlay-FX
```

---

## UI — Quality Indicator + User Override

```
components/Workspace/WorkspaceHeader.tsx MODIFY

Rechts neben BPM-Badge:
  [●] 60 FPS  [◇ 1.0×]   — grün, volle Qualität
  [●] 42 FPS  [◇ 0.75×]  — orange, automatisch gedrosselt
  [●] 31 FPS  [◇ 0.5×]   — rot, stark gedrosselt

Tooltip: "WebGL quality scaled to 75% — FPS below 45"
Toggle: "📌 Pin to Maximum Quality" → qualityManager.pinToMax(true)
  → Setting in User-Preferences gespeichert (Store)
```

```typescript
// components/Workspace/QualityIndicator.tsx CREATE
// Liest qualityManager.getState() via Hook (polling alle 1s oder Store-Signal)
// Zeigt FPS + Scale + Tier-Badge ('HIGH' / 'MID' / 'LOW')
```

---

## Integration-Checkliste (7 Stellen × 2 FX)

```
1. lib/fx/color-grade-shift.ts + lib/fx/retro-vhs.ts   CREATE
2. lib/fx/index.ts                                       MODIFY — 2 × register()
3. lib/renderer/types.ts                                 MODIFY — FxKind-Union
4. lib/timeline/plugin-mapping.ts                        MODIFY — 7 Stellen × 2
5. lib/renderer/loop.ts                                  MODIFY — qualityManager.recordFrame()
6. lib/store/ (User-Preferences)                         MODIFY — qualityPinned: boolean
7. tests/                                                CREATE (siehe unten)
```

---

## File Map

| Datei | Aktion |
|---|---|
| `lib/renderer/webgl/capabilities.ts` | CREATE — Device-Caps + Tier + Asset-Limits |
| `lib/renderer/webgl/quality.ts` | CREATE — QualityManager Singleton |
| `lib/renderer/webgl/context.ts` | CREATE — pro-Clip Context + Caps + Quality |
| `lib/renderer/webgl/shader.ts` | CREATE — Compile + Cache + Precision-Adapt |
| `lib/renderer/webgl/texture.ts` | CREATE — ImageBitmap → WebGL-Texture |
| `lib/renderer/webgl/quad.ts` | CREATE — Einheits-Quad-Buffer |
| `lib/renderer/webgl/pipeline.ts` | CREATE — renderGlFx() |
| `lib/renderer/webgl/programs/color-grade.ts` | CREATE — GLSL + Uniform-Types |
| `lib/renderer/webgl/programs/retro-vhs.ts` | CREATE — GLSL + Uniform-Types |
| `lib/fx/color-grade-shift.ts` | CREATE |
| `lib/fx/retro-vhs.ts` | CREATE |
| `lib/fx/index.ts` | MODIFY |
| `lib/renderer/types.ts` | MODIFY — FxKind-Union |
| `lib/renderer/loop.ts` | MODIFY — qualityManager.recordFrame() |
| `lib/timeline/plugin-mapping.ts` | MODIFY — 7 Stellen × 2 |
| `lib/store/` | MODIFY — qualityPinned Preference |
| `components/Workspace/QualityIndicator.tsx` | CREATE |
| `docs/KNOWN_LIMITATIONS.md` | MODIFY — WebGL2 + Safari 17+ + Low-Tier-Limits |

---

## Tests

**`tests/unit/webgl/capabilities.test.ts`** — ≥ 5:
- `tier='high'` bei maxTex≥16384 + !isMobile
- `tier='mid'` bei maxTex≥8192
- `tier='low'` bei maxTex=4096 + isMobile
- `webgl2=false` → alle Limits 0, tier='low'
- `maxParticles`: high=500, mid=200, low=80

**`tests/unit/webgl/quality.test.ts`** — ≥ 6:
- 20 Frames unter 45 FPS → scale wechselt von 1.0 auf 0.75
- 20 Frames unter 45 FPS + scale=0.75 → scale 0.5
- 60 Frames über 55 FPS → scale hochgesetzt
- `pinToMax(true)` → scale bleibt 1.0 egal welche FPS
- Hysterese: 19 Frames unter Threshold → kein Scale-Change
- Scale-Up-Hysterese: 59 Frames über Threshold → noch kein Scale-Up

**`tests/unit/webgl/context.test.ts`** — ≥ 4:
- Context wird erstellt wenn WebGL2 verfügbar
- `null` wenn WebGL2 nicht verfügbar
- Größe clamps auf `maxTextureSize`
- Context wird neu erstellt wenn `quality.scale` sich ändert

**`tests/unit/webgl/shader.test.ts`** — ≥ 3:
- Shader kompiliert + linked ohne Fehler
- Cache-Hit: zweiter Aufruf gibt selbes Program zurück
- Precision-Adaptation: `highPrecision=false` → `mediump` in adapted Src

**`tests/unit/fx/color-grade-shift.test.ts`** — ≥ 4:
- `env=0` → kein renderGlFx-Aufruf
- `flowMode=true` → kein renderGlFx-Aufruf
- `preload()` → preloadState='ready' wenn WebGL2 vorhanden
- `preload()` → preloadState='error' wenn kein WebGL2

**`tests/unit/fx/retro-vhs.test.ts`** — ≥ 4:
- `flowMode=true` → renderGlFx aufgerufen (Scanlines persistent)
- `flowMode=true` → `u_dropout_intensity=0` in Uniforms
- `u_max_iterations` entspricht `caps.maxRaySteps`
- `env=0` → kein Aufruf

Mindest: **≥ 26 neue Tests**

---

## Verification Gate

Baseline: post-8e. Ziel: **Baseline + ≥ 26**.

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Manuelle Smoke-Tests:**
```
# Desktop Chrome: QualityIndicator zeigt 'HIGH · 60 FPS · 1.0×'
# Safari 17+: QualityIndicator zeigt 'MID · XX FPS · 1.0×'
# DevTools CPU-Throttling 6×: FPS sinkt → nach 20 Frames Scale 0.75 sichtbar
# Scale 0.75: visuell kaum Unterschied, FPS steigt wieder
# "Pin to Maximum": Scale-Down passiert nicht mehr bei Throttling
# ColorGradeShift hueShift=180 → Farbumkehr auf Beat (GPU-gerendert)
# RetroVHS: Scanlines + Fringe dauerhaft, Dropout auf Beat
# RetroVHS flowMode: Scanlines bleiben, kein Dropout
# Export WebM: beide FX rendern korrekt (Chrome + Safari 17+)
# Capacitor Mobile (iOS Simulator): tier='low', maxParticles=80 im Log
# maxTextureSize 4096: 4K-Export wird auf 4096 geclampt, kein GPU-Crash
# Context-Loss: DevTools → Force Context Loss → FX recovered nächsten Frame
# Low-Tier iOS: mediump Precision im Shader-Log sichtbar
```

---

## Commit-Struktur

```
feat(webgl): capabilities — Device-Check + Tier + Asset-Limits
feat(webgl): quality — FPS-Wächter + Auto-Scaling + User-Override
feat(webgl): context — pro-Clip Context + Caps + Quality-Scale
feat(webgl): shader — Compile + WeakMap-Cache + Precision-Adaptation
feat(webgl): texture + quad — ImageBitmap-Upload + Einheits-Quad
feat(webgl): pipeline — renderGlFx + Smart-Asset u_max_iterations
feat(webgl): programs — color-grade.glsl + retro-vhs.glsl
feat(fx): color-grade-shift — WebGL2 + preload-Check
feat(fx): retro-vhs — WebGL2 + flowMode-Scanlines + Dropout-Limit
feat(renderer): loop — qualityManager.recordFrame() Integration
feat(store): qualityPinned User-Preference
feat(ui): QualityIndicator — FPS + Scale + Tier + Pin-Toggle
feat(fx): types + registry + plugin-mapping — 2 FX, 7 Stellen je
docs(limitations): WebGL2 Safari 17+ + Low-Tier Asset-Limits
test: capabilities + quality + context + shader + color-grade + retro-vhs
```

---

## Out of Scope → Plan 8g (erste Nutznießer der neuen Infrastruktur)

- Particles-FX (WebGL, `u_max_iterations` = maxParticles)
- Sunray-Rebuild (WebGL, ray-marching mit `u_max_iterations` = maxRaySteps)
- Bloom / Lens-Distortion
- WebGPU-Migration (wenn Browser-Support reif ist, ~2027)

---

Abgabe: `vibegrid-plan-8f-fx-color-vhs.md`
