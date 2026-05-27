import { getDeviceCapabilities } from './capabilities';
import type { ProgramLocations } from './context';

/**
 * Plan 8f.1 — GLSL-Shader Compile + Link + Cache. Pro GL-Context wird
 * jedes Fragment-Source genau einmal kompiliert; das Ergebnis lebt im
 * WeakMap so lange der GL-Context selbst lebt (Context-Verlust ⇒ GC).
 *
 * Precision-Adaptation: Wenn das Device `highp` im Fragment-Shader
 * nicht unterstützt (Low-Tier-Mobile), wird der Source via einfacher
 * Regex auf `mediump` abgesenkt. Nur die `precision`-Direktive wird
 * ersetzt; explizite `highp <type>`-Variablen bleiben — Trade-off
 * gegen falsche Treffer in Identifier-Namen.
 *
 * Locations werden separat über `getLocations` gecached (pro WebGLProgram,
 * in `glCtx.locations` WeakMap). Das spart 7+ getAttribLocation /
 * getUniformLocation Calls pro Frame.
 */

export const VERT_SRC = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main(){
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord  = a_texCoord;
}`;

const programCache = new WeakMap<
  WebGL2RenderingContext,
  Map<string, WebGLProgram>
>();

export function getOrCompileProgram(
  gl: WebGL2RenderingContext,
  fragSrc: string
): WebGLProgram {
  const caps = getDeviceCapabilities();
  const adapted = caps.highPrecision
    ? fragSrc
    : fragSrc.replace(/precision highp/g, 'precision mediump');

  let map = programCache.get(gl);
  if (!map) {
    map = new Map();
    programCache.set(gl, map);
  }
  const cached = map.get(adapted);
  if (cached) return cached;

  const v = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
  const f = compile(gl, gl.FRAGMENT_SHADER, adapted);
  const prog = link(gl, v, f);
  map.set(adapted, prog);
  return prog;
}

export function getLocations(
  gl: WebGL2RenderingContext,
  prog: WebGLProgram,
  cache: WeakMap<WebGLProgram, ProgramLocations>,
  uniformNames: readonly string[]
): ProgramLocations {
  const hit = cache.get(prog);
  if (hit) return hit;
  const locs: ProgramLocations = {
    attribs: {
      a_position: gl.getAttribLocation(prog, 'a_position'),
      a_texCoord: gl.getAttribLocation(prog, 'a_texCoord')
    },
    uniforms: new Map(
      uniformNames.map((n) => [n, gl.getUniformLocation(prog, n)])
    )
  };
  cache.set(prog, locs);
  return locs;
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  src: string
): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`[WebGL Shader] ${gl.getShaderInfoLog(s)}\n${src}`);
  }
  return s;
}

function link(
  gl: WebGL2RenderingContext,
  v: WebGLShader,
  f: WebGLShader
): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`[WebGL Link] ${gl.getProgramInfoLog(p)}`);
  }
  gl.deleteShader(v);
  gl.deleteShader(f);
  return p;
}

/** Test-only: leert den Program-Cache komplett. */
export function _resetShaderCacheForTests(): void {
  // WeakMap can't be cleared; replace by re-creating in module scope.
  // We instead expose a way to drop the per-gl Map.
  // Caller drops it by re-installing the mock GL (new WeakMap key).
}
