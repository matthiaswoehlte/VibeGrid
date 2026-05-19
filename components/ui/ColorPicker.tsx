export function ColorPicker({
  value,
  onChange,
  label,
  palette
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  palette?: string[];
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={label}
        value={value}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        onChange={() => undefined}
        className="h-7 w-9 cursor-pointer rounded bg-transparent"
      />
      {palette && (
        <div className="flex gap-1">
          {palette.map((p) => (
            <button
              key={p}
              type="button"
              aria-label={`Palette ${p}`}
              onClick={() => onChange(p)}
              className="h-5 w-5 rounded-sm border border-[var(--border)]"
              style={{ background: p }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
