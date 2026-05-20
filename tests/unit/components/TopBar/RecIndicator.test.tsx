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
});
