import type { AutomationCurve, AutomationPoint, Interpolation } from './types';

export function sortPoints<T>(points: AutomationPoint<T>[]): AutomationPoint<T>[] {
  return points.slice().sort((a, b) => a.beat - b.beat);
}

export function addPoint<T>(
  curve: AutomationCurve<T>,
  point: AutomationPoint<T>
): AutomationCurve<T> {
  return { ...curve, points: sortPoints([...curve.points, point]) };
}

export function removePoint<T>(
  curve: AutomationCurve<T>,
  index: number
): AutomationCurve<T> {
  if (index < 0 || index >= curve.points.length) return curve;
  const next = curve.points.slice();
  next.splice(index, 1);
  return { ...curve, points: next };
}

export function updatePoint<T>(
  curve: AutomationCurve<T>,
  index: number,
  patch: Partial<AutomationPoint<T>>
): AutomationCurve<T> {
  if (index < 0 || index >= curve.points.length) return curve;
  const next = curve.points.slice();
  next[index] = { ...next[index], ...patch };
  return { ...curve, points: sortPoints(next) };
}

export function makeCurve<T>(
  initial: T,
  beat: number,
  interpolation: Interpolation = 'linear'
): AutomationCurve<T> {
  return {
    mode: 'automation',
    interpolation,
    points: [{ beat, value: initial }]
  };
}

export function toStaticValue<T>(curve: AutomationCurve<T>): T {
  if (curve.points.length === 0) {
    throw new Error('toStaticValue: empty AutomationCurve.points');
  }
  return curve.points[0].value;
}
