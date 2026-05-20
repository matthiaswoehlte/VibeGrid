'use client';
import type { WaveformPeaks } from '@/lib/audio/peaks';

export function Waveform({
  peaks,
  width = 800,
  height = 32
}: {
  peaks: WaveformPeaks | null;
  width?: number;
  height?: number;
}) {
  if (!peaks || peaks.length === 0) return null;
  const n = peaks.length;
  const stepX = width / n;
  const mid = height / 2;
  const top = peaks.map(([, max], i) => `${i * stepX},${mid - max * mid}`);
  const bot = [...peaks]
    .reverse()
    .map(([min], j) => `${(n - 1 - j) * stepX},${mid - min * mid}`);
  const d = `M ${top.join(' L ')} L ${bot.join(' L ')} Z`;
  return (
    <svg width={width} height={height} className="block" aria-label="audio waveform">
      <path d={d} fill="var(--a2)" opacity={0.5} />
    </svg>
  );
}
