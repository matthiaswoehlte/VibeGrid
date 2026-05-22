'use client';
import { useIsMobile } from '@/lib/utils/breakpoints';
import { useAppStore } from '@/lib/store';
import type { MobileTab } from '@/lib/store/mobile-ui-slice';

// z-30 → Z_TABBAR (lib/utils/z-index.ts). Above Stage (z-10) and
// Timeline (z-20), below drawers (z-40/50) and modals (z-60).

const TABS: ReadonlyArray<{ id: MobileTab; label: string; icon: string }> = [
  { id: 'timeline', label: 'Timeline', icon: '≡' },
  { id: 'media', label: 'Media', icon: '⊞' },
  { id: 'fx', label: 'FX', icon: '✦' }
];

/**
 * Mobile-only sticky-bottom navigation: switches between the three
 * primary panels (Timeline / Media / FX) when the viewport is at or
 * below the mobile breakpoint. Pairs with `md:hidden` so the bar is
 * also hidden via CSS for SSR-correct first paint, but the
 * `useIsMobile()` early-return additionally prevents click handlers
 * from firing on Desktop (and satisfies the Anm 10 invariant
 * "renders nothing on desktop").
 */
export function TabBar() {
  const isMobile = useIsMobile();
  const active = useAppStore((s) => s.mobileUI.mobileTab);
  const setTab = useAppStore((s) => s.mobileUIActions.setMobileTab);
  if (!isMobile) return null;
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 h-12 flex bg-[var(--surface-1)] border-t border-[var(--border)] md:hidden"
      aria-label="Mobile navigation"
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={active === t.id}
          aria-label={t.label}
          onClick={() => setTab(t.id)}
          className={
            'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] uppercase tracking-wider transition-colors ' +
            (active === t.id
              ? 'text-[var(--a1)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text)]')
          }
        >
          <span className="text-base leading-none" aria-hidden>
            {t.icon}
          </span>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
