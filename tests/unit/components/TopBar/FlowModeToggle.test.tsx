import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FlowModeToggle } from '@/components/TopBar/FlowModeToggle';
import { useAppStore } from '@/lib/store';

beforeEach(() => {
  useAppStore.getState().setFlowMode(false);
});

describe('FlowModeToggle', () => {
  it('renders Beat label + aria-pressed=false by default', () => {
    render(<FlowModeToggle />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn.textContent).toMatch(/Beat/);
  });

  it('click flips the store flag and updates label + aria-pressed', () => {
    render(<FlowModeToggle />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(useAppStore.getState().ui.flowMode).toBe(true);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn.textContent).toMatch(/Flow/);
  });

  it('second click flips it back to Beat Mode', () => {
    render(<FlowModeToggle />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(useAppStore.getState().ui.flowMode).toBe(false);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });
});
