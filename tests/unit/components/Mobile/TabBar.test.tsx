import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar } from '@/components/Mobile/TabBar';
import { useAppStore } from '@/lib/store';
import * as breakpoints from '@/lib/utils/breakpoints';

beforeEach(() => {
  useAppStore.getState().mobileUIActions.setMobileTab('timeline');
  vi.restoreAllMocks();
});

describe('TabBar (Plan 5.10)', () => {
  it('renders three tab buttons on mobile', () => {
    vi.spyOn(breakpoints, 'useIsMobile').mockReturnValue(true);
    render(<TabBar />);
    expect(screen.getByRole('button', { name: /timeline/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /media/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^fx$/i })).toBeInTheDocument();
  });

  // Anm 10 — Desktop invariant. MUST be present.
  it('renders nothing on desktop', () => {
    vi.spyOn(breakpoints, 'useIsMobile').mockReturnValue(false);
    const { container } = render(<TabBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('tapping a tab updates store.mobileUI.mobileTab', () => {
    vi.spyOn(breakpoints, 'useIsMobile').mockReturnValue(true);
    render(<TabBar />);
    fireEvent.click(screen.getByRole('button', { name: /^fx$/i }));
    expect(useAppStore.getState().mobileUI.mobileTab).toBe('fx');
  });

  it('active tab has aria-pressed="true"', () => {
    vi.spyOn(breakpoints, 'useIsMobile').mockReturnValue(true);
    render(<TabBar />);
    const timelineBtn = screen.getByRole('button', { name: /timeline/i });
    expect(timelineBtn).toHaveAttribute('aria-pressed', 'true');
    const fxBtn = screen.getByRole('button', { name: /^fx$/i });
    expect(fxBtn).toHaveAttribute('aria-pressed', 'false');
  });
});
