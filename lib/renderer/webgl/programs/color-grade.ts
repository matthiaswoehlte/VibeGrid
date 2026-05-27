/**
 * Plan 8f.1 — ColorGradeShift Fragment-Shader.
 *
 * Wendet Saturation / Contrast / Brightness / Hue-Shift mit Envelope-
 * Modulation (`u_env` = beat-decay) auf das `u_image`-Sample an. `u_contain`
 * mappt von `gl_Position`-Clip-Space auf die contain-rect-Bitmap-Region
 * (gleicht Plan-8e Canvas2D-Verhalten ab).
 *
 * HSL-Konversion ist ein Standard-Lookup (Branchless für Performance);
 * Hue-Shift überspringen bei kleiner Differenz (`abs(hs) < 0.001`) um den
 * teuren rgb↔hsl-Roundtrip zu sparen wenn der Slider auf 0 steht.
 *
 * `precision highp` wird auf Low-Tier-Devices via `shader.ts` Regex zu
 * `precision mediump` herabgesenkt.
 */
export const COLOR_GRADE_FRAG_SRC = `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform vec4  u_contain;
uniform vec2  u_resolution;
uniform float u_saturation;
uniform float u_contrast;
uniform float u_brightness;
uniform float u_hue_shift;
uniform float u_env;

in  vec2 v_texCoord;
out vec4 fragColor;

vec3 rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float l  = (mx + mn) * 0.5;
  if (mx == mn) return vec3(0.0, 0.0, l);
  float d = mx - mn;
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r)      h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else                h = (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}

float h2r(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5)     return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  if (hsl.y == 0.0) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(
    h2r(p, q, hsl.x + 1.0/3.0),
    h2r(p, q, hsl.x),
    h2r(p, q, hsl.x - 1.0/3.0)
  );
}

void main() {
  vec2 uv    = u_contain.xy + v_texCoord * u_contain.zw;
  vec4 color = texture(u_image, uv);
  vec3 rgb   = color.rgb;

  // Brightness
  rgb *= mix(1.0, u_brightness, u_env);
  // Contrast (center on 0.5)
  rgb  = (rgb - 0.5) * mix(1.0, u_contrast, u_env) + 0.5;

  // Saturation via luminance mix
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(vec3(lum), rgb, mix(1.0, u_saturation, u_env));

  // Hue shift — skip the HSL round-trip when negligible
  float hs = u_hue_shift * u_env / 360.0;
  if (abs(hs) > 0.001) {
    vec3 hsl = rgb2hsl(rgb);
    hsl.x    = fract(hsl.x + hs);
    rgb      = hsl2rgb(hsl);
  }

  fragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
}`;
