import { describe, it, expect } from 'vitest';
import { validateAgainstParamSchema } from '@/lib/ai/schema-validator';
import type { ParamSchema } from '@/lib/renderer/types';

const schema: ParamSchema = {
  intensity: { kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, label: 'I' },
  color: { kind: 'color', default: '#ffffff', label: 'C' },
  mode: {
    kind: 'select',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' }
    ],
    default: 'a',
    label: 'M'
  },
  on: { kind: 'toggle', default: false, label: 'O' }
};

describe('validateAgainstParamSchema', () => {
  it('clamps slider value above max', () => {
    const r = validateAgainstParamSchema({ intensity: 2 }, schema);
    expect(r.intensity).toBe(1);
  });
  it('clamps slider value below min', () => {
    const r = validateAgainstParamSchema({ intensity: -5 }, schema);
    expect(r.intensity).toBe(0);
  });
  it('snaps slider to step', () => {
    const r = validateAgainstParamSchema({ intensity: 0.51 }, schema);
    expect(r.intensity).toBeCloseTo(0.5);
  });
  it('accepts valid hex color', () => {
    const r = validateAgainstParamSchema({ color: '#abcdef' }, schema);
    expect(r.color).toBe('#abcdef');
  });
  it('rejects invalid hex color → falls back to default', () => {
    const r = validateAgainstParamSchema({ color: 'red' }, schema);
    expect(r.color).toBe('#ffffff');
  });
  it('select value must match an option', () => {
    const r = validateAgainstParamSchema({ mode: 'b' }, schema);
    expect(r.mode).toBe('b');
    const r2 = validateAgainstParamSchema({ mode: 'z' }, schema);
    expect(r2.mode).toBe('a');
  });
  it('toggle coerces truthy/falsy to boolean', () => {
    expect(validateAgainstParamSchema({ on: 1 }, schema).on).toBe(true);
    expect(validateAgainstParamSchema({ on: 0 }, schema).on).toBe(false);
  });
  it('missing key gets default', () => {
    const r = validateAgainstParamSchema({}, schema);
    expect(r.intensity).toBe(0.5);
    expect(r.color).toBe('#ffffff');
    expect(r.mode).toBe('a');
    expect(r.on).toBe(false);
  });
  it('extra keys are dropped', () => {
    const r = validateAgainstParamSchema({ intensity: 0.5, junk: 'x' }, schema);
    expect((r as Record<string, unknown>).junk).toBeUndefined();
  });
});
