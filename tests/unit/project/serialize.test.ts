import { describe, it, expect } from 'vitest';
import { serializeProject } from '@/lib/project/serialize';
import type { AppState } from '@/lib/store/types';

function makeState(partial: Partial<AppState> = {}): AppState {
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

describe('serializeProject', () => {
  it('returns store_version + state', () => {
    const out = serializeProject(makeState());
    expect(out.store_version).toBe(6);
    expect(out.state.timeline).toBeDefined();
    expect(out.state.audio).toBeDefined();
  });

  it('serialized payload is JSON-safe (no functions, no symbols)', () => {
    const out = serializeProject(makeState({ ui: { zoom: 2 } as never }));
    expect(() => JSON.parse(JSON.stringify(out))).not.toThrow();
  });

  it('R2 URLs in mediaRefs survive serialisation (no blob conversion)', () => {
    const out = serializeProject(
      makeState({
        media: {
          mediaRefs: [
            {
              id: 'a',
              kind: 'image',
              url: 'https://r2.example/x.png',
              name: 'x.png'
            } as never
          ],
          videoLoadProgress: {}
        }
      })
    );
    expect(out.state.media.mediaRefs[0]?.url).toBe('https://r2.example/x.png');
  });
});
