import { vi } from 'vitest';

/**
 * Plan 8f.1 — WebGL2 Mock-Skeleton. jsdom hat kein OffscreenCanvas und
 * kein WebGL — die Mocks hier liefern eine deterministische
 * GL-Implementierung für Unit-Tests + einen Context-Factory-Seam, der
 * vor `new OffscreenCanvas` greift (siehe `context._overrideContextFactory`).
 *
 * `createMockGL()` deckt alle Methoden + Konstanten ab, die unter
 * `lib/renderer/webgl/*` aufgerufen werden. `getShaderParameter` +
 * `getProgramParameter` returnen immer `true` — Shader-Compile-/Link-
 * Tests prüfen also nur den JS-Pfad, nicht echte GLSL-Compilation.
 */

const C = {
  TEXTURE_2D: 0x0de1,
  RGBA: 0x1908,
  UNSIGNED_BYTE: 0x1401,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  CLAMP_TO_EDGE: 0x812f,
  LINEAR: 0x2601,
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  ARRAY_BUFFER: 0x8892,
  STATIC_DRAW: 0x88b4,
  COLOR_BUFFER_BIT: 0x4000,
  TRIANGLE_STRIP: 0x0005,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  FLOAT: 0x1406,
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  MAX_TEXTURE_SIZE: 0x0d33,
  HIGH_FLOAT: 0x8df2
};

export type MockGL = WebGL2RenderingContext & {
  __calls: Array<{ method: string; args: unknown[] }>;
};

export function createMockGL(): MockGL {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const stub =
    <T>(name: string, ret: T | (() => T) = undefined as unknown as T) =>
    (...args: unknown[]): T => {
      calls.push({ method: name, args });
      return typeof ret === 'function' ? (ret as () => T)() : ret;
    };
  const gl = {
    ...C,
    __calls: calls,
    createTexture: stub('createTexture', () => ({}) as WebGLTexture),
    bindTexture: stub('bindTexture'),
    texParameteri: stub('texParameteri'),
    texImage2D: stub('texImage2D'),
    texSubImage2D: stub('texSubImage2D'),
    pixelStorei: stub('pixelStorei'),
    activeTexture: stub('activeTexture'),
    createBuffer: stub('createBuffer', () => ({}) as WebGLBuffer),
    bindBuffer: stub('bindBuffer'),
    bufferData: stub('bufferData'),
    createShader: stub('createShader', () => ({}) as WebGLShader),
    shaderSource: stub('shaderSource'),
    compileShader: stub('compileShader'),
    getShaderParameter: stub('getShaderParameter', true),
    getShaderInfoLog: stub('getShaderInfoLog', ''),
    deleteShader: stub('deleteShader'),
    createProgram: stub('createProgram', () => ({}) as WebGLProgram),
    attachShader: stub('attachShader'),
    linkProgram: stub('linkProgram'),
    getProgramParameter: stub('getProgramParameter', true),
    getProgramInfoLog: stub('getProgramInfoLog', ''),
    useProgram: stub('useProgram'),
    getAttribLocation: stub('getAttribLocation', 0),
    getUniformLocation: stub(
      'getUniformLocation',
      () => ({}) as WebGLUniformLocation
    ),
    enableVertexAttribArray: stub('enableVertexAttribArray'),
    vertexAttribPointer: stub('vertexAttribPointer'),
    uniform1i: stub('uniform1i'),
    uniform1f: stub('uniform1f'),
    uniform2f: stub('uniform2f'),
    uniform2fv: stub('uniform2fv'),
    uniform4f: stub('uniform4f'),
    uniform4fv: stub('uniform4fv'),
    viewport: stub('viewport'),
    clearColor: stub('clearColor'),
    clear: stub('clear'),
    drawArrays: stub('drawArrays'),
    getExtension: vi.fn(() => ({ loseContext: vi.fn() })),
    getParameter: vi.fn((p: number) => (p === C.MAX_TEXTURE_SIZE ? 4096 : 0)),
    getShaderPrecisionFormat: vi.fn(() => ({
      precision: 23,
      rangeMin: 127,
      rangeMax: 127
    }))
  };
  return gl as unknown as MockGL;
}

/**
 * Installiert die Mock-Factory im `context.ts`-Modul. Jeder
 * `getGlContext(clipId, w, h)` greift dann auf den Mock zu, ohne
 * `new OffscreenCanvas` aufzurufen.
 */
export async function setupWebGLMock(): Promise<MockGL> {
  const gl = createMockGL();
  const { _overrideContextFactory } = await import(
    '@/lib/renderer/webgl/context'
  );
  _overrideContextFactory((_clipId, w, h) => ({
    canvas: { width: w, height: h } as OffscreenCanvas,
    gl,
    lost: false,
    scale: 1.0,
    locations: new WeakMap()
  }));
  return gl;
}

export async function teardownWebGLMock(): Promise<void> {
  const { _overrideContextFactory } = await import(
    '@/lib/renderer/webgl/context'
  );
  _overrideContextFactory(null);
}
