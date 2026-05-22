import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddTrackButton } from '@/components/Workspace/Timeline/AddTrackButton';
import { useAppStore } from '@/lib/store';
import { initialTimelineState } from '@/lib/store/timeline-slice';

beforeEach(() => {
  useAppStore.setState((s) => ({
    timeline: {
      ...s.timeline,
      tracks: [...initialTimelineState.tracks],
      clips: []
    }
  }));
});

describe('AddTrackButton — Plan 5.9c picker', () => {
  it('opens the picker on click and shows exactly 3 options (Image / Video / FX)', () => {
    render(<AddTrackButton />);
    fireEvent.click(screen.getByRole('button', { name: /track hinzufügen/i }));
    expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Video' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'FX' })).toBeInTheDocument();
  });

  it('does NOT show an Audio option (Multi-Audio stub gated to 5.9d)', () => {
    render(<AddTrackButton />);
    fireEvent.click(screen.getByRole('button', { name: /track hinzufügen/i }));
    // The button labels are exact text — Audio shouldn't appear among them.
    // (The word "Audio" might show elsewhere in surrounding chrome, so we
    // assert against the button labels specifically.)
    const buttons = screen.queryAllByRole('button');
    const buttonLabels = buttons.map((b) => b.textContent?.trim()).filter(Boolean);
    expect(buttonLabels).not.toContain('Audio');
  });

  it('does NOT expose any per-FX-kind option (no Contour / Sweep / … in the picker)', () => {
    render(<AddTrackButton />);
    fireEvent.click(screen.getByRole('button', { name: /track hinzufügen/i }));
    const buttons = screen.queryAllByRole('button');
    const buttonLabels = buttons.map((b) => b.textContent?.trim()).filter(Boolean);
    for (const legacyLabel of ['Contour', 'Sweep', 'Pulse', 'Particles', 'Zoom Pulse', 'Text', 'Dissolve', 'Sunray']) {
      expect(buttonLabels).not.toContain(legacyLabel);
    }
  });

  it('clicking the FX option calls addTrack("fx")', () => {
    const addTrackSpy = vi.spyOn(
      useAppStore.getState().timelineActions,
      'addTrack'
    );
    render(<AddTrackButton />);
    fireEvent.click(screen.getByRole('button', { name: /track hinzufügen/i }));
    // `name: 'FX'` (exact) — disambiguates from the "FX" section-header
    // <div>, which `getByRole('button', …)` ignores by design.
    fireEvent.click(screen.getByRole('button', { name: 'FX' }));
    expect(addTrackSpy).toHaveBeenCalledWith('fx');
    addTrackSpy.mockRestore();
  });

  it('clicking Image calls addTrack("image")', () => {
    const addTrackSpy = vi.spyOn(
      useAppStore.getState().timelineActions,
      'addTrack'
    );
    render(<AddTrackButton />);
    fireEvent.click(screen.getByRole('button', { name: /track hinzufügen/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Image' }));
    expect(addTrackSpy).toHaveBeenCalledWith('image');
    addTrackSpy.mockRestore();
  });
});
