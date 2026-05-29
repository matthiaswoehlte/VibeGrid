import { describe, it, expect } from 'vitest';
import {
  SUBDIVISION_MULTIPLIERS,
  TRIGGER_SUBDIVISIONS
} from '@/lib/timeline/types';

describe('TriggerSubdivision (Plan 9c)', () => {
  it('SUBDIVISION_MULTIPLIERS maps each label to a power of two', () => {
    expect(SUBDIVISION_MULTIPLIERS).toEqual({
      '1×': 1,
      '2×': 2,
      '4×': 4,
      '8×': 8,
      '16×': 16
    });
  });

  it('TRIGGER_SUBDIVISIONS keeps insertion order from 1× to 16×', () => {
    expect(TRIGGER_SUBDIVISIONS).toEqual(['1×', '2×', '4×', '8×', '16×']);
  });

  it('does not include 32× (cut for Apple/Google strobe guidelines)', () => {
    expect(TRIGGER_SUBDIVISIONS as readonly string[]).not.toContain('32×');
  });
});
