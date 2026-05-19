export function SelectControl({
  value,
  options,
  onChange,
  label
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-md px-2 h-8 text-sm"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
