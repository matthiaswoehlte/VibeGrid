import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ParamControl } from '@/components/ui/ParamControl';

describe('ParamControl', () => {
  it('renders a slider for kind="slider"', () => {
    const onChange = vi.fn();
    render(
      <ParamControl
        paramKey="intensity"
        schema={{ kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, label: 'Intensity' }}
        value={0.5}
        onChange={onChange}
      />
    );
    const input = screen.getByRole('slider') as HTMLInputElement;
    expect(input.value).toBe('0.5');
    fireEvent.input(input, { target: { value: '0.7' } });
    expect(onChange).toHaveBeenCalledWith(0.7);
  });

  it('renders a color input for kind="color"', () => {
    const onChange = vi.fn();
    render(
      <ParamControl
        paramKey="c"
        schema={{ kind: 'color', default: '#ffffff', label: 'Color' }}
        value={'#ff0000'}
        onChange={onChange}
      />
    );
    const input = screen.getByLabelText('Color') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '#00ff00' } });
    expect(onChange).toHaveBeenCalledWith('#00ff00');
  });

  it('renders a select for kind="select"', () => {
    const onChange = vi.fn();
    render(
      <ParamControl
        paramKey="mode"
        schema={{
          kind: 'select',
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' }
          ],
          default: 'a',
          label: 'Mode'
        }}
        value={'a'}
        onChange={onChange}
      />
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('renders a checkbox for kind="toggle"', () => {
    const onChange = vi.fn();
    render(
      <ParamControl
        paramKey="enabled"
        schema={{ kind: 'toggle', default: false, label: 'Enabled' }}
        value={false}
        onChange={onChange}
      />
    );
    const cb = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
