'use client';
import type { AutomationPoint } from '@/lib/automation/types';

interface MiniCurveProps {
  points: AutomationPoint<number>[];
  /** Hex color — caller resolves via FX_CLIP_COLORS[PLUGIN_KIND_TO_TRACK_KIND[fxKind]]. */
  color: string;
  /** Short uppercase label rendered top-right, e.g. 'ENV', 'PULSE'. */
  label?: string;
  width?: number;
  height?: number;
}

/**
 * Plan 9a — SVG mini preview of an automation curve. The points are
 * normalised to fit the (width, height) box: X spans `[0, lastBeat]`,
 * Y spans `[0, 1]` (inverted because SVG-Y grows downward). With a
 * single point or all-equal beats, the curve degenerates to a flat
 * line at the value's Y — still readable, never blank.
 */
export function MiniCurve({
  points,
  color,
  label,
  width = 88,
  height = 28
}: MiniCurveProps) {
  if (points.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        className="rounded-sm bg-[var(--surface-2)]"
      />
    );
  }

  const beats = points.map((p) => p.beat);
  const values = points.map((p) => p.value);
  const minBeat = Math.min(...beats, 0);
  const maxBeat = Math.max(...beats, minBeat + 0.001);
  const minValue = 0;
  const maxValue = Math.max(1, ...values);
  const beatRange = maxBeat - minBeat || 1;
  const valueRange = maxValue - minValue || 1;

  const padX = 2;
  const padY = 3;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const polyline = points
    .map((p) => {
      const x = padX + ((p.beat - minBeat) / beatRange) * innerW;
      const y = padY + innerH - ((p.value - minValue) / valueRange) * innerH;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      className="rounded-sm bg-[var(--surface-2)]"
      role="img"
      aria-label={label ? `${label} automation curve` : 'automation curve'}
    >
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {label ? (
        <text
          x={width - 4}
          y={9}
          textAnchor="end"
          className="fill-[var(--text-dim)]"
          style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.5 }}
        >
          {label}
        </text>
      ) : null}
    </svg>
  );
}
