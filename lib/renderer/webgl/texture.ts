/**
 * Plan 8f.1 — ImageBitmap → WebGL2-Texture mit Reuse.
 *
 * Ein Texture-Slot pro GL-Context, persistiert über die Lifetime des
 * Context-Eintrags. Pro Frame wird `texSubImage2D` aufgerufen (kein
 * GPU-Realloc) — bei einer Auflösungsänderung (z.B. 1080p→4K Export)
 * wird via `texImage2D` neu allokiert.
 *
 * `UNPACK_FLIP_Y_WEBGL = false`: die Y-Achsen-Korrektur passiert
 * deterministisch im Quad-Buffer (siehe `quad.ts` — top vertices mit
 * v=0, bottom mit v=1). Der explizite `pixelStorei`-Call hier ist
 * trotzdem nötig, weil das Pixel-Storage-State per GL-Context lebt und
 * andere Browser-/Library-Code-Paths es eventuell auf `true` setzen.
 *
 * `ImageBitmap` aus `captureVideoFrame` ist synchron consumable (WebGL2-
 * Spec §4.1 "Pixel storage parameters", IBM/Mozilla/W3C-Konsens) — kein
 * Race gegen den `.close()`-Call im Renderer-Tick.
 */

interface TextureEntry {
  tex: WebGLTexture;
  width: number;
  height: number;
}

const textureByCtx = new WeakMap<WebGL2RenderingContext, TextureEntry>();

export function uploadImageBitmap(
  gl: WebGL2RenderingContext,
  bm: ImageBitmap
): WebGLTexture {
  let entry = textureByCtx.get(gl);

  if (!entry) {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      bm.width,
      bm.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    entry = { tex, width: bm.width, height: bm.height };
    textureByCtx.set(gl, entry);
  }

  gl.bindTexture(gl.TEXTURE_2D, entry.tex);

  if (entry.width !== bm.width || entry.height !== bm.height) {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      bm.width,
      bm.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    entry.width = bm.width;
    entry.height = bm.height;
  }

  // Pin UNPACK_FLIP_Y_WEBGL=false — the Y-correction lives in the quad
  // (top vertices with v=0). Explicit reset guards against other code
  // paths that may have set the state to true on this context.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    bm as unknown as TexImageSource
  );
  return entry.tex;
}
