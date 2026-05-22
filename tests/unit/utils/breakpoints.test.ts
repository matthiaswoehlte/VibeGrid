import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIsMobile, MOBILE_BREAKPOINT } from '@/lib/utils/breakpoints';

describe('useIsMobile (Plan 5.10)', () => {
  let matchMediaMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    matchMediaMock = vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: matchMediaMock
    });
  });

  it('returns false on a desktop viewport (1024 px)', () => {
    matchMediaMock.mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('returns true on a mobile viewport (375 px)', () => {
    matchMediaMock.mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('subscribes to MediaQueryList change events and unsubscribes on unmount', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    matchMediaMock.mockImplementation(() => ({
      matches: false,
      addEventListener,
      removeEventListener
    }));
    const { unmount } = renderHook(() => useIsMobile());
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('exposes MOBILE_BREAKPOINT = 768', () => {
    expect(MOBILE_BREAKPOINT).toBe(768);
  });
});
