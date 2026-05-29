import type { ParamSchema } from '@/lib/renderer/types';

type SliderSchema = Extract<ParamSchema[string], { kind: 'slider' }>;

/** Plan 9c — render a slider's numeric value as a short display string.
 *  Picks decimals + unit so `tabular-nums` stays stable mid-drag:
 *   - `unit` set (e.g. `'beats'`, `'°'`)   → `0.8 beats`
 *   - integer slider (`step >= 1`)         → `8`
 *   - very small |x| < 0.01                → `0.005`
 *   - |x| < 1                              → `0.80`
 *   - everything else                      → `1.5`
 */
export function formatParamValue(value: number, schema: SliderSchema): string {
  if (schema.unit) return `${value.toFixed(1)} ${schema.unit}`;
  if (schema.step >= 1) return `${Math.round(value)}`;
  if (Math.abs(value) < 0.01) return value.toFixed(3);
  if (Math.abs(value) < 1) return value.toFixed(2);
  return value.toFixed(1);
}
