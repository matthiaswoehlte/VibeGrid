'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BUILT_IN_PACKS } from '@/lib/presets/built-in-packs';
import {
  captureTimelineAsPreset,
  getUserPresets,
  saveUserPreset
} from '@/lib/presets/save-as-preset';
import { getProjectBpm } from '@/lib/presets/store-bridge';
import type { PresetPack, PresetPackCategory } from '@/lib/presets/types';
import { PackList } from './PackList';
import { PackDetail } from './PackDetail';
import {
  PackSearchAndFilter,
  type FilterCategory
} from './PackSearchAndFilter';

interface PresetPackBrowserProps {
  open: boolean;
  onClose: () => void;
}

const ALL_CATEGORIES: PresetPackCategory[] = [
  'Drop',
  'Build-Up',
  'Verse',
  'Outro',
  'Any'
];

/**
 * Plan 9a — slide-in pack browser. Slides over the right side of the
 * stage (not modal, no layout shift). Holds local toggle state per
 * pack-entry; applying a pack reads the current toggle snapshot.
 *
 * Escape closes the panel. Re-opening preserves the toggle state for
 * the session (held in `packEdits`); a full page reload resets it.
 */
export function PresetPackBrowser({ open, onClose }: PresetPackBrowserProps) {
  const projectBpm = getProjectBpm();
  const [userPacks, setUserPacks] = useState<PresetPack[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FilterCategory>('All');
  const [selectedId, setSelectedId] = useState<string | null>(
    BUILT_IN_PACKS[0]?.id ?? null
  );
  // Local toggle overrides — keyed by `${packId}:${fxIndex}`.
  const [toggleOverrides, setToggleOverrides] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (open) setUserPacks(getUserPresets());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Merge built-in + user packs with toggle overrides applied.
  const allPacks = useMemo<PresetPack[]>(() => {
    const merged = [...BUILT_IN_PACKS, ...userPacks];
    return merged.map((pack) => ({
      ...pack,
      fx: pack.fx.map((entry, i) => {
        const key = `${pack.id}:${i}`;
        return key in toggleOverrides
          ? { ...entry, enabled: toggleOverrides[key] }
          : entry;
      })
    }));
  }, [userPacks, toggleOverrides]);

  // Apply search filter first, then derive per-category counts from the
  // search-filtered set (matches the way users read the count badges).
  const searchedPacks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return allPacks;
    return allPacks.filter((p) => {
      const hay = `${p.name} ${p.description} ${p.tags.join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [allPacks, query]);

  const categoryCounts = useMemo(() => {
    const counts: Record<FilterCategory, number> = {
      All: searchedPacks.length,
      Drop: 0,
      'Build-Up': 0,
      Verse: 0,
      Outro: 0
    };
    for (const p of searchedPacks) {
      if (ALL_CATEGORIES.includes(p.category)) {
        // 'Any' category isn't in the filter tabs — skip silently.
        if (p.category in counts) {
          counts[p.category as FilterCategory] += 1;
        }
      }
    }
    return counts;
  }, [searchedPacks]);

  const filteredPacks = useMemo(() => {
    if (category === 'All') return searchedPacks;
    return searchedPacks.filter((p) => p.category === category);
  }, [searchedPacks, category]);

  const selectedPack = useMemo(
    () => allPacks.find((p) => p.id === selectedId) ?? allPacks[0] ?? null,
    [allPacks, selectedId]
  );

  const toggleFx = useCallback(
    (packId: string, fxIndex: number, currentEnabled: boolean) => {
      setToggleOverrides((prev) => ({
        ...prev,
        [`${packId}:${fxIndex}`]: !currentEnabled
      }));
    },
    []
  );

  const handleSaveCurrent = useCallback(() => {
    const name = typeof window !== 'undefined'
      ? window.prompt('Name your preset:')
      : null;
    if (!name) return;
    const pack = captureTimelineAsPreset(projectBpm, name, 'Drop');
    if (pack.fx.length === 0) {
      toast.error('No FX clips on timeline to save', {
        description: 'Add at least one FX clip before saving as a preset.'
      });
      return;
    }
    saveUserPreset(pack);
    setUserPacks(getUserPresets());
    toast.success(`Saved "${name}" as user preset`);
  }, [projectBpm]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Preset Packs"
    >
      <button
        type="button"
        aria-label="Close preset browser"
        className="flex-1 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="w-[640px] max-w-full bg-[var(--surface-1)] border-l border-[var(--border)] flex shadow-2xl">
        <div className="w-[280px] shrink-0 flex flex-col border-r border-[var(--border)]">
          <div className="px-3 py-3 border-b border-[var(--border)] flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold text-[var(--text)]">
                Preset Packs
              </h2>
              <div className="text-[10px] tracking-wider font-bold text-[var(--text-muted)] mt-0.5">
                BEAT-SYNC · FX BUNDLES
              </div>
            </div>
            <div
              className="flex items-center gap-1.5 text-xs text-[var(--text-dim)]"
              title="Current project BPM"
            >
              <span className="w-2 h-2 rounded-full bg-green-400" />
              {projectBpm} BPM
            </div>
          </div>
          <PackSearchAndFilter
            totalPackCount={allPacks.length}
            query={query}
            onQueryChange={setQuery}
            activeCategory={category}
            onCategoryChange={setCategory}
            categoryCounts={categoryCounts}
          />
          <PackList
            packs={filteredPacks}
            projectBpm={projectBpm}
            selectedId={selectedPack?.id ?? null}
            onSelect={setSelectedId}
          />
        </div>
        <div className="flex-1 min-w-0 flex flex-col relative">
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute top-3 right-3 z-10 w-7 h-7 rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-dim)] text-lg leading-none"
          >
            ×
          </button>
          {selectedPack ? (
            <PackDetail
              pack={selectedPack}
              onToggleFx={(i) =>
                toggleFx(selectedPack.id, i, selectedPack.fx[i].enabled)
              }
              onSaveCurrent={handleSaveCurrent}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-muted)]">
              No pack selected.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
