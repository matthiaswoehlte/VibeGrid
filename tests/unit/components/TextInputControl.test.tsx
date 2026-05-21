import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextInputControl } from '@/components/ui/TextInputControl';

describe('TextInputControl', () => {
  it('renders an input with the given value + label', () => {
    render(<TextInputControl value="Hello" label="Caption" onChange={() => {}} />);
    expect(screen.getByText('Caption')).toBeDefined();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Hello');
  });

  it('calls onChange with the new value on input', () => {
    const onChange = vi.fn();
    render(<TextInputControl value="A" label="X" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'AB' } });
    expect(onChange).toHaveBeenCalledWith('AB');
  });

  it('respects the maxLength attribute', () => {
    render(
      <TextInputControl value="" label="X" maxLength={5} onChange={() => {}} />
    );
    expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', '5');
  });
});
