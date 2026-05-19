/**
 * Simplified Canny pipeline:
 *   grayscale → 3×3 Gaussian blur → Sobel gradient magnitude →
 *   binary threshold → 8-connected component extraction →
 *   list of contour paths (point arrays).
 *
 * Non-maximum suppression and hysteresis are intentionally omitted for v0.1 —
 * they refine edge thinness but are not algorithmic blockers. Upgrade path is
 * documented in lib/fx/contour/index.ts.
 */
export interface ContourPath {
  points: Array<[x: number, y: number]>;
  /** Threshold used during extraction — kept on the path so v0.2 can key the
   *  per-bitmap cache by (bitmap, threshold) tuple when threshold becomes
   *  user-configurable. */
  threshold: number;
}

function toGrayscale(img: ImageData): Float32Array {
  const out = new Float32Array(img.width * img.height);
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
    out[j] = (0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]) / 255;
  }
  return out;
}

function blur3x3(gray: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(gray.length);
  const k = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const ksum = 16;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          s += gray[(y + dy) * w + (x + dx)] * k[(dy + 1) * 3 + (dx + 1)];
        }
      }
      out[y * w + x] = s / ksum;
    }
  }
  return out;
}

function sobelMagnitude(blur: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(blur.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const a = blur[(y - 1) * w + (x - 1)];
      const b = blur[(y - 1) * w + x];
      const c = blur[(y - 1) * w + (x + 1)];
      const d = blur[y * w + (x - 1)];
      const f = blur[y * w + (x + 1)];
      const g = blur[(y + 1) * w + (x - 1)];
      const hi = blur[(y + 1) * w + x];
      const i = blur[(y + 1) * w + (x + 1)];
      const gx = c + 2 * f + i - a - 2 * d - g;
      const gy = g + 2 * hi + i - a - 2 * b - c;
      out[y * w + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

function flood(
  mag: Float32Array,
  w: number,
  h: number,
  threshold: number,
  visited: Uint8Array,
  startX: number,
  startY: number
): Array<[number, number]> {
  const path: Array<[number, number]> = [];
  const stack: Array<[number, number]> = [[startX, startY]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const idx = y * w + x;
    if (visited[idx]) continue;
    if (mag[idx] < threshold) continue;
    visited[idx] = 1;
    path.push([x, y]);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    stack.push([x + 1, y + 1], [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1]);
  }
  return path;
}

export function extractContours(img: ImageData, threshold: number): ContourPath[] {
  const { width: w, height: h } = img;
  const gray = toGrayscale(img);
  const blurred = blur3x3(gray, w, h);
  const mag = sobelMagnitude(blurred, w, h);
  const visited = new Uint8Array(w * h);
  const paths: ContourPath[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (visited[idx]) continue;
      if (mag[idx] < threshold) continue;
      const points = flood(mag, w, h, threshold, visited, x, y);
      if (points.length > 4) paths.push({ points, threshold });
    }
  }
  return paths;
}
