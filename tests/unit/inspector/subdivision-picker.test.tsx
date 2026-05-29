import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubdivisionPicker } from '@/components/Workspace/Inspector/SubdivisionPicker';
import { TRIGGER_SUBDIVISIONS } from '@/lib/timeline/types';

describe('SubdivisionPicker (Plan 9c)', () => {
  it('renders one button per subdivision', () => {
    render(<SubdivisionPicker value="1×" onChange={() => {}} />);
    for (const s of TRIGGER_SUBDIVISIONS) {
      expect(screen.getByRole('button', { name: s })).toBeInTheDocument();
    }
  });

  it('marks the active button with aria-pressed=true', () => {
    render(<SubdivisionPicker value="4×" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '4×' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '1×' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('invokes onChange with the clicked subdivision', () => {
    const onChange = vi.fn();
    render(<SubdivisionPicker value="1×" onChange={onChange} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: '8×' }));
    expect(onChange).toHaveBeenCalledWith('8×');
  });
});
