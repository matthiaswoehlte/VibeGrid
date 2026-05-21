/**
 * Plan 5.8a — pure color helpers for Sunray (rgba gradient stops) and
 * Text 3D extrusion (darkening for layer stacking).
 *
 * `hex` is always the 6-digit `#rrggbb` form. Short hex (`#fff`) is
 * intentionally NOT supported — every paramSchema default uses the
 * 6-digit form; rejecting short hex makes invalid input show up early.
 *
 * Both functions are pure: same input → same output. Tested.
 */

const HEX_FULL_RE = /^#([0-9a-fA-F]{6})$/;

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = HEX_FULL_RE.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return {
    r: (n >> 16) & 0xff,
    g: (n >> 8) & 0xff,
    b: n & 0xff
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHexByte(n: number): string {
  return clampByte(n).toString(16).padStart(2, '0');
}

/**
 * `hexToRgba('#ff8800', 0.5)` → `'rgba(255, 136, 0, 0.5)'`.
 *
 * Invalid hex falls back to fully-opaque magenta (`'rgba(255, 0, 255, 1)'`)
 * so the bug stands out visually rather than silently rendering nothing.
 * Alpha is clamped to [0, 1].
 */
export function hexToRgba(hex: string, alpha: number): string {
  const a = clamp01(alpha);
  const rgb = parseHex(hex);
  if (!rgb) return `rgba(255, 0, 255, ${a})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

/**
 * `darken('#ff8800', 0.5)` → 50% darker, returned as 6-digit hex.
 *
 * `factor` is the **fraction to remove**: 0 = unchanged, 1 = pure black.
 * Linear in RGB space — fast, predictable, good enough for the Text 3D
 * extrusion layer stack. Invalid hex falls back to `#ff00ff`.
 */
export function darken(hex: string, factor: number): string {
  const f = clamp01(factor);
  const rgb = parseHex(hex);
  if (!rgb) return '#ff00ff';
  const k = 1 - f;
  return `#${toHexByte(rgb.r * k)}${toHexByte(rgb.g * k)}${toHexByte(rgb.b * k)}`;
}
