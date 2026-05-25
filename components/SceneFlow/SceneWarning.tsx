'use client';
import type { SceneWarning as SceneWarningType } from '@/lib/sceneflow/validation';

const COLOR: Record<SceneWarningType['level'], string> = {
  block: 'bg-red-500/15 text-red-300 border-red-500/30',
  warn: 'bg-amber-500/10 text-amber-200 border-amber-500/30'
};

const SYMBOL: Record<SceneWarningType['level'], string> = {
  block: '🔴',
  warn: '🟡'
};

export function SceneWarningList({ warnings }: { warnings: SceneWarningType[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="space-y-1">
      {warnings.map((w, i) => (
        <li
          key={`${w.sceneId}-${w.code}-${i}`}
          className={`text-[11px] px-2 py-1 rounded border ${COLOR[w.level]}`}
        >
          <span className="mr-1">{SYMBOL[w.level]}</span>
          {w.message}
        </li>
      ))}
    </ul>
  );
}
