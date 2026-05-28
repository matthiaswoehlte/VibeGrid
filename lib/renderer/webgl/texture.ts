/**
 * Plan 8f.1 + 8f.3 — Texture-Source → WebGL2-Texture mit Reuse.
 *
 * Ein Texture-Slot pro GL-Context, persistiert über die Lifetime des
 * Context-Eintrags. Pro Frame wird `texSubImage2D` aufgerufen (kein
 * GPU-Realloc) — bei einer Auflösungsänderung (z.B. 1080p→4K Export)
 * wird via `texImage2D` neu allokiert.
 *
 * Plan 8f.3: source ist generalisiert auf `TexImageSource` —
 * ImageBitmap (Default), HTMLCanvasElement, OffscreenCanvas (für
 * `renderGlFx`-Variante mit `source='canvas'`, die den bereits
 * composed Main-Canvas-Frame als Edge-Glow-Input nutzt).
 *
 * `UNPACK_FLIP_Y_WEBGL = false`: die Y-Achsen-Korrektur passiert
 * deterministisch im Quad-Buffer (siehe `quad.ts`). Der explizite
 * `pixelStorei`-Call hier ist trotzdem nötig, weil das Pixel-Storage-
 * State per GL-Context lebt.
 */

interface TextureEntry {
  tex: WebGLTexture;
  width: number;
  height: number;
}

const textureByCtx = new WeakMap<WebGL2RenderingContext, TextureEntry>();

export function uploadTextureSource(
  gl: WebGL2RenderingContext,
  source: TexImageSource,
  width: number,
  height: number
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
      gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null
    );
    entry = { tex, width, height };
    textureByCtx.set(gl, entry);
  }

  gl.bindTexture(gl.TEXTURE_2D, entry.tex);

  if (entry.width !== width || entry.height !== height) {
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null
    );
    entry.width = width;
    entry.height = height;
  }

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texSubImage2D(
    gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source
  );
  return entry.tex;
}

/**
 * Plan 8f.1 back-compat alias. New code should use `uploadTextureSource`.
 * Kept so existing pipeline.ts code paths (and any external consumers)
 * don't need to be touched in this commit.
 */
export function uploadImageBitmap(
  gl: WebGL2RenderingContext,
  bm: ImageBitmap
): WebGLTexture {
  return uploadTextureSource(gl, bm, bm.width, bm.height);
}
