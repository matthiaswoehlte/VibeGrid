'use client';
import { useEffect } from 'react';
import type { AutomationSnap } from '@/lib/automation/snap';
import { useAppStore } from '@/lib/store';

const LS_KEY = 'vg_clip_snap';

const OPTIONS: AutomationSnap[] = [
  '1',
  '1/2',
  '1/4',
  '1/8',
  '1/16',
  '1/32',
  'off'
];
const LABEL: Record<AutomationSnap, string> = {
  '1': '1',
  '1/2': '½',
  '1/4': '¼',
  '1/8': '⅛',
  '1/16': '¹⁄₁₆',
  '1/32': '¹⁄₃₂',
  off: 'Off'
};

/**
 * Plan 8f.1 follow-up / Plan 9b follow-up — global Clip-Snap selector.
 * Sets the beat-grid resolution that drop + drag + group-move + Shift+
 * Arrow operations snap to. State lives in the zustand store
 * (`ui.clipSnap`) so subscribers (Tracks.tsx, Ruler.tsx grid-background)
 * react instantly. localStorage `vg_clip_snap` is the persistence layer:
 * read once on mount, written on every change.
 *
 * Mount point: Timeline-toolbar (above the Gantt area), via Toolbar.tsx.
 */
export function readClipSnap(): AutomationSnap {
  return useAppStore.getState().ui.clipSnap;
}

export function ClipSnapPicker() {
  const snap = useAppStore((s) => s.ui.clipSnap);
  const setSnap = useAppStore((s) => s.setClipSnap);

  // Sync localStorage → store once on mount (covers reloads).
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    const stored = localStorage.getItem(LS_KEY) as AutomationSnap | null;
    if (stored && OPTIONS.includes(stored) && stored !== snap) {
      setSnap(stored);
    }
    // Empty deps: run only on mount. Subsequent picker changes write
    // localStorage via onChange below, so no resync needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value as AutomationSnap;
    setSnap(v);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_KEY, v);
    }
  };

  return (
    <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-dim)] font-mono">
      <span>Snap</span>
      <select
        aria-label="Clip snap resolution"
        value={snap}
        onChange={onChange}
        className="bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text)] px-1.5 py-0.5 rounded border border-[var(--border)] cursor-pointer transition-colors"
      >
        {OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {LABEL[opt]}
          </option>
        ))}
      </select>
    </label>
  );
}
