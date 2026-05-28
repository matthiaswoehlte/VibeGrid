/**
 * Plan 8f.3 — Edge Glow Fragment-Shader.
 *
 * 9-Tap Sobel auf Luma → magnitude → smoothstep mit glow-band → mix
 * mit background nach bgOpacity + intensity-modulation (env-decayed).
 *
 * Single-Pass: kein FBO-Ping-Pong, kein Gauss-Blur (Folge-Plan 8f.4
 * kann echtes Gaussian-Glow ergänzen). `glow` widens the smoothstep-
 * band statt einer separaten Blur-Stufe — billiger und liefert den
 * "Outline mit weichem Rand" Look à la CapCut Outline.
 *
 * `u_color` ist eine vec4 inkl. Alpha — der Plugin parsed Hex →
 * Float-Tuple. `u_intensity` enthält bereits `params.intensity * env`,
 * der Shader weiss nichts von Beats.
 *
 * Erwartet `source='canvas'` aus `renderGlFx` — sampelt den bereits
 * composed Frame, daher kein `u_contain`-Remap nötig (Pipeline setzt
 * Identity).
 */
export const EDGE_GLOW_FRAG_SRC = `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform vec4  u_contain;     // identity when source='canvas'; declared for compat
uniform vec2  u_resolution;
uniform float u_threshold;
uniform vec4  u_color;
uniform float u_glow;
uniform float u_bg_opacity;
uniform float u_intensity;

in  vec2 v_texCoord;
out vec4 fragColor;

float luma(vec2 uv) {
  vec3 c = texture(u_image, uv).rgb;
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 t = 1.0 / u_resolution;

  float tl = luma(v_texCoord + vec2(-t.x, -t.y));
  float tm = luma(v_texCoord + vec2( 0.0, -t.y));
  float tr = luma(v_texCoord + vec2( t.x, -t.y));
  float ml = luma(v_texCoord + vec2(-t.x,  0.0));
  float mr = luma(v_texCoord + vec2( t.x,  0.0));
  float bl = luma(v_texCoord + vec2(-t.x,  t.y));
  float bm = luma(v_texCoord + vec2( 0.0,  t.y));
  float br = luma(v_texCoord + vec2( t.x,  t.y));

  float gx = (-1.0*tl) + (-2.0*ml) + (-1.0*bl) + (1.0*tr) + (2.0*mr) + (1.0*br);
  float gy = (-1.0*tl) + (-2.0*tm) + (-1.0*tr) + (1.0*bl) + (2.0*bm) + (1.0*br);
  float mag = sqrt(gx * gx + gy * gy);

  // Glow band: lower edge of smoothstep widens with u_glow. glow=0 → near
  // hard step (~1 sub-pixel), glow=1 → 0.20-wide soft band.
  //
  // GLSL ES Spec §8.3: smoothstep(a, a, x) ist undefined behavior wenn
  // edge0 >= edge1. ARM Mali / PowerVR (iPhone XR) emittieren in dem
  // Fall NaN/0 → Effekt verschwindet bei glow=0 auf genau den Geräten,
  // die wir mit Plan 11 anpeilen. Daher 0.001-Epsilon auf hi pinnen
  // und lo entsprechend verschieben — visuell identisch (sub-pixel),
  // mathematisch sauber auf jedem Treiber.
  float hi = u_threshold + 0.001;
  float lo = max(0.0, hi - u_glow * 0.20 - 0.001);
  float edge = smoothstep(lo, hi, mag) * u_intensity;

  vec4 bg = texture(u_image, v_texCoord);
  vec3 bgRgb = bg.rgb * u_bg_opacity;
  vec3 outRgb = mix(bgRgb, u_color.rgb, edge);
  // Preserve alpha: respect bg's alpha (so transparent letterbox areas
  // stay transparent) and OR-in the edge's alpha contribution.
  float outA = max(bg.a * u_bg_opacity, edge * u_color.a);
  fragColor = vec4(outRgb, outA);
}`;
