/**
 * Plan 8f.1 — Einheits-Quad-Buffer (clip-space −1..1, tex-space 0..1).
 *
 * Layout pro Vertex: [x, y, u, v], 4 floats × 4 bytes = 16 bytes/vertex.
 * 4 Vertices in TRIANGLE_STRIP-Reihenfolge mit y-flipped UVs:
 *   0: unten-links   (−1, −1, 0, 1)
 *   1: unten-rechts  ( 1, −1, 1, 1)
 *   2: oben-links    (−1,  1, 0, 0)
 *   3: oben-rechts   ( 1,  1, 1, 0)
 *
 * Why v-flipped (top vertices have v=0, bottom v=1):
 *
 *   - ImageBitmap has top-left origin (CSS convention).
 *   - Uploaded to GL with `UNPACK_FLIP_Y_WEBGL=false`, image row 0
 *     lands at texture y=0 (which is sampler's "uv.y=0").
 *   - WebGL viewport clip y=+1 is the top of the framebuffer; the
 *     browser composites this as the top of the canvas.
 *   - Therefore: top vertex (clip y=+1) must sample uv.y=0 to display
 *     image row 0 at the canvas top. Hence v=0 at the top vertices.
 *
 * This is the deterministic alternative to `UNPACK_FLIP_Y_WEBGL=true`
 * (which depends on the GL implementation and has known
 * inconsistencies across browsers when sourcing from `ImageBitmap`).
 *
 * Singleton pro GL-Context (WeakMap). Wird im Context-Loss zusammen mit
 * dem GL-Context selbst garbage-collected.
 */

const quadByCtx = new WeakMap<WebGL2RenderingContext, WebGLBuffer>();

export function getQuadBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const hit = quadByCtx.get(gl);
  if (hit) return hit;

  const data = new Float32Array([
    -1.0, -1.0, 0.0, 1.0,
    1.0, -1.0, 1.0, 1.0,
    -1.0, 1.0, 0.0, 0.0,
    1.0, 1.0, 1.0, 0.0
  ]);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  quadByCtx.set(gl, buf);
  return buf;
}
