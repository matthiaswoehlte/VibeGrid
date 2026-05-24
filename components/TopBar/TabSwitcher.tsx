'use client';
import { useAppStore } from '@/lib/store';
import type { AppMode } from '@/lib/store/app-mode-slice';

const TABS: ReadonlyArray<{ mode: AppMode; label: string }> = [
  { mode: 'vibegrid', label: 'VibeGrid' },
  { mode: 'sceneflow', label: 'SceneFlow' }
];

export function TabSwitcher() {
  const appMode = useAppStore((s) => s.appMode);
  const setAppMode = useAppStore((s) => s.setAppMode);
  return (
    <div className="flex items-center gap-1 mr-2">
      {TABS.map((t) => {
        const active = appMode === t.mode;
        return (
          <button
            key={t.mode}
            type="button"
            onClick={() => setAppMode(t.mode)}
            aria-pressed={active}
            className={
              'h-7 px-3 text-xs uppercase tracking-wider rounded transition-colors ' +
              (active
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
