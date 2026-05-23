import { describe, it, expect } from 'vitest';
import { toPersistedShape, STORE_VERSION } from '@/lib/store/persist-shape';
import type { AppState } from '@/lib/store/types';

function makeState(partial: Partial<AppState> = {}): AppState {
  // Minimal AppState — only the slots toPersistedShape reads matter.
  return {
    ui: {
      zoom: 1,
      selectedClipId: null,
      automationEditorClipId: null,
      automationSnap: 'off',
      exportState: {} as never,
      flowMode: false
    },
    timeline: {
      tracks: [],
      clips: [],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    },
    audio: { grid: { bpm: 120, offsetMs: 0, source: 'manual' } },
    media: { mediaRefs: [], videoLoadProgress: {} },
    ...partial
  } as AppState;
}

describe('toPersistedShape', () => {
  it('forces playhead.playing to false (snapshot reload safety)', () => {
    const state = makeState({
      timeline: {
        tracks: [],
        clips: [],
        playhead: { beats: 12, playing: true },
        zoom: 1,
        snap: 'beat'
      }
    });
    const out = toPersistedShape(state);
    expect(out.timeline.playhead.playing).toBe(false);
    expect(out.timeline.playhead.beats).toBe(12);
  });

  it('drops transient ui fields (only zoom kept)', () => {
    const state = makeState({
      ui: {
        zoom: 1.5,
        selectedClipId: 'x',
        automationEditorClipId: 'y',
        automationSnap: '1/4',
        exportState: {} as never,
        flowMode: true
      }
    });
    expect(toPersistedShape(state).ui).toEqual({ zoom: 1.5 });
  });

  it('drops media.videoLoadProgress (transient)', () => {
    const state = makeState({
      media: {
        mediaRefs: [
          { id: 'a', kind: 'image', url: 'https://example.com/a.png', name: 'a' } as never
        ],
        videoLoadProgress: { a: { received: 1, total: 2 } }
      }
    });
    const out = toPersistedShape(state);
    expect(out.media.mediaRefs).toHaveLength(1);
    // Type-side: PersistedShape.media has no videoLoadProgress field.
    expect(Object.keys(out.media)).toEqual(['mediaRefs']);
  });

  it('STORE_VERSION matches lib/store/index.ts persist `version`', () => {
    // Pinning: if we ever bump the zustand persist version, STORE_VERSION
    // must move with it — otherwise old DB snapshots won't run through
    // the migration chain.
    expect(STORE_VERSION).toBe(6);
  });
});
