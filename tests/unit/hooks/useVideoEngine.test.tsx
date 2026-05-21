import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideoEngine } from '@/lib/hooks/useVideoEngine';
import { useAppStore } from '@/lib/store';
import { initialTimelineState } from '@/lib/store/timeline-slice';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';

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
  const orig = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'video') return new MockVideoElement() as unknown as HTMLVideoElement;
    return orig(tag);
  });
  useAppStore.setState((s) => ({
    timeline: { ...initialTimelineState, tracks: [...initialTimelineState.tracks], clips: [] },
    media: { mediaRefs: [] },
    audio: { ...s.audio, grid: { bpm: 120, source: 'manual', beatsPerBar: 4, offsetMs: 0 } },
    ui: {
      zoom: 1,
      selectedClipId: null,
      automationEditorClipId: null,
      automationSnap: 'off',
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
        media: { mediaRefs: [VIDEO_REF] },
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
        media: { mediaRefs: [VIDEO_REF] },
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
});
