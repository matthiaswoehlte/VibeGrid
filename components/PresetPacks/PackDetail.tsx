'use client';
import type { PresetPack } from '@/lib/presets/types';
import { applyPackToTimeline } from '@/lib/presets/apply-pack';
import {
  formatBpmReference,
  getProjectBpm
} from '@/lib/presets/store-bridge';
import { FxRow } from './FxRow';

interface PackDetailProps {
  /** Pack with possibly-edited `enabled` flags (toggled by the user
   *  in this component). Parent owns the toggle state. */
  pack: PresetPack;
  /** Called when the user toggles the i-th FX. Parent flips the flag
   *  and re-renders. */
  onToggleFx: (fxIndex: number) => void;
  /** Called when the user clicks "Save current setup as preset...". */
  onSaveCurrent: () => void;
}

/**
 * Plan 9a — right-column pack detail. Renders pack metadata, the
 * FX list with per-FX toggles, and the two action buttons (Apply,
 * Save current setup).
 */
export function PackDetail({
  pack,
  onToggleFx,
  onSaveCurrent
}: PackDetailProps) {
  const fxCount = pack.fx.length;
  const activeCount = pack.fx.filter((f) => f.enabled).length;
  const projectBpm = getProjectBpm();

  return (
    <div className="flex flex-col h-full bg-[var(--surface-1)]">
      <div className="p-4 space-y-3 border-b border-[var(--border)] overflow-y-auto">
        <div className="text-[10px] tracking-wider font-bold text-[var(--text-muted)]">
          {pack.category.toUpperCase()} · {pack.isCurated ? 'CURATED PACK' : 'USER PACK'}{' '}
          · {fxCount} FX
        </div>
        <h2 className="text-xl font-bold text-[var(--text)]">{pack.name}</h2>
        <p className="text-sm text-[var(--text-dim)] leading-relaxed">
          {pack.description}
        </p>
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          <MetaBadge label="Trigger" value="Beat-sync" />
          <MetaBadge label="FX-Count" value={String(fxCount)} />
          <MetaBadge label="Ref. BPM" value={formatBpmReference(pack.bpmReference)} />
          <MetaBadge
            label="Recommended"
            value={`${pack.recommendedBars} bars`}
          />
        </div>
        {pack.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {pack.tags.map((tag) => (
              <span
                key={tag}
                className="text-[9px] font-bold tracking-wider text-[var(--text-dim)] bg-[var(--surface-2)] px-2 py-1 rounded"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        <div className="text-[10px] tracking-wider font-bold text-[var(--text-muted)] flex items-center justify-between">
          <span>FX IN THIS PACK</span>
          <span>
            {fxCount} INCLUDED · {activeCount} ACTIVE
          </span>
        </div>
        {pack.fx.map((entry, i) => (
          <FxRow
            key={`${entry.fxKind}-${i}`}
            entry={entry}
            onToggle={() => onToggleFx(i)}
          />
        ))}
      </div>

      <div className="p-4 border-t border-[var(--border)] space-y-2">
        <div className="text-[10px] text-[var(--text-muted)] flex items-center justify-between">
          <span>Curves will be scaled to your project ({projectBpm} BPM)</span>
          <span>
            {activeCount} of {fxCount} FX active
          </span>
        </div>
        <button
          type="button"
          onClick={() => applyPackToTimeline(pack)}
          disabled={activeCount === 0}
          className="w-full py-2.5 rounded-md bg-[var(--a1)] hover:opacity-90 text-white font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          Apply Pack to Timeline
        </button>
        <button
          type="button"
          onClick={onSaveCurrent}
          className="w-full py-2 rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-dim)] text-xs font-medium transition-colors"
        >
          Save current setup as preset...
        </button>
      </div>
    </div>
  );
}

function MetaBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--surface-2)] px-2 py-1 rounded">
      <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </div>
      <div className="text-xs font-medium text-[var(--text)]">{value}</div>
    </div>
  );
}
