export type WaveformPeaks = Array<[min: number, max: number]>;

/**
 * Pure: scan a sample buffer and return `targetCols` (min, max) pairs.
 *
 * The worker and any main-thread fallback share this implementation so the
 * unit tests on the pure function also cover the worker's behavior.
 */
export function downsamplePeaks(data: Float32Array, targetCols: number): WaveformPeaks {
  const peaks: WaveformPeaks = [];
  if (targetCols <= 0) return peaks;
  if (data.length === 0) {
    for (let c = 0; c < targetCols; c++) peaks.push([0, 0]);
    return peaks;
  }
  const samplesPerCol = data.length / targetCols;
  for (let c = 0; c < targetCols; c++) {
    const start = Math.floor(c * samplesPerCol);
    const end = Math.min(data.length, Math.floor((c + 1) * samplesPerCol));
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i++) {
      const s = data[i];
      if (s < min) min = s;
      if (s > max) max = s;
    }
    peaks.push([min, max]);
  }
  return peaks;
}
