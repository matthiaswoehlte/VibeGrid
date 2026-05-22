'use client';
import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT = 768;

/**
 * Returns true when the viewport is at or below the mobile breakpoint.
 * Backed by matchMedia with native event subscription — universally
 * supported since 2018, fires exactly at the breakpoint crossing,
 * costs zero DOM observation overhead.
 *
 * SSR-safe: returns false during server rendering; the effect re-syncs
 * on the first client mount. Components that need SSR-correct
 * visibility from the first paint should use Tailwind's `md:` prefix
 * instead of branching on this hook — see the CSS-first layout
 * strategy in Plan 5.10. This hook is reserved for *behavior*
 * branching (drawer open/close decisions, gating pinch-zoom
 * registration, FX-track picker invocation).
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}
