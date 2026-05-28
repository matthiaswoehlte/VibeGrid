/**
 * Plan 8f.4 — Contour GL Fragment-Shader.
 *
 * GPU-Port der Canvas2D `contour` FX: 9-Tap Sobel auf Luma → optional
 * 5-Sample Dilate-Pass (lineWidth control) → smoothstep-AA → Sweep-
 * Gating mit linear-Falloff → Stipple-Hash → out as RGBA mit
 * `alpha = edge` (transparenter Hintergrund).
 *
 * Erwartet `source='canvas'` aus `renderGlFx` — sampelt den bereits
 * composed Frame (inkl. CGS / VHS / Edge Glow). `u_contain` ist
 * Identity (pipeline setzt das für 'canvas' so).
 *
 * Direction encoding (`u_sweep_dir`, als float weil renderGlFx nur
 * number-Uniforms hochlädt):
 *   0=all, 1=lr, 2=rl, 3=tb, 4=bt, 5=bl-tr, 6=tl-br, 7=tr-bl, 8=br-tl.
 *
 * Stipple gating: `u_stipple_size > 0.5` aktiviert ein per-cell hash
 * (`sin(dot(cell, k)) * c` → fract). 50/50 Coverage; cell-size in
 * Main-Canvas-px (über `v_texCoord * u_resolution`, nicht
 * `gl_FragCoord.xy` — sonst skaliert die Stipple mit `quality.scale`).
 *
 * Output: pre-multiplied alpha (`color.rgb * edge`, `alpha = edge`),
 * damit `rc.ctx.drawImage(canvas, …)` per default `source-over` sauber
 * über den Underlying Frame composed. Background bleibt sichtbar.
 */
export const CONTOUR_GL_FRAG_SRC = `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform vec4  u_contain;      // identity when source='canvas'; declared for compat
uniform vec2  u_resolution;
uniform float u_threshold;
uniform vec4  u_color;
uniform float u_dilate_px;
uniform float u_stipple_size;
uniform float u_sweep_dir;
uniform float u_sweep_phase;
uniform float u_reveal_trail;
uniform float u_intensity;

in  vec2 v_texCoord;
out vec4 fragColor;

float luma(vec2 uv) {
  vec3 c = texture(u_image, uv).rgb;
  return dot(c, vec3(0.299, 0.587, 0.114));
}

float sobelMag(vec2 uv, vec2 t) {
  float tl = luma(uv + vec2(-t.x, -t.y));
  float tm = luma(uv + vec2( 0.0, -t.y));
  float tr = luma(uv + vec2( t.x, -t.y));
  float ml = luma(uv + vec2(-t.x,  0.0));
  float mr = luma(uv + vec2( t.x,  0.0));
  float bl = luma(uv + vec2(-t.x,  t.y));
  float bm = luma(uv + vec2( 0.0,  t.y));
  float br = luma(uv + vec2( t.x,  t.y));
  float gx = (-1.0*tl) + (-2.0*ml) + (-1.0*bl) + (1.0*tr) + (2.0*mr) + (1.0*br);
  float gy = (-1.0*tl) + (-2.0*tm) + (-1.0*tr) + (1.0*bl) + (2.0*bm) + (1.0*br);
  return sqrt(gx * gx + gy * gy);
}

float pointProgress(vec2 uv, float dir) {
  if (dir < 0.5) return 0.0;                              // all (caller skips)
  if (dir < 1.5) return uv.x;                             // lr
  if (dir < 2.5) return 1.0 - uv.x;                       // rl
  if (dir < 3.5) return uv.y;                             // tb
  if (dir < 4.5) return 1.0 - uv.y;                       // bt
  if (dir < 5.5) return (uv.x + (1.0 - uv.y)) * 0.5;      // bl-tr
  if (dir < 6.5) return (uv.x + uv.y) * 0.5;              // tl-br
  if (dir < 7.5) return ((1.0 - uv.x) + uv.y) * 0.5;      // tr-bl
  return ((1.0 - uv.x) + (1.0 - uv.y)) * 0.5;             // br-tl
}

float stippleHash(vec2 frag, float cellPx) {
  if (cellPx < 0.5) return 1.0;
  vec2 cell = floor(frag / cellPx);
  float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  return step(0.5, h);
}

void main() {
  vec2 t = 1.0 / u_resolution;

  // 9-tap Sobel at the centre.
  float mag = sobelMag(v_texCoord, t);

  // Dilate-Pass: 4 cardinal samples at radius u_dilate_px, take max.
  // u_dilate_px ∈ [0, ~2] (mapped from lineWidth 0.5..4 in the plugin).
  // At 0 the branch costs only the comparison; at >0 we pay 4 extra
  // Sobel evaluations (4 * 9 = 36 extra luma fetches). Still well
  // within shader budget for 1080p single-pass.
  if (u_dilate_px > 0.001) {
    float r = u_dilate_px;
    mag = max(mag, sobelMag(v_texCoord + vec2(r, 0.0) * t, t));
    mag = max(mag, sobelMag(v_texCoord - vec2(r, 0.0) * t, t));
    mag = max(mag, sobelMag(v_texCoord + vec2(0.0, r) * t, t));
    mag = max(mag, sobelMag(v_texCoord - vec2(0.0, r) * t, t));
  }

  // Anti-aliased edge mask. Hairline band (0.02 wide) — pin epsilon on
  // hi to dodge the smoothstep(a,a,x) UB on ARM Mali / PowerVR (same
  // discipline as Edge Glow).
  float hi = u_threshold + 0.001;
  float lo = max(0.0, hi - 0.02);
  float edge = smoothstep(lo, hi, mag);

  // Sweep gating: when u_sweep_dir > 0, restrict edge to a moving
  // reveal-window [sweepPhase - revealTrail, sweepPhase] with linear
  // alpha falloff. Direction='all' (dir<0.5) bypasses gating.
  if (u_sweep_dir > 0.5) {
    float p = pointProgress(v_texCoord, u_sweep_dir);
    float dist = u_sweep_phase - p;
    float inWindow = step(0.0, dist) * step(dist, u_reveal_trail);
    float alpha = 1.0 - dist / max(u_reveal_trail, 1e-4);
    edge *= inWindow * clamp(alpha, 0.0, 1.0);
  }

  // Stipple hash gate. cellPx is in main-canvas px space (v_texCoord *
  // u_resolution), so stipple pattern stays visually consistent across
  // quality.scale values.
  edge *= stippleHash(v_texCoord * u_resolution, u_stipple_size);

  edge *= u_intensity;

  // Pre-multiplied alpha output. Transparent everywhere except on the
  // edge — preserves the composed frame underneath when the resulting
  // OffscreenCanvas is drawn back via source-over.
  fragColor = vec4(u_color.rgb * edge, edge * u_color.a);
}`;
