'use client';
import type { PresetPack } from '@/lib/presets/types';
import { PackCard } from './PackCard';

interface PackListProps {
  packs: PresetPack[];
  projectBpm: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Plan 9a — scrollable list of pack-cards in the left column. Pure
 * presentation; filtering / sorting happens in the parent
 * `PresetPackBrowser` before this component sees the list.
 */
export function PackList({
  packs,
  projectBpm,
  selectedId,
  onSelect
}: PackListProps) {
  if (packs.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-[var(--text-muted)]">
        No packs match the current filter.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 p-3 overflow-y-auto flex-1">
      {packs.map((pack) => (
        <PackCard
          key={pack.id}
          pack={pack}
          projectBpm={projectBpm}
          active={pack.id === selectedId}
          onSelect={() => onSelect(pack.id)}
        />
      ))}
    </div>
  );
}
