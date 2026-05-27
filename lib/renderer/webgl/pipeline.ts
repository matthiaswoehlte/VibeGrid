import { containRect } from '@/lib/renderer/loop';
import type { RenderContext } from '@/lib/renderer/types';
import { getDeviceCapabilities } from './capabilities';
import { getGlContext } from './context';
import { getOrCompileProgram, getLocations } from './shader';
import { uploadImageBitmap } from './texture';
import { getQuadBuffer } from './quad';

/**
 * Plan 8f.1 — `renderGlFx`: einzige API, die FX-Plugins für WebGL2
 * benutzen. FX-Plugin ruft mit `fragSrc`, `uniforms` und `uniformNames`
 * (für den Location-Cache); die Pipeline kümmert sich um:
 *
 *   - WebGL2-Verfügbarkeit (skipped silently wenn nein)
 *   - Per-Clip GL-Context + Größen-Anpassung an quality.scale
 *   - Program-Cache + Location-Cache (1× pro Program, nicht pro Frame)
 *   - Quad-Buffer + Vertex-Attribute
 *   - Texture-Upload via `texSubImage2D`-Reuse
 *   - Standard-Uniforms (`u_image`, `u_contain`, `u_resolution`)
 *   - FX-spezifische Uniforms (Number / vec2 / vec4)
 *   - drawArrays + Final-Composite via `rc.ctx.drawImage(canvas, …)`
 */

export type Uniforms = Record<
  string,
  number | readonly [number, number] | readonly [number, number, number, number]
>;

export type UniformNames = readonly string[];

export interface RenderGlFxArgs {
  rc: RenderContext;
  fragSrc: string;
  uniforms: Uniforms;
  uniformNames: UniformNames;
}

export function renderGlFx(args: RenderGlFxArgs): void {
  const { rc, fragSrc, uniforms, uniformNames } = args;
  if (!rc.imageBitmap) return;

  const caps = getDeviceCapabilities();
  if (!caps.webgl2) return;

  const glCtx = getGlContext(rc.clipId, rc.width, rc.height);
  if (!glCtx) return;

  const { gl, canvas, locations } = glCtx;
  const { sx, sy, sw, sh } = containRect(rc);

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const prog = getOrCompileProgram(gl, fragSrc);
  gl.useProgram(prog);

  // Location-Cache mit den Standard-Uniforms vorausgefüllt.
  const allUniformNames = [
    'u_image',
    'u_contain',
    'u_resolution',
    ...uniformNames
  ];
  const locs = getLocations(gl, prog, locations, allUniformNames);

  // Quad-Setup: 4 floats × 4 bytes = 16 bytes stride.
  const buf = getQuadBuffer(gl);
  const stride = 16;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(locs.attribs.a_position);
  gl.vertexAttribPointer(
    locs.attribs.a_position,
    2,
    gl.FLOAT,
    false,
    stride,
    0
  );
  gl.enableVertexAttribArray(locs.attribs.a_texCoord);
  gl.vertexAttribPointer(
    locs.attribs.a_texCoord,
    2,
    gl.FLOAT,
    false,
    stride,
    8
  );

  // Standard-Uniforms.
  uploadImageBitmap(gl, rc.imageBitmap);
  const uImage = locs.uniforms.get('u_image');
  if (uImage) gl.uniform1i(uImage, 0);
  const uContain = locs.uniforms.get('u_contain');
  if (uContain) {
    gl.uniform4f(
      uContain,
      sx / rc.width,
      sy / rc.height,
      sw / rc.width,
      sh / rc.height
    );
  }
  const uRes = locs.uniforms.get('u_resolution');
  if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);

  // FX-spezifische Uniforms.
  for (const [name, val] of Object.entries(uniforms)) {
    const loc = locs.uniforms.get(name);
    if (!loc) continue;
    if (typeof val === 'number') {
      gl.uniform1f(loc, val);
    } else if (val.length === 2) {
      gl.uniform2fv(loc, val as unknown as Float32List);
    } else if (val.length === 4) {
      gl.uniform4fv(loc, val as unknown as Float32List);
    }
  }

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Final-Composite: WebGL-OffscreenCanvas → 2D-Main-Canvas.
  rc.ctx.drawImage(canvas, 0, 0, rc.width, rc.height);
}
