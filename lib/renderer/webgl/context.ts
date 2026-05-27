import { getDeviceCapabilities } from './capabilities';
import { qualityManager, type QualityScale } from './quality';

/**
 * Plan 8f.1 — pro-Clip WebGL2-Context. Lebensdauer: solange der Clip in
 * der Timeline existiert. Eine `OffscreenCanvas` pro Clip, deren Pixel-
 * dimensionen `width × scale` betragen (scale aus qualityManager). Die
 * Pipeline blittet das Ergebnis im `drawImage` auf die Haupt-Canvas hoch.
 *
 * Context-Loss-Recovery: `webglcontextlost` markiert `lost=true`;
 * `webglcontextrestored` entfernt den Eintrag, der nächste `getGlContext`-
 * Aufruf rebuildet vollständig.
 *
 * **Test-Seam**: `_overrideContextFactory(fn)` muss ZUERST geprüft werden
 * (vor `getDeviceCapabilities()` und `new OffscreenCanvas`), damit Tests
 * unter jsdom (kein OffscreenCanvas-Konstruktor) keine ReferenceError werfen.
 *
 * **Cleanup**: `disposeContext(clipId)` wird vom `useWebGLClipCleanup`-
 * Hook ausgelöst, der `prevClipIds vs. currClipIds` diff't. Damit kein
 * Layer-Verstoß: `lib/store/timeline-slice` importiert kein WebGL-Modul.
 */
export interface ProgramLocations {
  attribs: { a_position: number; a_texCoord: number };
  uniforms: Map<string, WebGLUniformLocation | null>;
}

export interface GlContext {
  canvas: OffscreenCanvas;
  gl: WebGL2RenderingContext;
  lost: boolean;
  scale: QualityScale;
  locations: WeakMap<WebGLProgram, ProgramLocations>;
}

const contextByClip = new Map<string, GlContext>();

type GlContextFactory = (
  clipId: string,
  w: number,
  h: number
) => GlContext | null;
let _factory: GlContextFactory | null = null;

/** Test-Seam: injiziert eine Mock-Factory. `null` deaktiviert sie. */
export function _overrideContextFactory(f: GlContextFactory | null): void {
  _factory = f;
  if (!f) contextByClip.clear();
}

export function getGlContext(
  clipId: string,
  w: number,
  h: number
): GlContext | null {
  // Test-Seam ZUERST — verhindert OffscreenCanvas-Zugriff in jsdom.
  if (_factory) {
    const existing = contextByClip.get(clipId);
    if (existing && !existing.lost) return existing;
    const r = _factory(clipId, w, h);
    if (r) contextByClip.set(clipId, r);
    return r ?? null;
  }

  const caps = getDeviceCapabilities();
  if (!caps.webgl2) return null;

  const scale = qualityManager.scale;
  const safeW = Math.min(Math.ceil(w * scale), caps.maxTextureSize);
  const safeH = Math.min(Math.ceil(h * scale), caps.maxTextureSize);

  const ex = contextByClip.get(clipId);
  if (
    ex &&
    !ex.lost &&
    ex.canvas.width === safeW &&
    ex.canvas.height === safeH
  ) {
    return ex;
  }
  if (ex) disposeContext(clipId);

  const canvas = new OffscreenCanvas(safeW, safeH);
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
  if (!gl) return null;

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    const c = contextByClip.get(clipId);
    if (c) c.lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextByClip.delete(clipId);
  });

  const ctx: GlContext = {
    canvas,
    gl,
    lost: false,
    scale,
    locations: new WeakMap()
  };
  contextByClip.set(clipId, ctx);
  return ctx;
}

export function disposeContext(clipId: string): void {
  const ctx = contextByClip.get(clipId);
  if (!ctx) return;
  // Forcierte Context-Loss-Anforderung — Treiber-Hint, kann no-op sein.
  ctx.gl.getExtension('WEBGL_lose_context')?.loseContext();
  contextByClip.delete(clipId);
}

export function disposeAllContexts(): void {
  for (const id of [...contextByClip.keys()]) disposeContext(id);
}

/** Test-only: liefert die aktuelle Context-Map (read-only). */
export function _peekContextMap(): ReadonlyMap<string, GlContext> {
  return contextByClip;
}
