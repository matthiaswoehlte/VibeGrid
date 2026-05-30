import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Inspector } from '@/components/Workspace/Inspector';
import { useAppStore } from '@/lib/store';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';

/**
 * Plan 5.9d Task 6 — Inspector's Video-Audio toggle for video clips.
 */

beforeEach(() => {
  useAppStore.setState({
    ui: {
      zoom: 1,
      selectedClipIds: ['v1'],
      selectedClipId: 'v1',
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
        { id: 'track-video', kind: 'video', name: 'Video', muted: false }
      ],
      clips: [
        {
          id: 'v1',
          trackId: 'track-video',
          kind: 'video',
          mediaId: 'm-v1',
          startBeat: 0,
          lengthBeats: 16,
          label: 'v1'
        }
      ],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    },
    media: {
      mediaRefs: [
        {
          id: 'm-v1',
          kind: 'video',
          url: 'https://example.com/intro.mp4',
          filename: 'intro.mp4',
          duration: 30,
          uploadedAt: new Date().toISOString()
        }
      ],
      videoLoadProgress: {}
    }
  });
});

describe('Inspector — Video-Audio toggle (Plan 5.9d)', () => {
  it('header shows the video filename', () => {
    render(<Inspector />);
    expect(screen.getByText('intro.mp4')).toBeInTheDocument();
  });

  it('toggle starts unchecked when audioEnabled is absent', () => {
    render(<Inspector />);
    const checkbox = screen.getByRole('checkbox', { name: /toggle video audio/i });
    expect(checkbox).not.toBeChecked();
  });

  it('clicking the toggle sets clip.params.audioEnabled to true', () => {
    render(<Inspector />);
    const checkbox = screen.getByRole('checkbox', { name: /toggle video audio/i });
    fireEvent.click(checkbox);
    expect(useAppStore.getState().timeline.clips[0].params?.audioEnabled).toBe(true);
  });
});
