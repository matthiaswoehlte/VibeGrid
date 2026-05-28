import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SoundLibrary } from '@/components/Workspace/LeftPanel/SoundLibrary';
import { useAppStore } from '@/lib/store';
import { initialSoundsState } from '@/lib/store/sounds-slice';
import type { SoundManifest } from '@/lib/sounds/types';

const MANIFEST: SoundManifest = {
  version: 1,
  updatedAt: '2026-05-28T00:00:00Z',
  categories: [
    {
      id: 'braams',
      label: 'Braams',
      icon: '🎺',
      sounds: [
        {
          id: 'heavy-01',
          label: 'Heavy Braam',
          url: 'https://r2.example/library/sfx/braams/heavy-01.mp3',
          duration: 2.4,
          tags: ['dark', 'cinematic']
        },
        {
          id: 'rise-02',
          label: 'Cinematic Riser',
          url: 'https://r2.example/library/sfx/braams/rise-02.mp3',
          duration: 3.1,
          tags: ['rise']
        }
      ]
    },
    {
      id: 'kick',
      label: 'Kick',
      sounds: [
        {
          id: 'punch-01',
          label: 'Punchy Kick',
          url: 'https://r2.example/library/sfx/kick/punch-01.mp3',
          duration: 0.4,
          tags: ['punchy']
        }
      ]
    }
  ]
};

beforeEach(() => {
  useAppStore.setState({ sounds: initialSoundsState });
  useAppStore.getState().clearHistory();
  // Stub HTMLAudioElement so jsdom doesn't error on `new Audio()`.
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

describe('SoundLibrary', () => {
  it('renders a loading state while isLoading=true', () => {
    useAppStore.getState().soundsActions.setLoading(true);
    render(<SoundLibrary />);
    expect(screen.getByText(/Lade Sound Library/i)).toBeInTheDocument();
  });

  it('renders an unavailable message when an error is set', () => {
    useAppStore.getState().soundsActions.setError('boom');
    render(<SoundLibrary />);
    expect(screen.getByText(/nicht verfügbar/i)).toBeInTheDocument();
  });

  it('renders all manifest categories with sound entries', () => {
    useAppStore.getState().soundsActions.setManifest(MANIFEST);
    render(<SoundLibrary />);
    expect(screen.getByText('Braams')).toBeInTheDocument();
    expect(screen.getByText('Kick')).toBeInTheDocument();
    expect(screen.getByText('Heavy Braam')).toBeInTheDocument();
    expect(screen.getByText('Cinematic Riser')).toBeInTheDocument();
    expect(screen.getByText('Punchy Kick')).toBeInTheDocument();
  });

  it('search filters by label substring (case-insensitive)', () => {
    useAppStore.getState().soundsActions.setManifest(MANIFEST);
    render(<SoundLibrary />);
    fireEvent.change(screen.getByPlaceholderText(/Suche/), { target: { value: 'riser' } });
    expect(screen.getByText('Cinematic Riser')).toBeInTheDocument();
    expect(screen.queryByText('Heavy Braam')).not.toBeInTheDocument();
    expect(screen.queryByText('Punchy Kick')).not.toBeInTheDocument();
  });

  it('search filters by tag', () => {
    useAppStore.getState().soundsActions.setManifest(MANIFEST);
    render(<SoundLibrary />);
    fireEvent.change(screen.getByPlaceholderText(/Suche/), { target: { value: 'punchy' } });
    expect(screen.getByText('Punchy Kick')).toBeInTheDocument();
    expect(screen.queryByText('Heavy Braam')).not.toBeInTheDocument();
  });

  it('clicking [+] adds a MediaRef (source=library) + an audio clip', () => {
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        tracks: [
          ...s.timeline.tracks.filter((t) => t.kind !== 'audio'),
          { id: 'aud-1', kind: 'audio', name: 'Audio', muted: false }
        ],
        clips: []
      },
      media: { mediaRefs: [], videoLoadProgress: {} }
    }));
    useAppStore.getState().soundsActions.setManifest(MANIFEST);
    render(<SoundLibrary />);

    // The first [+] button in DOM order is the Heavy Braam entry.
    const addButtons = screen.getAllByTitle('Auf Audio-Track legen');
    fireEvent.click(addButtons[0]);

    const state = useAppStore.getState();
    const ref = state.media.mediaRefs.find((m) => m.id === 'library-heavy-01');
    expect(ref).toBeDefined();
    expect(ref?.source).toBe('library');
    expect(ref?.kind).toBe('audio');
    const clip = state.timeline.clips.find((c) => c.mediaId === 'library-heavy-01');
    expect(clip).toBeDefined();
    expect(clip?.kind).toBe('audio');
    expect(clip?.trackId).toBe('aud-1');
  });
});
