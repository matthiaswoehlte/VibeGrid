'use client';

// `'Any'` is intentionally excluded — it's a per-pack tempo flag, not
// a filter tab. Tempo-independent packs still surface under their
// content category (e.g. Outro).
export type FilterCategory = 'All' | 'Drop' | 'Build-Up' | 'Verse' | 'Outro';

const ORDERED_CATEGORIES: FilterCategory[] = [
  'All',
  'Drop',
  'Build-Up',
  'Verse',
  'Outro'
];

interface PackSearchAndFilterProps {
  /** Total pack count including user-presets — for the placeholder. */
  totalPackCount: number;
  query: string;
  onQueryChange: (v: string) => void;
  activeCategory: FilterCategory;
  onCategoryChange: (c: FilterCategory) => void;
  /** Map: category → count (after search-filter but before category-filter). */
  categoryCounts: Record<FilterCategory, number>;
}

/**
 * Plan 9a — left-column search + category tabs above the pack list.
 * Placeholder is dynamic (`Search N packs...`) so users see the total
 * including any saved user-presets.
 */
export function PackSearchAndFilter({
  totalPackCount,
  query,
  onQueryChange,
  activeCategory,
  onCategoryChange,
  categoryCounts
}: PackSearchAndFilterProps) {
  return (
    <div className="space-y-2 px-3 py-2 border-b border-[var(--border)]">
      <input
        type="search"
        placeholder={`Search ${totalPackCount} packs...`}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-md px-3 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--a1)]"
        aria-label={`Search ${totalPackCount} packs`}
      />
      <div className="flex flex-wrap gap-1 text-xs">
        {ORDERED_CATEGORIES.map((cat) => {
          const count = categoryCounts[cat] ?? 0;
          const active = cat === activeCategory;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => onCategoryChange(cat)}
              className={[
                'px-2 py-1 rounded-md transition-colors',
                active
                  ? 'bg-[var(--a1)] text-white'
                  : 'bg-[var(--surface-2)] text-[var(--text-dim)] hover:bg-[var(--surface-3)]'
              ].join(' ')}
            >
              {cat} · {count}
            </button>
          );
        })}
      </div>
    </div>
  );
}
