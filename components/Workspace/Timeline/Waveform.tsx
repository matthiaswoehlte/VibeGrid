'use client';

export interface Peaks {
  min: Float32Array;
  max: Float32Array;
}

export function Waveform({
  peaks,
  width = 800,
  height = 48
}: {
  peaks: Peaks | null;
  width?: number;
  height?: number;
}) {
  if (!peaks) return null;
  const n = peaks.min.length;
  const stepX = width / n;
  const mid = height / 2;
  const top = Array.from({ length: n }, (_, i) => `${i * stepX},${mid - peaks.max[i] * mid}`);
  const bot = Array.from({ length: n }, (_, i) => `${(n - 1 - i) * stepX},${mid - peaks.min[n - 1 - i] * mid}`);
  const d = `M ${top.join(' L ')} L ${bot.join(' L ')} Z`;
  return (
    <svg width={width} height={height} className="block">
      <path d={d} fill="var(--a2)" opacity={0.6} />
    </svg>
  );
}
