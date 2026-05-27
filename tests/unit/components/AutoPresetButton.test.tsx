import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { AutoPresetButton } from '@/components/Workspace/LeftPanel/AutoPresetButton';
import { useAppStore } from '@/lib/store';
import * as adapter from '@/lib/storage/auto-preset-adapter';
import { registerBuiltInPlugins, _resetBuiltInPluginsForTests } from '@/lib/fx';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';

const mediaRef = {
  id: 'm0',
  kind: 'image' as const,
  url: 'https://x/0.jpg',
  filename: 'x.jpg',
  uploadedAt: '2026-05-19T00:00:00.000Z'
};

describe('AutoPresetButton', () => {
  beforeEach(() => {
    // Defend against cross-test contamination — singleThread vitest shares
    // module state with renderer tests that reset the registry directly.
    _resetBuiltInPluginsForTests();
    registerBuiltInPlugins();
    useAppStore.setState({
      ui: {
        zoom: 1,
        selectedClipIds: [],
        selectedClipId: null,
        automationEditorClipId: null,
        automationSnap: 'off',
      clipSnap: '1',
        exportState: EXPORT_INITIAL_STATE,
        flowMode: false
      },
      timeline: {
        tracks: [{ id: 't1', kind: 'fx', name: 'P', muted: false, order: 0 }],
        clips: [
          {
            id: 'c1',
            trackId: 't1',
            kind: 'pulse',
            fxId: 'pulse',
            startBeat: 0,
            lengthBeats: 4,
            label: 'P',
            params: { intensity: 0.5, color: '#ffffff' }
          }
        ],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      }
    });
  });

  it('is disabled without an active FX clip', () => {
    const { container } = render(<AutoPresetButton mediaRef={mediaRef} />);
    const btn = container.querySelector('button')!;
    expect(btn).toBeDisabled();
  });

  it('calls adapter and writes params when active clip exists', async () => {
    useAppStore.setState((s) => ({ ui: { ...s.ui, selectedClipId: 'c1' } }));
    vi.spyOn(adapter, 'fetchAutoPreset').mockResolvedValue({ intensity: 0.9, color: '#aabbcc' });
    const { container } = render(<AutoPresetButton mediaRef={mediaRef} />);
    fireEvent.click(container.querySelector('button')!);
    await waitFor(() => {
      expect(useAppStore.getState().timeline.clips[0].params?.intensity).toBe(0.9);
      expect(useAppStore.getState().timeline.clips[0].params?.color).toBe('#aabbcc');
    });
  });

  it('shows error toast on adapter failure (no crash)', async () => {
    useAppStore.setState((s) => ({ ui: { ...s.ui, selectedClipId: 'c1' } }));
    vi.spyOn(adapter, 'fetchAutoPreset').mockRejectedValue(new Error('rate limited'));
    const { container } = render(<AutoPresetButton mediaRef={mediaRef} />);
    const btn = container.querySelector('button')!;
    fireEvent.click(btn);
    await waitFor(() => {
      expect(container.querySelector('button')).not.toBeDisabled();
    });
  });
});
