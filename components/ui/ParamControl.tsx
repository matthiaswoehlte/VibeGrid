import type { ParamType } from '@/lib/renderer/types';
import { Slider } from './Slider';
import { Toggle } from './Toggle';
import { SelectControl } from './SelectControl';
import { ColorPicker } from './ColorPicker';
import { TextInputControl } from './TextInputControl';

export function ParamControl({
  paramKey: _paramKey,
  schema,
  value,
  onChange
}: {
  paramKey: string;
  schema: ParamType & { label: string };
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (schema.kind) {
    case 'slider':
      return (
        <Slider
          value={typeof value === 'number' ? value : schema.default}
          min={schema.min}
          max={schema.max}
          step={schema.step}
          label={schema.label}
          onChange={onChange}
        />
      );
    case 'color':
      return (
        <ColorPicker
          value={typeof value === 'string' ? value : schema.default}
          label={schema.label}
          palette={schema.palette}
          onChange={onChange}
        />
      );
    case 'select':
      return (
        <SelectControl
          value={typeof value === 'string' ? value : schema.default}
          options={schema.options}
          label={schema.label}
          onChange={onChange}
        />
      );
    case 'toggle':
      return (
        <Toggle
          checked={typeof value === 'boolean' ? value : schema.default}
          label={schema.label}
          onChange={onChange}
        />
      );
    case 'text':
      return (
        <TextInputControl
          value={typeof value === 'string' ? value : schema.default}
          label={schema.label}
          maxLength={schema.maxLength}
          onChange={onChange}
        />
      );
    default: {
      // Exhaustive check — TS will flag if a new ParamType.kind is added.
      const _exhaustive: never = schema;
      void _exhaustive;
      return null;
    }
  }
}
