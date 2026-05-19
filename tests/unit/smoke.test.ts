import { describe, it, expect } from 'vitest';

describe('vitest smoke', () => {
  it('runs in jsdom and arithmetic still works', () => {
    expect(2 + 2).toBe(4);
    expect(typeof window).toBe('object');
  });
});
