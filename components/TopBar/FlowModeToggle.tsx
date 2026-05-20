'use client';
import { useAppStore } from '@/lib/store';

/**
 * Global Beat ↔ Flow toggle. Lives in the TopBar between RecIndicator
 * and ClearProjectButton so it's always visible regardless of which clip
 * is selected. Teal (--a3) when active — bewusst anders als Selection
 * (--a1) und Automation Points (--a2). Transient state: a page reload
 * brings the user back to Beat Mode.
 */
export function FlowModeToggle() {
  const flowMode = useAppStore((s) => s.ui.flowMode);
  const setFlowMode = useAppStore((s) => s.setFlowMode);
  return (
    <button
      type="button"
      aria-pressed={flowMode}
      onClick={() => setFlowMode(!flowMode)}
      title={
        flowMode
          ? 'Flow Mode — klick für Beat Mode'
          : 'Beat Mode — klick für Flow Mode'
      }
      className={`px-3 h-7 rounded text-xs font-medium transition-colors ${
        flowMode
          ? 'bg-[var(--a3)] text-[var(--bg)]'
          : 'bg-[var(--surface-3)] text-[var(--text-dim)] hover:text-[var(--text)]'
      }`}
    >
      {flowMode ? '〜 Flow' : '♩ Beat'}
    </button>
  );
}
