import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Inspector } from '@/components/Workspace/Inspector';
import { useAppStore } from '@/lib/store';
import { registerBuiltInPlugins, _resetBuiltInPluginsForTests } from '@/lib/fx';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';
import type { Clip } from '@/lib/timeline/types';

function bootStore(clip: Clip) {
  useAppStore.setState({
    ui: {
      zoom: 1,
      selectedClipIds: [clip.id],
      selectedClipId: clip.id,
      automationEditorClipId: null,
      automationSnap: 'off',
      clipSnap: '1',
      exportState: EXPORT_INITIAL_STATE,
      flowMode: false,
      exportRange: null,
      metronomeEnabled: false,
      seekNonce: 0
    },
    timeline: {
      tracks: [{ id: clip.trackId, kind: 'fx', name: 'FX', muted: false, order: 0 }],
      clips: [clip],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    }
  });
}

describe('Inspector — Plan 9c features', () => {
  beforeEach(() => {
    _resetBuiltInPluginsForTests();
    registerBuiltInPlugins();
  });

  it('SubdivisionPicker is rendered for an FX whose plugin opts in (rgb-split)', () => {
    bootStore({
      id: 'c1',
      trackId: 't1',
      kind: 'rgb-split',
      fxId: 'rgb-split',
      startBeat: 0,
      lengthBeats: 4,
      label: 'RGB'
    });
    render(<Inspector />);
    // Picker group is labelled and present.
    expect(screen.getByRole('group', { name: 'Trigger Subdivision' })).toBeInTheDocument();
    // Default '1×' is the active button.
    expect(screen.getByRole('button', { name: '1×' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('SubdivisionPicker click writes clip.triggerSubdivision', () => {
    bootStore({
      id: 'c1',
      trackId: 't1',
      kind: 'rgb-split',
      fxId: 'rgb-split',
      startBeat: 0,
      lengthBeats: 4,
      label: 'RGB'
    });
    render(<Inspector />);
    fireEvent.pointerDown(screen.getByRole('button', { name: '4×' }));
    expect(useAppStore.getState().timeline.clips[0].triggerSubdivision).toBe('4×');
  });

  it('beatSync renders as a ToggleParam (kind:"toggle") with semantic labels', () => {
    bootStore({
      id: 'c1',
      trackId: 't1',
      kind: 'rgb-split',
      fxId: 'rgb-split',
      startBeat: 0,
      lengthBeats: 4,
      label: 'RGB'
    });
    render(<Inspector />);
    // ToggleParam exposes a labelled group + user-friendly button text:
    // value=false → "Always On" (constant env=1.0), value=true → "Beat Pulse"
    // (decay envelope per beat).
    expect(screen.getByRole('group', { name: 'Beat Sync' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Always On' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Beat Pulse' })).toBeInTheDocument();
  });

  it('ValueDisplay shows the formatted numeric value for static slider params', () => {
    bootStore({
      id: 'c1',
      trackId: 't1',
      kind: 'pulse',
      fxId: 'pulse',
      startBeat: 0,
      lengthBeats: 4,
      label: 'P',
      params: { intensity: 0.8 }
    });
    render(<Inspector />);
    // Pulse → intensity slider step=0.05 → < 1 path → two decimals.
    expect(screen.getByText('0.80')).toBeInTheDocument();
  });

  it('ValueDisplay shows "auto" when a slider param is an AutomationCurve', () => {
    bootStore({
      id: 'c1',
      trackId: 't1',
      kind: 'pulse',
      fxId: 'pulse',
      startBeat: 0,
      lengthBeats: 4,
      label: 'P',
      params: {
        intensity: {
          mode: 'automation',
          points: [
            { beat: 0, value: 0.2 },
            { beat: 4, value: 0.9 }
          ],
          interpolation: 'linear'
        }
      }
    });
    render(<Inspector />);
    expect(screen.getByText('auto')).toBeInTheDocument();
  });
});
