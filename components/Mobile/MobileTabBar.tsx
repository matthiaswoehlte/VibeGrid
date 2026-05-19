'use client';
export function MobileTabBar() {
  return (
    <nav
      aria-label="Mobile tabs"
      className="sm:hidden h-12 fixed bottom-0 inset-x-0 border-t border-[var(--border)] bg-[var(--surface-1)] flex items-center justify-around"
    >
      <button className="text-xs text-[var(--text-dim)]" disabled>
        Stage
      </button>
      <button className="text-xs text-[var(--text-dim)]" disabled>
        Timeline
      </button>
      <button className="text-xs text-[var(--text-dim)]" disabled>
        Inspector
      </button>
    </nav>
  );
}
