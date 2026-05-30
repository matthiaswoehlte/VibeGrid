'use client';
import { useAppStore } from '@/lib/store';

/**
 * Plan 9c.2 T5 — metronome on/off toggle. Lives in the TopBar next to
 * BPMBadge — the metronome is BPM's auditory companion. Amber (--a-orange
 * fallback → Tailwind amber) when active so it's visually distinct from
 * FlowModeToggle (teal --a3) and Selection (purple --a1).
 *
 * State persists across reloads (stored in ui.metronomeEnabled via
 * toPersistedShape). Active colour: orange-400 to match the "metronome
 * pendulum" semantic.
 */
export function MetronomeToggle() {
  const metronomeEnabled = useAppStore((s) => s.ui.metronomeEnabled);
  const toggleMetronome = useAppStore((s) => s.toggleMetronome);
  return (
    <button
      type="button"
      aria-pressed={metronomeEnabled}
      onClick={() => toggleMetronome()}
      title={
        metronomeEnabled
          ? 'Metronom AN — klick zum Ausschalten'
          : 'Metronom AUS — klick zum Einschalten'
      }
      className={`px-3 h-11 md:h-7 rounded text-sm md:text-xs font-medium transition-colors ${
        metronomeEnabled
          ? 'bg-orange-500 text-white'
          : 'bg-[var(--surface-3)] text-[var(--text-dim)] hover:text-[var(--text)]'
      }`}
    >
      {/* Mobile: glyph only. Desktop: glyph + label. */}
      <span aria-hidden>♩</span>
      <span className="hidden md:inline"> {metronomeEnabled ? 'Metro' : 'Metro'}</span>
    </button>
  );
}
