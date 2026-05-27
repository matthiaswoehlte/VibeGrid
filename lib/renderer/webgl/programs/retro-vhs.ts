/**
 * Plan 8f.2 — RetroVHS Fragment-Shader.
 *
 * Layered VHS-Effekt:
 *   - **Tape Warp**: sinusoidale x-Verschiebung gegen die y-Achse,
 *     amplitudisiert via `u_warp_intensity * u_env`. Beat-Sync.
 *   - **Color Fringe**: persistente RGB-Channel-Trennung. Läuft auch
 *     bei `u_env = 0` (Dauerlook).
 *   - **Scanlines**: persistente Horizontal-Linien, opacity via
 *     `u_scanline_opacity`. Auch persistent.
 *   - **Tape Dropout**: bis zu 8 randomisierte horizontale Streifen
 *     auf jedem Beat (PRNG geseedet via `u_seed + u_beat_index`,
 *     deterministisch reproduzierbar).
 *
 * `precision highp` → `precision mediump` auf Low-Tier-Devices
 * (siehe `shader.ts` Regex). `u_max_iterations` aus dem Rev-2-Plan
 * ist hier entfernt; die innere Dropout-Schleife hat eine static-bound
 * `i < 8`, was die effektive Obergrenze ist.
 */
export const RETRO_VHS_FRAG_SRC = `#version 300 es
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

in  vec2 v_texCoord;
out vec4 fragColor;

float rand(vec2 co, float s) {
  return fract(sin(dot(co + s, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = u_contain.xy + v_texCoord * u_contain.zw;

  // Tape Warp — sinusoidal x-displacement modulated by beat phase.
  float warpX = uv.x + sin(uv.y * 40.0 + u_beat_phase * 3.14159) * u_warp_intensity * u_env;
  vec2 wuv = vec2(clamp(warpX, 0.0, 1.0), uv.y);

  // Color Fringe — persistent RGB-channel separation.
  vec4 col;
  col.r = texture(u_image, wuv + vec2(u_color_fringe, 0.0)).r;
  col.g = texture(u_image, wuv).g;
  col.b = texture(u_image, wuv - vec2(u_color_fringe, 0.0)).b;
  col.a = texture(u_image, wuv).a;

  // Scanlines — persistent horizontal line darkening.
  float lineY  = floor(v_texCoord.y * u_resolution.y);
  float onLine = step(max(u_scanline_spacing - 1.0, 0.0), mod(lineY, max(u_scanline_spacing, 1.0)));
  col.rgb -= onLine * u_scanline_opacity;

  // Tape Dropout — beat-synchronous horizontal streaks, seeded PRNG.
  float maxD = u_dropout_count;
  for (float i = 0.0; i < 8.0; i++) {
    if (i >= maxD) break;
    float dy = rand(vec2(i, 0.1), u_seed + u_beat_index);
    float dx = rand(vec2(i, 0.2), u_seed + u_beat_index);
    float dw = rand(vec2(i, 0.3), u_seed + u_beat_index) * 0.3 + 0.05;
    float dh = 0.003;
    float inX = step(dx, v_texCoord.x) * step(v_texCoord.x, dx + dw);
    float inY = step(dy, v_texCoord.y) * step(v_texCoord.y, dy + dh);
    col.rgb = mix(col.rgb, vec3(1.0), inX * inY * u_dropout_intensity * u_env);
  }

  fragColor = vec4(clamp(col.rgb, 0.0, 1.0), col.a);
}`;
