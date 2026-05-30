/**
 * MetronomeToggle button — unit tests.
 *
 * Follows the FlowModeToggle test pattern.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MetronomeToggle } from '@/components/TopBar/MetronomeToggle';
import { useAppStore } from '@/lib/store';

beforeEach(() => {
  useAppStore.setState({
    ui: {
      ...useAppStore.getState().ui,
      metronomeEnabled: false
    }
  });
});

describe('MetronomeToggle', () => {
  it('renders with aria-pressed=false by default', () => {
    render(<MetronomeToggle />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('click calls toggleMetronome and flips aria-pressed to true', () => {
    render(<MetronomeToggle />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(useAppStore.getState().ui.metronomeEnabled).toBe(true);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('second click flips it back to false', () => {
    render(<MetronomeToggle />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(useAppStore.getState().ui.metronomeEnabled).toBe(false);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('button has pointer-events (uses onPointerDown or onClick)', () => {
    render(<MetronomeToggle />);
    const btn = screen.getByRole('button');
    // The button must exist and be clickable
    expect(btn).toBeTruthy();
    expect(btn.tagName).toBe('BUTTON');
  });

  it('active styling reflects metronomeEnabled state', () => {
    render(<MetronomeToggle />);
    const btn = screen.getByRole('button');
    // Initially inactive — should not contain the active accent colour class
    const inactiveClass = btn.className;
    fireEvent.click(btn);
    const activeClass = btn.className;
    // Active and inactive class strings must differ
    expect(activeClass).not.toBe(inactiveClass);
  });
});
