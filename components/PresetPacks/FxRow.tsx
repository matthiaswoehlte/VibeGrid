'use client';
import {
  FX_CLIP_COLORS,
  PLUGIN_KIND_TO_TRACK_KIND
} from '@/lib/timeline/plugin-mapping';
import type { FxPresetEntry } from '@/lib/presets/types';
import { MiniCurve } from './MiniCurve';

interface FxRowProps {
  entry: FxPresetEntry;
  onToggle: () => void;
}

/**
 * Plan 9a — a single FX row in the pack-detail view. Shows the FX's
 * color-dot, display label, MiniCurve of its primary automated param,
 * a disabled Preview button (v0.1) and an enable-toggle that flips
 * the local pack state.
 */
export function FxRow({ entry, onToggle }: FxRowProps) {
  const trackKind = PLUGIN_KIND_TO_TRACK_KIND[entry.fxKind];
  const color = FX_CLIP_COLORS[trackKind] ?? '#a86bff';

  // Pick the first param that has automation points for the MiniCurve.
  const curveEntries = Object.entries(entry.automationCurves);
  const primaryCurve = curveEntries[0]?.[1] ?? [];

  return (
    <div
      className={[
        'flex items-center gap-3 px-3 py-2 rounded-md border border-[var(--border)]',
        'bg-[var(--surface-2)] transition-opacity',
        entry.enabled ? 'opacity-100' : 'opacity-50'
      ].join(' ')}
    >
      <span
        className="w-3 h-3 rounded-full shrink-0"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[var(--text)] truncate">
          {entry.fxKind}
        </div>
        <div className="text-xs text-[var(--text-dim)] truncate">
          {entry.displayLabel}
        </div>
      </div>
      <MiniCurve points={primaryCurve} color={color} label={entry.curveLabel} />
      <button
        type="button"
        disabled
        title="Preview coming soon"
        aria-label="Preview (coming soon)"
        className="text-[var(--text-muted)] opacity-50 cursor-not-allowed text-lg leading-none shrink-0"
      >
        ▶
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={entry.enabled}
        aria-label={`Toggle ${entry.fxKind}`}
        onClick={onToggle}
        className={[
          'relative w-9 h-5 rounded-full transition-colors shrink-0',
          entry.enabled ? 'bg-[var(--a1)]' : 'bg-[var(--surface-3)]'
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all',
            entry.enabled ? 'left-[18px]' : 'left-0.5'
          ].join(' ')}
        />
      </button>
    </div>
  );
}
