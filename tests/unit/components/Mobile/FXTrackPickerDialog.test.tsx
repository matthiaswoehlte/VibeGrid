import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FXTrackPickerDialog } from '@/components/Mobile/FXTrackPickerDialog';
import { useAppStore } from '@/lib/store';
import {
  registerBuiltInPlugins,
  _resetBuiltInPluginsForTests
} from '@/lib/fx';
import type { Track } from '@/lib/timeline/types';

function makeFxTrack(id: string, name: string): Track {
  return { id, kind: 'fx', name, muted: false };
}

beforeEach(() => {
  // Plugin registry contamination across vitest singleThread — reset
  // before each test and re-register so `getPlugin('pulse')` finds it.
  _resetBuiltInPluginsForTests();
  registerBuiltInPlugins();
  // Reset clips so we don't trip the overlap check on add.
  useAppStore.setState((s) => ({
    timeline: { ...s.timeline, clips: [], playhead: { ...s.timeline.playhead, beats: 0 } }
  }));
});

describe('FXTrackPickerDialog (Plan 5.10)', () => {
  it('returns null when pluginId is null (dialog closed)', () => {
    const { container } = render(
      <FXTrackPickerDialog pluginId={null} onClose={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists ALL fx-kind tracks when ≥ 2 exist', () => {
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        tracks: [
          makeFxTrack('fx-1', 'FX'),
          makeFxTrack('fx-2', 'FX 2'),
          makeFxTrack('fx-3', 'FX 3')
        ]
      }
    }));
    render(<FXTrackPickerDialog pluginId="pulse" onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'FX' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'FX 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'FX 3' })).toBeInTheDocument();
  });

  it('tapping a track button calls addClip on the chosen track and onClose', () => {
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        tracks: [makeFxTrack('fx-a', 'FX'), makeFxTrack('fx-b', 'FX 2')]
      }
    }));
    const onClose = vi.fn();
    render(<FXTrackPickerDialog pluginId="pulse" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'FX 2' }));
    const clips = useAppStore.getState().timeline.clips;
    expect(clips).toHaveLength(1);
    expect(clips[0]?.trackId).toBe('fx-b');
    expect(clips[0]?.fxId).toBe('pulse');
    expect(onClose).toHaveBeenCalled();
  });
});
