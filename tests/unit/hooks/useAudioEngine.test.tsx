import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioEngine } from '@/lib/hooks/useAudioEngine';
import { useAppStore } from '@/lib/store';

describe('useAudioEngine', () => {
  beforeEach(() => {
    useAppStore.setState({
      audio: { grid: { bpm: 120, offsetMs: 0, beatsPerBar: 4, source: 'manual' } }
    });
  });

  it('lazy-inits the engine on first render', () => {
    const { result } = renderHook(() => useAudioEngine());
    expect(result.current.engine).toBeTruthy();
  });

  it('user-edited store BPM propagates to engine.setBPM', () => {
    const { result } = renderHook(() => useAudioEngine());
    const setBpmSpy = vi.spyOn(result.current.engine!, 'setBPM');
    act(() => {
      // audio-slice's setBPM forces source: 'manual' — passes the source-guard
      useAppStore.getState().audioActions.setBPM(140);
    });
    expect(setBpmSpy).toHaveBeenCalledWith(140);
  });

  it('engine-detected grid (source: detected) does NOT re-trigger engine.setBPM', () => {
    const { result } = renderHook(() => useAudioEngine());
    const setBpmSpy = vi.spyOn(result.current.engine!, 'setBPM');
    act(() => {
      // audio-slice's setDetectedGrid forces source: 'detected' — source-guard skips
      useAppStore.getState().audioActions.setDetectedGrid({
        bpm: 128,
        offsetMs: 12,
        beatsPerBar: 4,
        source: 'detected'
      });
    });
    expect(setBpmSpy).not.toHaveBeenCalled();
    expect(useAppStore.getState().audio.grid.bpm).toBe(128);
  });

  it('cleans up engine on unmount', () => {
    const { result, unmount } = renderHook(() => useAudioEngine());
    const destroySpy = vi.spyOn(result.current.engine!, 'destroy');
    unmount();
    expect(destroySpy).toHaveBeenCalled();
  });
});

describe('useAudioEngine — multi-clip reconciler (Plan 5.9d)', () => {
  beforeEach(() => {
    // Reset to a clean store with one fx + one audio track and no clips.
    useAppStore.setState({
      audio: { grid: { bpm: 120, offsetMs: 0, beatsPerBar: 4, source: 'manual' } },
      timeline: {
        tracks: [
          { id: 'track-audio', kind: 'audio', name: 'Audio', muted: false }
        ],
        clips: [],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      },
      media: {
        mediaRefs: [
          {
            id: 'm-audio-1',
            kind: 'audio',
            url: 'https://example.com/a.mp3',
            filename: 'a.mp3',
            duration: 10,
            uploadedAt: new Date().toISOString()
          }
        ],
        videoLoadProgress: {}
      }
    });
    // Stub fetch / decodeAudioData so loadClip resolves.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(8)
    } as Response);
    const ctxProto = (
      globalThis as unknown as { AudioContext: { prototype: AudioContext } }
    ).AudioContext.prototype;
    vi.spyOn(ctxProto, 'decodeAudioData').mockResolvedValue({
      sampleRate: 48000,
      length: 48000,
      duration: 1,
      numberOfChannels: 2,
      getChannelData: () => new Float32Array(48000)
    } as unknown as AudioBuffer);
  });

  it('calls loadClip for every audio clip on mount', async () => {
    // Seed an audio clip BEFORE mounting so the initial reconcile sees it.
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: [
          {
            id: 'c-audio-1',
            trackId: 'track-audio',
            kind: 'audio',
            mediaId: 'm-audio-1',
            startBeat: 0,
            lengthBeats: 16,
            label: 'a'
          }
        ]
      }
    }));
    const { result } = renderHook(() => useAudioEngine());
    // Engine is created in useEffect; loadClip is async. Let microtasks flush.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.engine!.getLoadedClipIds()).toContain('c-audio-1');
  });

  it('calls unloadClip when a clip is removed', async () => {
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: [
          {
            id: 'c-audio-1',
            trackId: 'track-audio',
            kind: 'audio',
            mediaId: 'm-audio-1',
            startBeat: 0,
            lengthBeats: 16,
            label: 'a'
          }
        ]
      }
    }));
    const { result } = renderHook(() => useAudioEngine());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.engine!.getLoadedClipIds()).toContain('c-audio-1');
    // Remove the clip.
    act(() => {
      useAppStore.setState((s) => ({
        timeline: { ...s.timeline, clips: [] }
      }));
    });
    expect(result.current.engine!.getLoadedClipIds()).not.toContain('c-audio-1');
  });

  it('on play: calls playClip for every active audio clip', async () => {
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: [
          {
            id: 'c-audio-1',
            trackId: 'track-audio',
            kind: 'audio',
            mediaId: 'm-audio-1',
            startBeat: 0,
            lengthBeats: 16,
            label: 'a'
          }
        ]
      }
    }));
    const { result } = renderHook(() => useAudioEngine());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const playClipSpy = vi.spyOn(result.current.engine!, 'playClip');
    act(() => {
      useAppStore.setState((s) => ({
        timeline: {
          ...s.timeline,
          playhead: { ...s.timeline.playhead, playing: true }
        }
      }));
    });
    expect(playClipSpy).toHaveBeenCalledWith('c-audio-1', expect.any(Number), expect.any(Number));
  });

  it('on seek-while-PLAYING: stops all clips then restarts at new position', async () => {
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: [
          {
            id: 'c-audio-1',
            trackId: 'track-audio',
            kind: 'audio',
            mediaId: 'm-audio-1',
            startBeat: 0,
            lengthBeats: 16,
            label: 'a'
          }
        ],
        playhead: { beats: 0, playing: true }
      }
    }));
    const { result } = renderHook(() => useAudioEngine());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const stopAllSpy = vi.spyOn(result.current.engine!, 'stopAllClips');
    const playClipSpy = vi.spyOn(result.current.engine!, 'playClip');
    act(() => {
      // Drag the playhead to beat 8 mid-playback.
      useAppStore.setState((s) => ({
        timeline: { ...s.timeline, playhead: { ...s.timeline.playhead, beats: 8 } }
      }));
    });
    expect(stopAllSpy).toHaveBeenCalledTimes(1);
    expect(playClipSpy).toHaveBeenCalled();
    // stopAllClips first, then playClip — call-order matters so the new
    // source replaces the stale one.
    expect(stopAllSpy.mock.invocationCallOrder[0])
      .toBeLessThan(playClipSpy.mock.invocationCallOrder[0]);
  });
});
