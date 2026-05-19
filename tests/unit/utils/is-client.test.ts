import { describe, it, expect } from 'vitest';
import { isClient } from '@/lib/utils/is-client';

describe('isClient', () => {
  it('returns true in jsdom environment (window is defined)', () => {
    expect(isClient()).toBe(true);
  });
});
