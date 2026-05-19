export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label?: string;
}) {
  return (
    <input
      type="range"
      role="slider"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
      onChange={() => undefined}
      className="w-full accent-[var(--a1)]"
    />
  );
}
