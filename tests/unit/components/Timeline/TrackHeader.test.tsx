import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { TrackHeader } from '@/components/Workspace/Timeline/TrackHeader';
import { initialTimelineState } from '@/lib/store/timeline-slice';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';

beforeEach(() => {
  useAppStore.setState({
    timeline: {
      ...initialTimelineState,
      tracks: [...initialTimelineState.tracks],
      clips: []
    },
    ui: {
      zoom: 1,
      selectedClipIds: [],
      selectedClipId: null,
      automationEditorClipId: null,
      automationSnap: 'off',
      clipSnap: '1',
      exportState: EXPORT_INITIAL_STATE,
      flowMode: false,
      exportRange: null,
      metronomeEnabled: false
    }
  });
});

describe('TrackHeader (Plan 5.9a)', () => {
  it('renders the track name', () => {
    const t = useAppStore.getState().timeline.tracks[0];
    render(<TrackHeader track={t} width={80} />);
    expect(screen.getByText(t.name)).toBeDefined();
  });

  it('double-click on the label switches to edit mode and persists', () => {
    const t = useAppStore.getState().timeline.tracks[0];
    render(<TrackHeader track={t} width={80} />);
    fireEvent.doubleClick(screen.getByText(t.name));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Renamed Lane' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const after = useAppStore
      .getState()
      .timeline.tracks.find((tr) => tr.id === t.id);
    expect(after?.name).toBe('Renamed Lane');
  });

  it('Escape during edit reverts the value', () => {
    const t = useAppStore.getState().timeline.tracks[0];
    const original = t.name;
    render(<TrackHeader track={t} width={80} />);
    fireEvent.doubleClick(screen.getByText(t.name));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    const after = useAppStore
      .getState()
      .timeline.tracks.find((tr) => tr.id === t.id);
    expect(after?.name).toBe(original);
  });

  it('delete button removes the track when no clips are present', () => {
    const t = useAppStore.getState().timeline.tracks[0];
    const beforeLen = useAppStore.getState().timeline.tracks.length;
    render(<TrackHeader track={t} width={80} />);
    fireEvent.click(screen.getByTitle('Track löschen'));
    expect(useAppStore.getState().timeline.tracks.length).toBe(beforeLen - 1);
  });

  it('delete button is disabled when the track still has clips', () => {
    const t = useAppStore.getState().timeline.tracks[0];
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: [
          {
            id: 'clip-x',
            trackId: t.id,
            kind: t.kind,
            startBeat: 0,
            lengthBeats: 4,
            label: 'X'
          }
        ]
      }
    }));
    render(<TrackHeader track={t} width={80} />);
    const btn = screen.getByTitle(/enthält 1 Clip/);
    expect(btn).toBeDisabled();
  });

  it('mute button toggles `track.muted`', () => {
    const t = useAppStore.getState().timeline.tracks[0];
    expect(t.muted).toBe(false);
    render(<TrackHeader track={t} width={80} />);
    fireEvent.click(screen.getByTitle('Mute'));
    const after = useAppStore
      .getState()
      .timeline.tracks.find((tr) => tr.id === t.id);
    expect(after?.muted).toBe(true);
  });
});
