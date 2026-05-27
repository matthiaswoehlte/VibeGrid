'use client';
import {
  FX_CLIP_COLORS,
  PLUGIN_KIND_TO_TRACK_KIND
} from '@/lib/timeline/plugin-mapping';
import type { PresetPack } from '@/lib/presets/types';
import { formatBpmReference } from '@/lib/presets/store-bridge';

interface PackCardProps {
  pack: PresetPack;
  /** Current project BPM — drives the BPM-mismatch badge. */
  projectBpm: number;
  /** True when this pack is the active selection (left purple accent). */
  active: boolean;
  onSelect: () => void;
}

/**
 * Plan 9a — pack browser left-column card. Shows pack name, FX count,
 * BPM reference, a color-dot strip per FX, and a Preview button (v0.1
 * disabled). When the project BPM falls outside `pack.bpmRange`, the
 * BPM badge turns orange and offers a tooltip explaining the mismatch.
 */
export function PackCard({ pack, projectBpm, active, onSelect }: PackCardProps) {
  const fxCount = pack.fx.length;
  const enabledCount = pack.fx.filter((f) => f.enabled).length;
  const bpmMatch =
    !pack.bpmRange ||
    (projectBpm >= pack.bpmRange[0] && projectBpm <= pack.bpmRange[1]);
  const bpmTooltip = bpmMatch
    ? undefined
    : `This pack is designed for ${pack.bpmRange![0]}–${pack.bpmRange![1]} BPM. ` +
      `Your project is ${projectBpm} BPM. The pack still works — beats will feel ` +
      (projectBpm < pack.bpmRange![0] ? 'slower.' : 'faster.');

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'w-full text-left rounded-md border bg-[var(--surface-2)] hover:bg-[var(--surface-3)]',
        'transition-colors p-3 relative',
        active
          ? 'border-[var(--a1)] border-l-4 pl-[10px]'
          : 'border-[var(--border)]'
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--text)] truncate">
              {pack.name}
            </span>
            {pack.isNew ? (
              <span className="text-[9px] font-bold bg-[var(--a1)] text-white px-1.5 py-0.5 rounded">
                NEW
              </span>
            ) : null}
          </div>
          <div className="text-xs text-[var(--text-dim)] mt-0.5 flex items-center gap-1">
            <span>
              {fxCount} FX · {enabledCount} active
            </span>
            <span>·</span>
            <span
              className={
                bpmMatch
                  ? 'text-[var(--text-dim)]'
                  : 'text-orange-400 font-medium'
              }
              title={bpmTooltip}
            >
              {formatBpmReference(pack.bpmReference)}
            </span>
          </div>
        </div>
        <button
          type="button"
          disabled
          title="Preview coming soon"
          aria-label="Preview (coming soon)"
          className="text-[var(--text-muted)] opacity-50 cursor-not-allowed text-lg leading-none"
          onClick={(e) => e.stopPropagation()}
        >
          ▶
        </button>
      </div>
      <div className="flex gap-1 mt-2">
        {pack.fx.map((entry, i) => {
          const trackKind = PLUGIN_KIND_TO_TRACK_KIND[entry.fxKind];
          const color = FX_CLIP_COLORS[trackKind] ?? '#a86bff';
          return (
            <span
              key={i}
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: color,
                opacity: entry.enabled ? 1 : 0.3
              }}
              aria-hidden
            />
          );
        })}
      </div>
    </button>
  );
}
