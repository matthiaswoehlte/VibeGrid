import { describe, it, expect, vi } from 'vitest';
import { attachDprObserver } from '@/lib/renderer/dpr';

describe('attachDprObserver', () => {
  it('returns an unsubscribe function', () => {
    const canvas = document.createElement('canvas');
    const unsub = attachDprObserver(canvas, () => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('does not invoke onResize before the observer fires (jsdom limitation)', () => {
    const canvas = document.createElement('canvas');
    const onResize = vi.fn();
    const unsub = attachDprObserver(canvas, onResize);
    expect(onResize).not.toHaveBeenCalled();
    unsub();
  });
});
