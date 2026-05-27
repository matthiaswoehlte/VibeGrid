import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideoEngine } from '@/lib/hooks/useVideoEngine';
import { useAppStore } from '@/lib/store';
import { initialTimelineState } from '@/lib/store/timeline-slice';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';

// Engine pulls bytes through the cache before creating the <video>.
// Stub it so tests don't hit real network.
vi.mock('@/lib/video/bytes-cache', () => ({
  videoBytesCache: {
    fetch: vi.fn(async () => new ArrayBuffer(8)),
    get: () => null,
    bytesUsed: () => 0,
    clear: () => {}
  }
}));

const MockVideoElement = (globalThis as Record<string, unknown>)
  .MockVideoElement as new () => HTMLVideoElement & {
  src: string;
  currentTime: number;
  onloadeddata: (() => void) | null;
  onerror: (() => void) | null;
};

const VIDEO_REF = {
  id: 'media-v1',
  kind: 'video' as const,
  url: 'https://x/v.mp4',
  filename: 'v.mp4',
  uploadedAt: '2026-05-21T00:00:00Z',
  duration: 30
};

const VIDEO_CLIP = {
  id: 'clip-v1',
  trackId: 'track-video',
  kind: 'video' as const,
  mediaId: 'media-v1',
  startBeat: 0,
  lengthBeats: 60,
  label: 'v.mp4'
};

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test/1');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const orig = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'video') return new MockVideoElement() as unknown as HTMLVideoElement;
    return orig(tag);
  });
  useAppStore.setState((s) => ({
    timeline: { ...initialTimelineState, tracks: [...initialTimelineState.tracks], clips: [] },
    media: { mediaRefs: [], videoLoadProgress: {} },
    audio: { ...s.audio, grid: { bpm: 120, source: 'manual', beatsPerBar: 4, offsetMs: 0 } },
    ui: {
      zoom: 1,
      selectedClipIds: [],
      selectedClipId: null,
      automationEditorClipId: null,
      automationSnap: 'off',
      clipSnap: '1',
      exportState: EXPORT_INITIAL_STATE,
      flowMode: false
    }
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useVideoEngine', () => {
  it('returns a stable getElement function across re-renders', () => {
    const { result, rerender } = renderHook(() => useVideoEngine());
    const first = result.current.getElement;
    rerender();
    const second = result.current.getElement;
    expect(first).toBe(second);
  });

  it('lazy-loads videos referenced by clips', async () => {
    const { result } = renderHook(() => useVideoEngine());
    // No clip → engine has nothing loaded yet.
    expect(result.current.getElement('media-v1')).toBeNull();

    await act(async () => {
      useAppStore.setState((s) => ({
        media: { mediaRefs: [VIDEO_REF], videoLoadProgress: {} },
        timeline: { ...s.timeline, clips: [VIDEO_CLIP] }
      }));
      // Wait for the load microtask chain.
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.getElement('media-v1')).not.toBeNull();
  });

  it('unloads videos that no longer have a referencing clip', async () => {
    const { result } = renderHook(() => useVideoEngine());

    await act(async () => {
      useAppStore.setState((s) => ({
        media: { mediaRefs: [VIDEO_REF], videoLoadProgress: {} },
        timeline: { ...s.timeline, clips: [VIDEO_CLIP] }
      }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.getElement('media-v1')).not.toBeNull();

    await act(async () => {
      useAppStore.setState((s) => ({
        timeline: { ...s.timeline, clips: [] }
      }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.getElement('media-v1')).toBeNull();
  });

  it('engine reference exposed for renderOffline plumbing', () => {
    const { result } = renderHook(() => useVideoEngine());
    expect(result.current.engine).not.toBeNull();
    expect(typeof result.current.engine!.seekAllTo).toBe('function');
  });

  // Plan 8d regression — Transfer-to-Timeline puts multiple sequential
  // video clips on one main-video track. Before the per-clip sync, the
  // old engine.play()-everything approach left scenes 2..N stuck on
  // their first frame (loaded after the global play() call) while
  // scene 1 froze on its last frame past its native duration. These
  // tests guard against the regression.
  describe('Plan 8d — per-clip source-relative play orchestration', () => {
    const VIDEO_REFS = [
      { id: 'media-v1', kind: 'video' as const, url: 'https://x/1.mp4', filename: '1.mp4', uploadedAt: '', duration: 5 },
      { id: 'media-v2', kind: 'video' as const, url: 'https://x/2.mp4', filename: '2.mp4', uploadedAt: '', duration: 5 }
    ];
    const TRACK_MAIN = { id: 't-main', kind: 'main-video' as const, name: 'Main', muted: false };
    // At BPM 120: 1 beat = 0.5 s. 10 beats = 5 s, matching each scene's duration.
    const CLIPS = [
      { id: 'c1', trackId: 't-main', kind: 'video' as const, mediaId: 'media-v1', startBeat: 0,  lengthBeats: 10, label: 'scene 1' },
      { id: 'c2', trackId: 't-main', kind: 'video' as const, mediaId: 'media-v2', startBeat: 10, lengthBeats: 10, label: 'scene 2' }
    ];

    async function loadBoth(): Promise<void> {
      await act(async () => {
        useAppStore.setState((s) => ({
          media: { mediaRefs: VIDEO_REFS, videoLoadProgress: {} },
          timeline: {
            ...s.timeline,
            tracks: [...s.timeline.tracks, TRACK_MAIN],
            clips: CLIPS
          }
        }));
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    it('seeks the active clip to source-relative time when playhead crosses its boundary', async () => {
      const { result } = renderHook(() => useVideoEngine());
      await loadBoth();
      const el1 = result.current.getElement('media-v1')!;
      const el2 = result.current.getElement('media-v2')!;
      expect(el1).not.toBeNull();
      expect(el2).not.toBeNull();

      // Playhead at beat 12 (= 2 beats into clip 2), playing.
      // Source-relative time for clip 2: (12 - 10) × 60 / 120 = 1 s.
      await act(async () => {
        useAppStore.setState((s) => ({
          timeline: { ...s.timeline, playhead: { beats: 12, playing: true } }
        }));
      });
      expect(el2.currentTime).toBeCloseTo(1, 1);
      // Clip 1 is inactive → element should be reset to 0 (so it shows
      // frame 0 next time it becomes active, not whatever the decoder drifted to).
      expect(el1.currentTime).toBe(0);
    });

    it('pauses video element when no clip is active at the playhead', async () => {
      const { result } = renderHook(() => useVideoEngine());
      await loadBoth();
      const el1 = result.current.getElement('media-v1')!;
      // First put the playhead inside clip 1 and start playing — element
      // becomes paused=false. Then move past the clip and verify it's
      // paused. (Without this prelude the spy never fires because the
      // mock starts paused=true and we skip redundant pause() calls.)
      await act(async () => {
        useAppStore.setState((s) => ({
          timeline: { ...s.timeline, playhead: { beats: 5, playing: true } }
        }));
      });
      expect(el1.paused).toBe(false);
      const pauseSpy = vi.spyOn(el1, 'pause');
      await act(async () => {
        useAppStore.setState((s) => ({
          timeline: { ...s.timeline, playhead: { beats: 50, playing: true } }
        }));
      });
      expect(pauseSpy).toHaveBeenCalled();
    });

    it('calls play() on the active element when timeline transitions to playing', async () => {
      const { result } = renderHook(() => useVideoEngine());
      await loadBoth();
      const el1 = result.current.getElement('media-v1')!;
      const playSpy = vi.spyOn(el1, 'play');
      // Playhead in clip 1, timeline starts playing.
      await act(async () => {
        useAppStore.setState((s) => ({
          timeline: { ...s.timeline, playhead: { beats: 5, playing: true } }
        }));
      });
      expect(playSpy).toHaveBeenCalled();
    });

    it('seeks newly loaded video to source-relative time if its clip is already active', async () => {
      // Simulate: timeline starts playing while only clip 1's video is
      // loaded; clip 2 finishes loading mid-playback. The sync-on-load
      // path must seek + play clip 2's element when timeline is on it.
      const { result } = renderHook(() => useVideoEngine());

      // Step 1: load only clip 1, playhead at beat 0, playing.
      await act(async () => {
        useAppStore.setState((s) => ({
          media: { mediaRefs: [VIDEO_REFS[0]], videoLoadProgress: {} },
          timeline: {
            ...s.timeline,
            tracks: [...s.timeline.tracks, TRACK_MAIN],
            clips: [CLIPS[0], CLIPS[1]],
            playhead: { beats: 12, playing: true }
          }
        }));
        await new Promise((r) => setTimeout(r, 0));
      });
      // Clip 2 not loaded yet.
      expect(result.current.getElement('media-v2')).toBeNull();

      // Step 2: ref-for-clip-2 arrives. Engine loads. Sync-on-load fires.
      await act(async () => {
        useAppStore.setState((s) => ({
          media: { mediaRefs: VIDEO_REFS, videoLoadProgress: {} }
        }));
        await new Promise((r) => setTimeout(r, 0));
      });
      const el2 = result.current.getElement('media-v2')!;
      expect(el2).not.toBeNull();
      // playhead 12, clip 2 startBeat 10 → source-time = 1 s
      expect(el2.currentTime).toBeCloseTo(1, 1);
    });
  });
});
