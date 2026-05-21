'use client';

/**
 * Single-line text input control — same design tokens as Slider/Toggle.
 * Used by Text FX (Plan 5.8a). Falls back to schema.default when value is
 * not a string.
 */
export function TextInputControl({
  value,
  label,
  maxLength,
  onChange
}: {
  value: string;
  label: string;
  maxLength?: number;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 px-3 py-1 text-xs">
      <span className="text-[var(--text-dim)] uppercase tracking-wider">
        {label}
      </span>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="bg-[var(--surface-2)] text-[var(--text)] rounded px-2 py-1 outline-none border border-[var(--border)] focus:border-[var(--a1)] transition-colors"
      />
    </label>
  );
}
