import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { RecIndicator } from '@/components/TopBar/RecIndicator';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';

beforeEach(() => {
  useAppStore.setState((s) => ({
    ui: { ...s.ui, exportState: EXPORT_INITIAL_STATE }
  }));
});

describe('RecIndicator', () => {
  it('is not rendered when status === idle', () => {
    const { container } = render(<RecIndicator onCancel={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows MM:SS / MM:SS timecode when status === recording', () => {
    useAppStore.getState().setExportState({
      status: 'recording',
      elapsedSeconds: 14,
      totalSeconds: 90
    });
    render(<RecIndicator onCancel={vi.fn()} />);
    expect(screen.getByText(/REC 0:14 \/ 1:30/)).toBeDefined();
  });

  it('✕ button calls the onCancel prop', () => {
    useAppStore.getState().setExportState({ status: 'recording' });
    const cancel = vi.fn();
    render(<RecIndicator onCancel={cancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel export/i }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('offline mode renders Rendering X / Y + ETA + progressbar', () => {
    useAppStore.getState().setExportState({
      status: 'recording',
      mode: 'offline',
      currentFrame: 600,
      totalFrames: 3600,
      etaSeconds: 47
    });
    render(<RecIndicator onCancel={vi.fn()} />);
    expect(screen.getByText(/Rendering 600 \/ 3600 \(17%\)/)).toBeDefined();
    expect(screen.getByText(/ETA 0:47/)).toBeDefined();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '17');
  });

  it('offline mode shows Finalizing… during the finalize phase', () => {
    useAppStore.getState().setExportState({
      status: 'finalizing',
      mode: 'offline',
      currentFrame: 3600,
      totalFrames: 3600
    });
    render(<RecIndicator onCancel={vi.fn()} />);
    expect(screen.getByText(/Finalizing/)).toBeDefined();
  });

  it('offline mode progress bar aria-valuenow clamps to 0..100', () => {
    useAppStore.getState().setExportState({
      status: 'recording',
      mode: 'offline',
      currentFrame: 0,
      totalFrames: 100
    });
    render(<RecIndicator onCancel={vi.fn()} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '0');
  });
});
