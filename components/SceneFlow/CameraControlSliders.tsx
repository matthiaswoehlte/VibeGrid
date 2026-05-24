'use client';
import type { CameraControl } from '@/lib/sceneflow/types';

interface Props {
  value: CameraControl;
  onChange(next: CameraControl): void;
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(v: number): void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] text-[var(--text-muted)]">
        {label}:{' '}
        <span className="text-[var(--text)]">
          {value.toFixed(step < 1 ? 1 : 0)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[var(--a1)]"
      />
    </label>
  );
}

export function CameraControlSliders({ value, onChange }: Props) {
  return (
    <div className="space-y-1 bg-[var(--surface-3)] rounded p-2">
      <div className="text-[10px] uppercase text-[var(--text-muted)] tracking-wider">
        Kamera
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Slider
          label="Zoom"
          value={value.zoom}
          min={-5}
          max={5}
          step={0.5}
          onChange={(zoom) => onChange({ ...value, zoom })}
        />
        <Slider
          label="Pan L/R"
          value={value.panX}
          min={-5}
          max={5}
          step={0.5}
          onChange={(panX) => onChange({ ...value, panX })}
        />
        <Slider
          label="Pan U/D"
          value={value.panY}
          min={-5}
          max={5}
          step={0.5}
          onChange={(panY) => onChange({ ...value, panY })}
        />
      </div>
      <Slider
        label="Bewegungsintensität"
        value={value.motionIntensity}
        min={1}
        max={10}
        step={1}
        onChange={(motionIntensity) => onChange({ ...value, motionIntensity })}
      />
    </div>
  );
}
