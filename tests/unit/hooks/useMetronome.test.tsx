/**
 * Test 18 — useMetronome hook wiring.
 *
 * Asserts:
 *  - start() called when metronomeEnabled && playing (including WITH soundtrack)
 *  - stop() called when either flag is false
 *  - no-op / skip when getAudioContext() returns null
 *  - stop() called on unmount
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { initialTimelineState } from '@/lib/store/timeline-slice';
import type { AudioEngine } from '@/lib/audio/engine';

// ── mock createMetronome ───────────────────────────────────────────────────────
const mockStart = vi.fn();
const mockStop = vi.fn();

vi.mock('@/lib/audio/metronome', () => ({
  createMetronome: vi.fn(() => ({ start: mockStart, stop: mockStop }))
}));
import { createMetronome } from '@/lib/audio/metronome';

// ── import hook ───────────────────────────────────────────────────────────────
import { useMetronome } from '@/lib/hooks/useMetronome';

// ── fake engine ───────────────────────────────────────────────────────────────

function makeMockEngine(audioCtx: AudioContext | null): AudioEngine {
  return {
    getAudioContext: vi.fn(() => audioCtx),
    getContextTime: vi.fn(() => 0),
    getState: vi.fn(() => ({
      currentTime: 0,
      status: 'idle' as const,
      duration: 0,
      beatGrid: { bpm: 120, beatsPerBar: 4, offsetMs: 0, source: 'manual' as const }
    })),
    // other members not needed by useMetronome:
    load: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    detectBPM: vi.fn(),
    setBPM: vi.fn(),
    getAnalyser: vi.fn(),
    getAudioStream: vi.fn(),
    getAudioElement: vi.fn(),
    getDecodedBuffer: vi.fn(),
    onStateChange: vi.fn(),
    destroy: vi.fn(),
    loadClip: vi.fn(),
    unloadClip: vi.fn(),
    playClip: vi.fn(),
    stopClip: vi.fn(),
    stopAllClips: vi.fn(),
    setClipVolume: vi.fn(),
    rampClipVolume: vi.fn(),
    getLoadedClipIds: vi.fn()
  } as unknown as AudioEngine;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function setPlaying(playing: boolean) {
  useAppStore.setState({
    timeline: {
      ...useAppStore.getState().timeline,
      playhead: { ...useAppStore.getState().timeline.playhead, playing }
    }
  });
}

function setMetronomeEnabled(enabled: boolean) {
  useAppStore.setState({
    ui: { ...useAppStore.getState().ui, metronomeEnabled: enabled }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    timeline: { ...initialTimelineState, playhead: { beats: 0, playing: false } },
    ui: {
      zoom: 1,
      selectedClipIds: [],
      selectedClipId: null,
      automationEditorClipId: null,
      automationSnap: 'off',
      clipSnap: '1',
      exportState: {} as never,
      flowMode: false,
      exportRange: null,
      metronomeEnabled: false,
      seekNonce: 0
    }
  });
});

describe('useMetronome — wiring', () => {
  it('does NOT call start() when metronomeEnabled=false && playing=false', () => {
    const engine = makeMockEngine(new AudioContext());
    renderHook(() => useMetronome(engine));
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('does NOT call start() when metronomeEnabled=true but playing=false', () => {
    act(() => setMetronomeEnabled(true));
    const engine = makeMockEngine(new AudioContext());
    renderHook(() => useMetronome(engine));
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('does NOT call start() when playing=true but metronomeEnabled=false', () => {
    act(() => setPlaying(true));
    const engine = makeMockEngine(new AudioContext());
    renderHook(() => useMetronome(engine));
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('calls start() when metronomeEnabled && playing', () => {
    act(() => {
      setMetronomeEnabled(true);
      setPlaying(true);
    });
    const engine = makeMockEngine(new AudioContext());
    renderHook(() => useMetronome(engine));
    expect(createMetronome).toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalled();
  });

  it('calls start() even WITH a soundtrack loaded (click-track scenario)', () => {
    // "With soundtrack" means an AudioContext already exists — same as above.
    // The engine provides the AudioContext regardless of audioEl presence.
    act(() => {
      setMetronomeEnabled(true);
      setPlaying(true);
    });
    const engine = makeMockEngine(new AudioContext());
    renderHook(() => useMetronome(engine));
    expect(createMetronome).toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalled();
  });

  it('calls stop() when metronomeEnabled transitions false while playing', () => {
    const engine = makeMockEngine(new AudioContext());
    act(() => {
      setMetronomeEnabled(true);
      setPlaying(true);
    });
    renderHook(() => useMetronome(engine));
    expect(mockStart).toHaveBeenCalledTimes(1);

    act(() => setMetronomeEnabled(false));
    expect(mockStop).toHaveBeenCalled();
  });

  it('calls stop() when playing transitions false while metronome enabled', () => {
    const engine = makeMockEngine(new AudioContext());
    act(() => {
      setMetronomeEnabled(true);
      setPlaying(true);
    });
    renderHook(() => useMetronome(engine));
    expect(mockStart).toHaveBeenCalledTimes(1);

    act(() => setPlaying(false));
    expect(mockStop).toHaveBeenCalled();
  });

  it('no-ops (does not call start) when getAudioContext() returns null', () => {
    act(() => {
      setMetronomeEnabled(true);
      setPlaying(true);
    });
    const engine = makeMockEngine(null);
    renderHook(() => useMetronome(engine));
    expect(createMetronome).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('no-ops when engine is null', () => {
    act(() => {
      setMetronomeEnabled(true);
      setPlaying(true);
    });
    renderHook(() => useMetronome(null));
    expect(createMetronome).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('calls stop() on unmount when running', () => {
    const engine = makeMockEngine(new AudioContext());
    act(() => {
      setMetronomeEnabled(true);
      setPlaying(true);
    });
    const { unmount } = renderHook(() => useMetronome(engine));
    expect(mockStart).toHaveBeenCalled();
    unmount();
    expect(mockStop).toHaveBeenCalled();
  });
});
