import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToggleParam } from '@/components/Workspace/Inspector/ToggleParam';

describe('ToggleParam (Plan 9c)', () => {
  it('renders Off + On buttons and the supplied label', () => {
    render(<ToggleParam label="Beat Sync" value={true} onChange={() => {}} />);
    expect(screen.getByText('Beat Sync')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Off' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'On' })).toBeInTheDocument();
  });

  it('reflects boolean value via aria-pressed', () => {
    const { rerender } = render(
      <ToggleParam label="X" value={true} onChange={() => {}} />
    );
    expect(screen.getByRole('button', { name: 'On' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Off' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    rerender(<ToggleParam label="X" value={false} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Off' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'On' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('invokes onChange(false) when Off pressed and onChange(true) when On pressed', () => {
    const onChange = vi.fn();
    render(<ToggleParam label="X" value={true} onChange={onChange} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Off' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'On' }));
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('uses offLabel/onLabel props when provided (e.g. Beat Pulse / Always On)', () => {
    render(
      <ToggleParam
        label="Beat Sync"
        value={false}
        onChange={() => {}}
        offLabel="Beat Pulse"
        onLabel="Always On"
      />
    );
    expect(screen.getByRole('button', { name: 'Beat Pulse' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Always On' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Off' })).not.toBeInTheDocument();
  });
});
