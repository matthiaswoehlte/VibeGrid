import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { ExportButton } from '@/components/TopBar/ExportButton';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';
import type { MediaRef } from '@/lib/storage/types';

const AUDIO_REF: MediaRef = {
  id: 'a1',
  url: 'blob:a',
  kind: 'audio',
  filename: 'song.mp3',
  uploadedAt: '2026-05-20T00:00:00Z',
  duration: 60
};

beforeEach(() => {
  useAppStore.setState((s) => ({
    media: { ...s.media, mediaRefs: [AUDIO_REF] },
    timeline: {
      ...s.timeline,
      tracks: [{ id: 'track-image', kind: 'image', name: 'Image', muted: false, order: 0 }],
      clips: [
        {
          id: 'img1',
          trackId: 'track-image',
          kind: 'image',
          mediaId: 'img-media',
          startBeat: 0,
          lengthBeats: 256,
          label: 'cover.jpg'
        }
      ]
    },
    ui: { ...s.ui, exportState: EXPORT_INITIAL_STATE }
  }));
});

describe('ExportButton', () => {
  it('is enabled when status=idle + audio + image clip are all present', () => {
    render(<ExportButton onStart={vi.fn()} />);
    expect(screen.getByRole('button', { name: /export/i })).not.toBeDisabled();
  });

  it('is disabled when no audio MediaRef is present', () => {
    useAppStore.setState((s) => ({ media: { ...s.media, mediaRefs: [] } }));
    render(<ExportButton onStart={vi.fn()} />);
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });

  it('is disabled when no active image clip at beat 0', () => {
    useAppStore.setState((s) => ({ timeline: { ...s.timeline, clips: [] } }));
    render(<ExportButton onStart={vi.fn()} />);
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });

  it('is disabled when exportState.status is not idle', () => {
    useAppStore.getState().setExportState({ status: 'recording' });
    render(<ExportButton onStart={vi.fn()} />);
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });

  it('click calls onStart when enabled', () => {
    const start = vi.fn();
    render(<ExportButton onStart={start} />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(start).toHaveBeenCalledTimes(1);
  });
});
