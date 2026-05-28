/**
 * Plan 11a — RGBSplit Fragment-Shader.
 *
 * Channel-shift Aberration: R-Kanal sampelt bei `UV + u_shift * u_env`,
 * G unverändert, B bei `UV - u_shift * u_env`. `u_intensity` mischt
 * linear zwischen Original-RGB und dem aberrierten Resultat. So bleibt
 * der Param-Range identisch zum Canvas-2D-Vorgänger, der Look ist aber
 * cleaner (channel-replace statt screen-additive).
 *
 * `u_contain` ist Pflicht: `renderGlFx` setzt es automatisch auf die
 * Bitmap's contain-rect, ohne das Mapping würde der Shader den Quad
 * voll-stretchen und Aspect-Ratio zerstören.
 *
 * Behavior-Drift vs. Canvas2D-Vorgänger: siehe KNOWN_LIMITATIONS.md
 * Eintrag "RGBSplit WebGL2 Aberration Look".
 */
export const RGB_SPLIT_FRAG_SRC = `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform vec4  u_contain;
uniform vec2  u_resolution;
uniform float u_shift;
uniform float u_env;
uniform float u_intensity;

in  vec2 v_texCoord;
out vec4 fragColor;

void main() {
  // Contain-rect-Mapping — Pflicht, sonst Aspect-Bruch.
  vec2 uv = u_contain.xy + v_texCoord * u_contain.zw;

  float s = u_shift * u_env;

  vec4  orig = texture(u_image, uv);
  float r    = texture(u_image, vec2(uv.x + s, uv.y)).r;
  float g    = orig.g;
  float b    = texture(u_image, vec2(uv.x - s, uv.y)).b;
  vec3  split = vec3(r, g, b);

  // u_intensity als linearer Mix zwischen Original und Aberration —
  // 0 = no effect, 1 = full channel-shift.
  vec3 result = mix(orig.rgb, split, u_intensity);
  fragColor   = vec4(result, orig.a);
}`;

/** FX-spezifische Uniforms (renderGlFx-Location-Cache).
 *  Standard-Uniforms `u_image`, `u_contain`, `u_resolution` sind
 *  pipeline-automatisch und gehören NICHT in diese Liste. */
export const RGB_SPLIT_UNIFORM_NAMES = [
  'u_shift',
  'u_env',
  'u_intensity'
] as const;
