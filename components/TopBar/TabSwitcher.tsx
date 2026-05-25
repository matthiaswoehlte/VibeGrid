'use client';
import { usePathname, useRouter } from 'next/navigation';
import type { Route } from 'next';
import { useAppStore } from '@/lib/store';
import type { AppMode } from '@/lib/store/app-mode-slice';

// experimental.typedRoutes is on (next.config.mjs) — href must be a
// known Route literal. The /storyboard route was added at app/storyboard/.
const TABS: ReadonlyArray<{ mode: AppMode; label: string; href: Route }> = [
  { mode: 'vibegrid', label: 'VibeGrid', href: '/' },
  { mode: 'sceneflow', label: 'SceneFlow', href: '/storyboard' }
];

export function TabSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const appMode = useAppStore((s) => s.appMode);

  // Derive the active tab from the URL when available; fall back to the
  // store so deep links and back/forward stay consistent.
  const urlMode: AppMode | null =
    pathname?.startsWith('/storyboard')
      ? 'sceneflow'
      : pathname === '/'
        ? 'vibegrid'
        : null;
  const active = urlMode ?? appMode;

  return (
    <div className="flex items-center gap-1 mr-2">
      {TABS.map((t) => {
        const isActive = active === t.mode;
        return (
          <button
            key={t.mode}
            type="button"
            onClick={() => {
              if (pathname !== t.href) router.push(t.href);
            }}
            aria-pressed={isActive}
            className={
              'h-7 px-3 text-xs uppercase tracking-wider rounded transition-colors ' +
              (isActive
                ? 'bg-[var(--a1)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]')
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
