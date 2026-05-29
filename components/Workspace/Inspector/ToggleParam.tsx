'use client';

/**
 * Plan 9c — generic `kind: 'toggle'` param renderer.
 *
 * 2-button group (`offLabel` / `onLabel`), --a1 highlight on active.
 * Generisch über alle Boolean-Params — Beat Sync ist heute der erste
 * Konsument (Inspector passt Custom-Labels "Always On" / "Beat Pulse"
 * an, semantisch passend zur Render-Logik), künftige Toggle-Params
 * (mute, locked, visible…) nutzen dieselbe Komponente ohne neue Datei
 * und ohne Custom-Labels (Default "Off" / "On").
 *
 * `onPointerDown` statt `onClick` per CLAUDE.md Regel 3.
 */
export interface ToggleParamProps {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  /** Optional custom labels (Inspector passes "Beat Pulse"/"Always On"
   *  for beatSync — App-Store-friendly framing of the toggle states). */
  offLabel?: string;
  onLabel?: string;
}

export function ToggleParam({
  label,
  value,
  onChange,
  offLabel = 'Off',
  onLabel = 'On'
}: ToggleParamProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--text-dim)] flex-1">{label}</span>
      <div
        className="flex rounded overflow-hidden border border-[var(--border)]"
        role="group"
        aria-label={label}
      >
        <button
          type="button"
          onPointerDown={() => onChange(false)}
          aria-pressed={!value}
          className={
            'px-3 py-1 text-xs ' +
            (!value
              ? 'bg-[var(--a1)] text-white'
              : 'bg-[var(--surface-2)] text-[var(--text-dim)] hover:text-[var(--text)]')
          }
        >
          {offLabel}
        </button>
        <button
          type="button"
          onPointerDown={() => onChange(true)}
          aria-pressed={value}
          className={
            'px-3 py-1 text-xs ' +
            (value
              ? 'bg-[var(--a1)] text-white'
              : 'bg-[var(--surface-2)] text-[var(--text-dim)] hover:text-[var(--text)]')
          }
        >
          {onLabel}
        </button>
      </div>
    </div>
  );
}
