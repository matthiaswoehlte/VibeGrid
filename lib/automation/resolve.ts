import type { AutomationCurve, StaticOrAuto } from './types';

export function isAutomationCurve<T>(p: StaticOrAuto<T>): p is AutomationCurve<T> {
  return (
    typeof p === 'object' &&
    p !== null &&
    (p as AutomationCurve<T>).mode === 'automation' &&
    Array.isArray((p as AutomationCurve<T>).points)
  );
}

export function resolveParam<T>(p: StaticOrAuto<T>, beat: number): T {
  if (!isAutomationCurve(p)) return p;
  const pts = p.points;
  if (pts.length === 0) {
    throw new Error('resolveParam: empty AutomationCurve.points');
  }
  if (pts.length === 1 || beat <= pts[0].beat) return pts[0].value;
  if (beat >= pts[pts.length - 1].beat) return pts[pts.length - 1].value;

  // Find segment containing `beat`. Linear scan — v0.1 curves stay short (< 16 points).
  let i = 0;
  while (i < pts.length - 1 && pts[i + 1].beat <= beat) i++;
  const a = pts[i];
  const b = pts[i + 1];

  if (p.interpolation === 'linear' && typeof a.value === 'number' && typeof b.value === 'number') {
    const t = (beat - a.beat) / (b.beat - a.beat);
    return ((a.value as number) + ((b.value as number) - (a.value as number)) * t) as T;
  }

  // Step fallback — hold a.value until next point.
  return a.value;
}

export function resolveClipParams(
  params: Record<string, unknown>,
  beat: number
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = resolveParam(v as StaticOrAuto<unknown>, beat);
  }
  return out;
}
