import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { initialMediaState } from '@/lib/store/media-slice';
import { initialSoundsState } from '@/lib/store/sounds-slice';
import type { SoundManifest } from '@/lib/sounds/types';

const MANIFEST: SoundManifest = {
  version: 1,
  updatedAt: '2026-05-28T00:00:00Z',
  categories: [
    {
      id: 'whoosh',
      label: 'Whoosh',
      sounds: [
        {
          id: 'fast-01',
          label: 'Fast Whoosh',
          url: 'https://r2.example/library/sfx/whoosh/fast-01.mp3',
          duration: 0.8,
          license: 'CC0'
        }
      ]
    }
  ]
};

beforeEach(() => {
  useAppStore.setState((s) => ({
    timeline: {
      ...s.timeline,
      tracks: [
        ...s.timeline.tracks.filter((t) => t.kind !== 'audio'),
        { id: 'aud-1', kind: 'audio', name: 'Audio', muted: false }
      ],
      clips: []
    },
    media: { ...initialMediaState },
    sounds: initialSoundsState
  }));
  useAppStore.getState().clearHistory();
});

/**
 * The user-facing "Add Sound" path is shared between the [+] button in
 * the SoundLibrary panel and the drag-drop handler in Tracks.tsx. Both
 * call into `mediaActions.addMediaRef` + `timelineActions.addClip` with
 * the same payload shape — this integration test pins that shape.
 */
function addSoundToFirstAudioTrack(soundId: string): void {
  const state = useAppStore.getState();
  const manifest = state.sounds.manifest;
  const sound = manifest?.categories.flatMap((c) => c.sounds).find((s) => s.id === soundId);
  if (!sound) throw new Error('sound not in manifest');
  const audioTrack = state.timeline.tracks.find((t) => t.kind === 'audio');
  if (!audioTrack) throw new Error('no audio track');
  const mediaId = `library-${sound.id}`;
  if (!state.mediaActions.getMediaRef(mediaId)) {
    state.mediaActions.addMediaRef({
      id: mediaId,
      kind: 'audio',
      url: sound.url,
      filename: sound.label,
      uploadedAt: new Date().toISOString(),
      duration: sound.duration,
      source: 'library',
      license: sound.license
    });
  }
  const bpm = state.audio.grid.bpm || 120;
  const lengthBeats = Math.max(0.5, (sound.duration * bpm) / 60);
  state.timelineActions.addClip({
    id: `clip-${sound.id}`,
    trackId: audioTrack.id,
    kind: 'audio',
    mediaId,
    startBeat: 0,
    lengthBeats,
    label: sound.label
  });
}

describe('Sound Library — add-to-timeline path', () => {
  it('registers a MediaRef with source=library and license carried over', () => {
    useAppStore.getState().soundsActions.setManifest(MANIFEST);
    addSoundToFirstAudioTrack('fast-01');
    const ref = useAppStore
      .getState()
      .media.mediaRefs.find((m) => m.id === 'library-fast-01');
    expect(ref).toBeDefined();
    expect(ref?.source).toBe('library');
    expect(ref?.license).toBe('CC0');
    expect(ref?.url).toBe('https://r2.example/library/sfx/whoosh/fast-01.mp3');
  });

  it('adds an audio clip on the first audio track with the right mediaId + label', () => {
    useAppStore.getState().soundsActions.setManifest(MANIFEST);
    addSoundToFirstAudioTrack('fast-01');
    const clip = useAppStore.getState().timeline.clips[0];
    expect(clip.kind).toBe('audio');
    expect(clip.mediaId).toBe('library-fast-01');
    expect(clip.trackId).toBe('aud-1');
    expect(clip.label).toBe('Fast Whoosh');
  });

  it('double-add of the same sound only creates ONE MediaRef (idempotent guard)', () => {
    useAppStore.getState().soundsActions.setManifest(MANIFEST);
    addSoundToFirstAudioTrack('fast-01');
    addSoundToFirstAudioTrack('fast-01');
    const refs = useAppStore
      .getState()
      .media.mediaRefs.filter((m) => m.id === 'library-fast-01');
    expect(refs).toHaveLength(1);
  });

  it('clip-add IS undoable (record), MediaRef-add IS NOT (skip)', () => {
    useAppStore.getState().soundsActions.setManifest(MANIFEST);
    const pastBefore = useAppStore.getState().history.past.length;
    addSoundToFirstAudioTrack('fast-01');
    const pastAfter = useAppStore.getState().history.past.length;
    // Exactly one history entry — the addClip. addMediaRef is skip:true.
    expect(pastAfter - pastBefore).toBe(1);

    useAppStore.getState().undo();
    const stateAfterUndo = useAppStore.getState();
    expect(stateAfterUndo.timeline.clips).toHaveLength(0);
    // MediaRef survives the undo by design — R2-bound, can't be rolled back.
    expect(
      stateAfterUndo.media.mediaRefs.find((m) => m.id === 'library-fast-01')
    ).toBeDefined();
  });
});
