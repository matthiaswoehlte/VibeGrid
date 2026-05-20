import type { AutomationPoint, Interpolation } from '@/lib/automation/types';

interface BuildOpts {
  widthPx: number;
  heightPx: number;
  valueMin: number;
  valueMax: number;
  lengthBeats: number;
}

function project(point: AutomationPoint<number>, o: BuildOpts): { x: number; y: number } {
  const x = (point.beat / o.lengthBeats) * o.widthPx;
  const range = o.valueMax - o.valueMin || 1;
  const norm = (point.value - o.valueMin) / range;
  const y = o.heightPx - norm * o.heightPx;
  return { x, y };
}

export function buildCurvePath(
  points: AutomationPoint<number>[],
  interpolation: Interpolation,
  o: BuildOpts
): string {
  if (points.length === 0) return '';
  const projected = points.map((p) => project(p, o));
  const segs: string[] = [`M ${projected[0].x},${projected[0].y}`];
  for (let i = 1; i < projected.length; i++) {
    const a = projected[i - 1];
    const b = projected[i];
    if (interpolation === 'linear') {
      segs.push(`L ${b.x},${b.y}`);
    } else if (interpolation === 'step') {
      segs.push(`L ${b.x},${a.y}`);
      segs.push(`L ${b.x},${b.y}`);
    } else {
      // easeIn / easeOut → cubic Bezier with control points biased to one end.
      // easeIn: control points pulled toward A → slow start.
      // easeOut: control points pulled toward B → slow finish.
      // The visual SVG curve is cubic while the resolver's math is quadratic;
      // they share the same family of "ease" feel but render slightly different
      // shapes. Intentional — fixing the discrepancy would require a quadratic
      // SVG path (Q-command) at the cost of clearer code.
      const cp1 = interpolation === 'easeIn' ? { x: a.x, y: a.y } : { x: a.x, y: b.y };
      const cp2 = interpolation === 'easeIn' ? { x: b.x, y: a.y } : { x: b.x, y: b.y };
      segs.push(`C ${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${b.x},${b.y}`);
    }
  }
  return segs.join(' ');
}

export function AutomationCurvePath({
  points,
  interpolation,
  widthPx,
  heightPx,
  valueMin,
  valueMax,
  lengthBeats,
  className
}: BuildOpts & {
  points: AutomationPoint<number>[];
  interpolation: Interpolation;
  className?: string;
}) {
  const d = buildCurvePath(points, interpolation, {
    widthPx,
    heightPx,
    valueMin,
    valueMax,
    lengthBeats
  });
  return <path d={d} fill="none" stroke="var(--a2)" strokeWidth={1.5} className={className} />;
}
