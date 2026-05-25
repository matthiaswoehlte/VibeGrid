import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TransferConfirmModal } from '@/components/SceneFlow/TransferConfirmModal';
import { ConfirmReplaceAudioModal } from '@/components/SceneFlow/ConfirmReplaceAudioModal';

describe('TransferConfirmModal — Plan 8d', () => {
  it('does not render when open=false', () => {
    const { container } = render(
      <TransferConfirmModal
        open={false}
        trackCount={3}
        clipCount={5}
        sceneCount={8}
        syncAudio={null}
        snapMode="beat"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('Transferieren button is disabled until checkbox ticked', () => {
    const onConfirm = vi.fn();
    render(
      <TransferConfirmModal
        open={true}
        trackCount={3}
        clipCount={5}
        sceneCount={8}
        syncAudio={null}
        snapMode="beat"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    const btn = screen.getByRole('button', { name: 'Transferieren' });
    expect(btn).toBeDisabled();
    // Click checkbox
    fireEvent.click(screen.getByRole('checkbox'));
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalled();
  });

  it('Abbrechen calls onCancel and never reaches onConfirm', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <TransferConfirmModal
        open={true}
        trackCount={3}
        clipCount={5}
        sceneCount={8}
        syncAudio={null}
        snapMode="beat"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('syncAudio info renders when present', () => {
    render(
      <TransferConfirmModal
        open={true}
        trackCount={0}
        clipCount={0}
        sceneCount={8}
        syncAudio={{ filename: 'song.mp3', bpm: 128 }}
        snapMode="bar"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/song\.mp3/)).toBeInTheDocument();
    expect(screen.getByText(/BPM 128/)).toBeInTheDocument();
    expect(screen.getByText(/Takt \(4 Beats\)/)).toBeInTheDocument();
  });
});

describe('ConfirmReplaceAudioModal — Plan 8d', () => {
  it('does not render when open=false', () => {
    const { container } = render(
      <ConfirmReplaceAudioModal
        open={false}
        currentFilename={null}
        currentBpm={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('Ersetzen fires onConfirm immediately (no checkbox)', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmReplaceAudioModal
        open={true}
        currentFilename="old.mp3"
        currentBpm={120}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('old.mp3')).toBeInTheDocument();
    expect(screen.getByText(/BPM 120/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ersetzen' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('Abbrechen calls onCancel', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmReplaceAudioModal
        open={true}
        currentFilename="old.mp3"
        currentBpm={120}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
