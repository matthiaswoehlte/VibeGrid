import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';

beforeEach(() => {
  // Reset to the initial timeline + media for each test
  useAppStore.setState((s) => ({
    ...s,
    timeline: {
      ...s.timeline,
      tracks: [
        { id: 't-main', kind: 'main-video', name: 'Main', muted: false },
        { id: 't-fx', kind: 'fx', name: 'FX', muted: false }
      ],
      clips: [
        {
          id: 'c-1',
          trackId: 't-main',
          kind: 'video',
          mediaId: 'm-1',
          startBeat: 0,
          lengthBeats: 4,
          label: 'Scene 1'
        },
        {
          id: 'c-2',
          trackId: 't-main',
          kind: 'video',
          mediaId: 'm-2',
          startBeat: 4,
          lengthBeats: 4,
          label: 'Scene 2'
        },
        {
          id: 'c-fx',
          trackId: 't-fx',
          kind: 'contour',
          startBeat: 0,
          lengthBeats: 8,
          label: 'Contour'
        }
      ]
    },
    media: {
      ...s.media,
      mediaRefs: [
        {
          id: 'm-1',
          kind: 'video',
          url: 'https://cdn.example/sceneflow/u-1/st-1/sc-a/video.mp4',
          filename: 'scene-1.mp4',
          uploadedAt: '2026-05-25'
        },
        {
          id: 'm-2',
          kind: 'video',
          url: 'https://cdn.example/sceneflow/u-1/st-1/sc-b/video.mp4',
          filename: 'scene-2.mp4',
          uploadedAt: '2026-05-25'
        },
        {
          id: 'm-other',
          kind: 'video',
          url: 'https://cdn.example/sceneflow/u-1/st-OTHER/sc-x/video.mp4',
          filename: 'unrelated.mp4',
          uploadedAt: '2026-05-25'
        },
        {
          id: 'm-user-upload',
          kind: 'audio',
          url: 'https://cdn.example/uploads/u-1/song.mp3',
          filename: 'song.mp3',
          uploadedAt: '2026-05-25'
        }
      ]
    },
    ui: { ...s.ui, selectedClipId: 'c-1', automationEditorClipId: 'c-1' }
  }));
});

describe('timelineActions.clearAllTracks (Plan 8d)', () => {
  it('drops all tracks + clips and clears Inspector references', () => {
    useAppStore.getState().timelineActions.clearAllTracks();
    const s = useAppStore.getState();
    expect(s.timeline.tracks).toHaveLength(0);
    expect(s.timeline.clips).toHaveLength(0);
    expect(s.ui.selectedClipId).toBeNull();
    expect(s.ui.automationEditorClipId).toBeNull();
  });
});

describe('timelineActions.replaceMainVideoClips (Plan 8d, Fix W5)', () => {
  it('mutates only startBeat + lengthBeats of main-video clips by mediaId, preserves clip.id', () => {
    const layout = new Map([
      ['m-1', { startBeat: 0, lengthBeats: 8 }],
      ['m-2', { startBeat: 6, lengthBeats: 10 }]
    ]);
    useAppStore.getState().timelineActions.replaceMainVideoClips(layout);
    const clips = useAppStore.getState().timeline.clips;
    const c1 = clips.find((c) => c.id === 'c-1')!;
    const c2 = clips.find((c) => c.id === 'c-2')!;
    expect(c1.startBeat).toBe(0);
    expect(c1.lengthBeats).toBe(8);
    expect(c1.label).toBe('Scene 1'); // unchanged
    expect(c1.mediaId).toBe('m-1');
    expect(c2.startBeat).toBe(6);
    expect(c2.lengthBeats).toBe(10);
    expect(c2.label).toBe('Scene 2');
  });

  it('non-main-video clips (e.g. FX) are unaffected', () => {
    useAppStore
      .getState()
      .timelineActions.replaceMainVideoClips(
        new Map([['m-1', { startBeat: 99, lengthBeats: 99 }]])
      );
    const fx = useAppStore.getState().timeline.clips.find((c) => c.id === 'c-fx')!;
    expect(fx.startBeat).toBe(0);
    expect(fx.lengthBeats).toBe(8);
  });

  it('clips with mediaId not in layout map are unaffected', () => {
    useAppStore
      .getState()
      .timelineActions.replaceMainVideoClips(
        new Map([['m-1', { startBeat: 99, lengthBeats: 99 }]])
      );
    const c2 = useAppStore.getState().timeline.clips.find((c) => c.id === 'c-2')!;
    expect(c2.startBeat).toBe(4); // unchanged
  });
});

describe('mediaActions.purgeSceneflowMediaRefs (Plan 8d, Fix W4)', () => {
  it('drops only mediaRefs whose URL matches /sceneflow/{userId}/{storyId}/', () => {
    useAppStore
      .getState()
      .mediaActions.purgeSceneflowMediaRefs('st-1', 'u-1');
    const refs = useAppStore.getState().media.mediaRefs;
    expect(refs.map((r) => r.id).sort()).toEqual(['m-other', 'm-user-upload']);
  });

  it('different storyId leaves all SceneFlow refs intact', () => {
    useAppStore
      .getState()
      .mediaActions.purgeSceneflowMediaRefs('st-NONE', 'u-1');
    expect(useAppStore.getState().media.mediaRefs).toHaveLength(4);
  });

  it('different userId leaves all SceneFlow refs intact', () => {
    useAppStore
      .getState()
      .mediaActions.purgeSceneflowMediaRefs('st-1', 'u-OTHER');
    expect(useAppStore.getState().media.mediaRefs).toHaveLength(4);
  });
});
