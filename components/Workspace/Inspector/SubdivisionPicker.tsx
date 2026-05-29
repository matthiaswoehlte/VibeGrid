'use client';
import {
  TRIGGER_SUBDIVISIONS,
  type TriggerSubdivision
} from '@/lib/timeline/types';

/**
 * Plan 9c — Trigger Subdivision picker.
 *
 * Sechs Buttons (`1×` bis `32×`). Aktiver Button per --a1 highlight.
 * Sichtbarkeit wird vom Inspector-Container gegen `plugin.supportsSubdivision`
 * gegated — diese Komponente nimmt einfach value + onChange und rendert.
 *
 * `1×`-Click und `undefined`-Wert sind semantisch identisch; Container
 * passt das per `clip.triggerSubdivision ?? '1×'` an.
 */
export interface SubdivisionPickerProps {
  value: TriggerSubdivision;
  onChange: (next: TriggerSubdivision) => void;
}

export function SubdivisionPicker({ value, onChange }: SubdivisionPickerProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--text-dim)] flex-1">Trigger Speed</span>
      <div
        className="flex rounded overflow-hidden border border-[var(--border)]"
        role="group"
        aria-label="Trigger Subdivision"
      >
        {TRIGGER_SUBDIVISIONS.map((sub) => {
          const active = sub === value;
          return (
            <button
              key={sub}
              type="button"
              onPointerDown={() => onChange(sub)}
              aria-pressed={active}
              className={
                'px-2 py-1 text-xs ' +
                (active
                  ? 'bg-[var(--a1)] text-white'
                  : 'bg-[var(--surface-2)] text-[var(--text-dim)] hover:text-[var(--text)]')
              }
            >
              {sub}
            </button>
          );
        })}
      </div>
    </div>
  );
}
