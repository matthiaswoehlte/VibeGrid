import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Inspector } from '@/components/Workspace/Inspector';
import { useAppStore } from '@/lib/store';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';

/**
 * Plan 5.9d Task 6 — Inspector's Volume slider for audio clips.
 */

beforeEach(() => {
  useAppStore.setState({
    ui: {
      zoom: 1,
      selectedClipIds: ['a1'],
      selectedClipId: 'a1',
      automationEditorClipId: null,
      automationSnap: 'off',
      clipSnap: '1',
      exportState: EXPORT_INITIAL_STATE,
      flowMode: false,
      exportRange: null,
      metronomeEnabled: false
    },
    timeline: {
      tracks: [
        { id: 'track-audio', kind: 'audio', name: 'Audio', muted: false }
      ],
      clips: [
        {
          id: 'a1',
          trackId: 'track-audio',
          kind: 'audio',
          mediaId: 'm-a1',
          startBeat: 0,
          lengthBeats: 16,
          label: 'a1'
        }
      ],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    },
    media: {
      mediaRefs: [
        {
          id: 'm-a1',
          kind: 'audio',
          url: 'https://example.com/track.mp3',
          filename: 'track.mp3',
          duration: 30,
          uploadedAt: new Date().toISOString()
        }
      ],
      videoLoadProgress: {}
    }
  });
});

describe('Inspector — VolumeSection (Plan 5.9d)', () => {
  it('slider defaults to 1.0 (100%) when params.volume is absent', () => {
    render(<Inspector />);
    const slider = screen.getByRole('slider', { name: 'Volume' }) as HTMLInputElement;
    expect(slider.value).toBe('1');
  });

  it('dragging the slider to 0.5 writes clip.params.volume = 0.5', () => {
    render(<Inspector />);
    const slider = screen.getByRole('slider', { name: 'Volume' }) as HTMLInputElement;
    fireEvent.input(slider, { target: { value: '0.5' } });
    expect(useAppStore.getState().timeline.clips[0].params?.volume).toBe(0.5);
  });

  it('automate (⚡) button converts the static value to an AutomationCurve', () => {
    render(<Inspector />);
    const automateBtn = screen.getByRole('button', { name: /automate volume/i });
    fireEvent.click(automateBtn);
    const volumeAfter = useAppStore.getState().timeline.clips[0].params?.volume;
    expect(volumeAfter).toBeTypeOf('object');
    // Curve has a `points` array and `interpolation` set.
    expect((volumeAfter as { points: unknown[] }).points.length).toBeGreaterThan(0);
  });
});
