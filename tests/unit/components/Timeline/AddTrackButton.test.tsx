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

describe('AddTrackButton — Plan 5.9c/5.9d picker', () => {
  it('opens the picker on click and shows all 4 options (Image / Video / Audio / FX)', () => {
    render(<AddTrackButton />);
    fireEvent.click(screen.getByRole('button', { name: /track hinzufügen/i }));
    expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Video' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Audio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'FX' })).toBeInTheDocument();
  });

  it('clicking Audio calls addTrack("audio") (Plan 5.9d unlocked Multi-Audio)', () => {
    const addTrackSpy = vi.spyOn(
      useAppStore.getState().timelineActions,
      'addTrack'
    );
    render(<AddTrackButton />);
    fireEvent.click(screen.getByRole('button', { name: /track hinzufügen/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
    expect(addTrackSpy).toHaveBeenCalledWith('audio');
    addTrackSpy.mockRestore();
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
