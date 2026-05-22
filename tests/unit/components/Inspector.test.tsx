import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Inspector } from '@/components/Workspace/Inspector';
import { useAppStore } from '@/lib/store';
import { registerBuiltInPlugins, _resetBuiltInPluginsForTests } from '@/lib/fx';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';

describe('Inspector', () => {
  beforeEach(() => {
    // Defend against cross-test contamination — singleThread vitest shares
    // module state with renderer tests that reset the registry directly.
    _resetBuiltInPluginsForTests();
    registerBuiltInPlugins();
    useAppStore.setState({
      ui: {
        zoom: 1,
        selectedClipId: null,
        automationEditorClipId: null,
        automationSnap: 'off',
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

  it('shows empty state when no clip is selected', () => {
    render(<Inspector />);
    expect(screen.getByText(/Wähle einen Clip/)).toBeInTheDocument();
  });

  it('renders controls from the plugin paramSchema when a clip is selected', () => {
    useAppStore.setState((s) => ({ ui: { ...s.ui, selectedClipId: 'c1' } }));
    render(<Inspector />);
    // plugin.name and plugin.kind are both "Pulse" — assert by accessible
    // control instead of by text. Pulse schema has `intensity` (slider) + `color`.
    expect(screen.getByRole('slider', { name: 'Intensity' })).toBeInTheDocument();
    expect(screen.getByLabelText('Glow color')).toBeInTheDocument();
  });

  it('edit calls setClipParam for the changed key', () => {
    useAppStore.setState((s) => ({ ui: { ...s.ui, selectedClipId: 'c1' } }));
    render(<Inspector />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.input(slider, { target: { value: '0.9' } });
    expect(useAppStore.getState().timeline.clips[0].params?.intensity).toBe(0.9);
  });
});
