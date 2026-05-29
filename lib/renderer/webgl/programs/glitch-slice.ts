/**
 * Plan 11b — GlitchSlice Fragment-Shader.
 *
 * Horizontale (u_axis=0) oder vertikale (u_axis=1) Slices mit
 * Pseudo-Random-Versatz pro Slice. `u_seed` (Plugin setzt
 * `params.seed + rc.beatIndex`) dreht die Random-Verteilung pro Beat.
 * `u_env` (aus subdividedBeatPhase + decay) steuert die Burst-Stärke.
 *
 * Behavior-Drift vs. Canvas2D-Vorgänger (Architekt-A Variante b):
 * - `fract(sin)`-Hash statt `mulberry32` → andere Slice-Verteilung
 *   bei gleichem `seed`
 * - `fract`-UV-Wrap statt Pixel-Clipping → Wrap-Around-Glitch. Texture
 *   ist im `source='bitmap'`-Mode bitmap-sized (kein Letterbox-Bereich
 *   in der Texture, siehe `lib/renderer/webgl/texture.ts:43-46` +
 *   `lib/renderer/webgl/pipeline.ts:111-113`), `fract()` wrappt deshalb
 *   immer auf echtes Bitmap-Content.
 * Beide Drifts dokumentiert in `docs/KNOWN_LIMITATIONS.md`.
 *
 * Subdivision (Plan 9c): `u_env` basiert auf `rc.subdividedBeatPhase`.
 * Bei `subdivision='1×'` identisches Verhalten zum pre-9c-Stand.
 *
 * `u_contain` ist Pflicht: `renderGlFx` setzt es automatisch auf die
 * Bitmap's contain-rect, ohne das Mapping würde der Shader den Quad
 * voll-stretchen und Aspect-Ratio zerstören.
 *
 * Cosmetic-Concern: bei `u_seed > ~10000` (lange Sessions, hoher
 * `rc.beatIndex`) verliert `sin()` in float32 Entropie — benachbarte
 * `sliceIdx`-Werte können visuell korrelieren. Teil des Glitch-Charmes;
 * Fix wäre integer-arithmetic PCG-Hash (separater Plan, falls je nötig).
 */
export const GLITCH_SLICE_FRAG_SRC = `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform vec4  u_contain;
uniform vec2  u_resolution;
uniform float u_sliceCount;
uniform float u_maxOffset;
uniform float u_env;
uniform float u_seed;
uniform float u_axis;

in  vec2 v_texCoord;
out vec4 fragColor;

// GPU-Standard-Hash — fract(sin)-Familie.
float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

void main() {
  // Contain-rect-Mapping — Pflicht, sonst Aspect-Bruch.
  vec2 uv = u_contain.xy + v_texCoord * u_contain.zw;

  // Slice-Index: bei u_axis=0 entlang y-Achse (horizontale Streifen),
  // bei u_axis=1 entlang x-Achse (vertikale Streifen).
  float sliceCoord = mix(uv.y, uv.x, u_axis);
  // sliceCount-Guard: Schema-min ist 2, aber defensiv für korrupte States.
  float n = max(u_sliceCount, 1.0);
  float sliceIdx = floor(sliceCoord * n);
  float r = hash(sliceIdx + u_seed);

  // Zentriert um 0, skaliert mit maxOffset × env.
  float offset = (r - 0.5) * 2.0 * u_maxOffset * u_env;

  // Versatz-Vektor je nach Achse. Vertical-Mode skaliert mit
  // Aspect-Ratio damit Pixel-Versatz konsistent zum Canvas-2D-
  // Verhalten ist (das immer w-basiert war, unabhängig von axis).
  vec2 offsetVec = mix(
    vec2(offset, 0.0),
    vec2(0.0, offset * (u_resolution.x / u_resolution.y)),
    u_axis
  );

  // UV-Wrapping mit fract() — bewusstes Glitch-Artefakt (Variante b).
  // Texture ist bitmap-sized im source='bitmap'-Mode, daher sampelt
  // fract zwischen Bitmap-Rändern immer auf echtem Content.
  vec2 uvShifted = fract(uv + offsetVec);

  fragColor = texture(u_image, uvShifted);
}`;

/** FX-spezifische Uniforms (renderGlFx-Location-Cache).
 *  Standard-Uniforms `u_image`, `u_contain`, `u_resolution` sind
 *  pipeline-automatisch und gehören NICHT in diese Liste. */
export const GLITCH_SLICE_UNIFORM_NAMES = [
  'u_sliceCount',
  'u_maxOffset',
  'u_env',
  'u_seed',
  'u_axis'
] as const;
