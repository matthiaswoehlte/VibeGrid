import { describe, it, expect } from 'vitest';
import { formatParamValue } from '@/lib/fx/format-param-value';
import type { ParamSchema } from '@/lib/renderer/types';

type SliderSchema = Extract<ParamSchema[string], { kind: 'slider' }>;

const num = (step: number, unit?: string): SliderSchema => ({
  kind: 'slider',
  label: 'X',
  min: 0,
  max: 1,
  step,
  default: 0,
  unit
});

describe('formatParamValue (Plan 9c)', () => {
  it('appends the unit and rounds to 1 decimal when schema.unit is set', () => {
    expect(formatParamValue(0.8, num(0.01, 'beats'))).toBe('0.8 beats');
    expect(formatParamValue(45, num(1, '°'))).toBe('45.0 °');
  });

  it('rounds integer sliders (step >= 1) without decimals', () => {
    expect(formatParamValue(7.4, num(1))).toBe('7');
    expect(formatParamValue(8.0, num(1))).toBe('8');
  });

  it('uses three decimals for very small absolute values (<0.01)', () => {
    expect(formatParamValue(0.005, num(0.001))).toBe('0.005');
    expect(formatParamValue(-0.003, num(0.001))).toBe('-0.003');
  });

  it('uses two decimals for |x| < 1 (the common slider range)', () => {
    expect(formatParamValue(0.8, num(0.01))).toBe('0.80');
    expect(formatParamValue(-0.5, num(0.05))).toBe('-0.50');
  });

  it('uses one decimal for |x| ≥ 1', () => {
    expect(formatParamValue(1.5, num(0.1))).toBe('1.5');
    expect(formatParamValue(12.345, num(0.1))).toBe('12.3');
  });
});
