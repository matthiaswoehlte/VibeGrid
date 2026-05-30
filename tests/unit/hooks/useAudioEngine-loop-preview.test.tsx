'use client';
/**
 * Plan 9d — Feature 2: Loop-Preview
 *
 * Tests 10–16 from the plan spec.
 *
 * Naming:
 *   Test 10 = playhead before rangeStart → reaches rangeEnd → wraps
 *   Test 11 = playhead inside range → loops
 *   Test 12 = playhead after rangeEnd at play-start → plays past, no loop
 *   Test 13 = stop → playhead holds, no reset
 *   Test 14 = no range → normal play, no wrap
 *   Test 15 = on wrap: engine.seek(rangeStart), seekNonce bumped, plugin.onSeek called
 *   Test 16 = loop-wrap works with NO sync-soundtrack (fallback clock case)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioEngine } from '@/lib/hooks/useAudioEngine';
import { useAppStore } from '@/lib/store';
import { register, _resetRegistryForTests } from '@/lib/renderer/registry';
import { particlesPlugin } from '@/lib/fx/particles';
import type { AudioEngine } from '@/lib/audio/engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFxTrack(id = 'track-fx') {
  return { id, kind: 'fx' as const, name: 'FX', muted: false };
}

function makeParticlesClip(
  id: string,
  startBeat: number,
  lengthBeats: number,
  trackId = 'track-fx'
) {
  return {
    id,
    trackId,
    kind: 'particles' as const,
    startBeat,
    lengthBeats,
    label: 'P',
    params: {},
    mediaId: undefined
  };
}

/** Seed the store for loop-preview tests. BPM=120 → 1 beat = 0.5 s. */
function seedStore(opts: {
  beats?: number;
  playing?: boolean;
  exportRange?: { start: number; end: number } | null;
  fxClips?: ReturnType<typeof makeParticlesClip>[];
}) {
  useAppStore.setState((s) => ({
    audio: { grid: { bpm: 120, offsetMs: 0, beatsPerBar: 4, source: 'manual' } },
    ui: {
      ...s.ui,
      exportRange: opts.exportRange ?? null,
      seekNonce: 0
    },
    timeline: {
      tracks: [
        { id: 'track-audio', kind: 'audio' as const, name: 'Audio', muted: false },
        ...(opts.fxClips?.length ? [makeFxTrack()] : [])
      ],
      clips: opts.fxClips ?? [],
      playhead: {
        beats: opts.beats ?? 0,
        playing: opts.playing ?? false
      },
      zoom: 1,
      snap: 'beat' as const
    },
    media: { mediaRefs: [], videoLoadProgress: {} }
  }));
}

// ---------------------------------------------------------------------------
// Setup: stub fetch + AudioContext.decodeAudioData (same as existing tests)
// ---------------------------------------------------------------------------

beforeEach(() => {
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

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: drive engine.onStateChange by calling seek on the engine.
// The mirror in useAudioEngine fires onStateChange when seek is called,
// which is the same path the fallback-clock uses (setState → listeners).
// ---------------------------------------------------------------------------

function advanceEngine(engine: AudioEngine, newTimeSec: number) {
  engine.seek(newTimeSec);
}

// ---------------------------------------------------------------------------
// Tests 10–14: basic loop-wrap behaviour
// ---------------------------------------------------------------------------

describe('Plan 9d — Loop-Preview: basic wrap behaviour', () => {
  it('Test 10: playhead before rangeStart — reaches rangeEnd → wraps to rangeStart', async () => {
    // range: [4s, 8s]. Playhead starts at beat 0 (0 s). BPM=120 → beats = 2×sec.
    const rangeStart = 4;
    const rangeEnd = 8;
    seedStore({
      beats: 0,
      playing: false,
      exportRange: { start: rangeStart, end: rangeEnd }
    });

    const { result } = renderHook(() => useAudioEngine());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const engine = result.current.engine!;

    // Start playing — playhead at 0 s (before rangeStart=4s).
    // Capture seek spy AFTER the play transition (so it doesn't capture the
    // initial seek(0) call that may come from play-start).
    act(() => {
      useAppStore.getState().recordingSet('Play', (s) => {
        s.timeline.playhead.playing = true;
      }, { skip: true });
    });

    const seekSpy = vi.spyOn(engine, 'seek');

    // Advance to rangeEnd (8 s) → wrap must fire
    act(() => { advanceEngine(engine, rangeEnd); });

    // seek(rangeStart) must have been called
    expect(seekSpy).toHaveBeenCalledWith(rangeStart);
  });

  it('Test 11: playhead inside range → loops on reaching rangeEnd', async () => {
    const rangeStart = 4;
    const rangeEnd = 8;
    // Playhead starts at beat 10 = 5 s (inside [4, 8]).
    seedStore({
      beats: 10,
      playing: false,
      exportRange: { start: rangeStart, end: rangeEnd }
    });

    const { result } = renderHook(() => useAudioEngine());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const engine = result.current.engine!;
    // Align engine currentTime to 5s (= beat 10 @ 120bpm).
    act(() => { engine.seek(5); });

    act(() => {
      useAppStore.getState().recordingSet('Play', (s) => {
        s.timeline.playhead.playing = true;
      }, { skip: true });
    });

    const seekSpy = vi.spyOn(engine, 'seek');

    // Advance to rangeEnd → loop fires
    act(() => { advanceEngine(engine, rangeEnd); });

    expect(seekSpy).toHaveBeenCalledWith(rangeStart);
  });

  it('Test 12: playhead AFTER rangeEnd at play-start → plays past, no loop', async () => {
    const rangeStart = 4;
    const rangeEnd = 8;
    // Playhead starts at beat 20 = 10 s (after rangeEnd=8s).
    seedStore({
      beats: 20,
      playing: false,
      exportRange: { start: rangeStart, end: rangeEnd }
    });

    const { result } = renderHook(() => useAudioEngine());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const engine = result.current.engine!;
    // Align engine currentTime to 10s.
    act(() => { engine.seek(10); });

    act(() => {
      useAppStore.getState().recordingSet('Play', (s) => {
        s.timeline.playhead.playing = true;
      }, { skip: true });
    });

    const seekSpy = vi.spyOn(engine, 'seek');

    // Advance beyond rangeEnd even further → no loop
    act(() => { advanceEngine(engine, 12); });

    // seek must not have been called with rangeStart (4)
    expect(seekSpy).not.toHaveBeenCalledWith(rangeStart);
  });

  it('Test 13: stop → playhead holds at current position, no reset to rangeStart', async () => {
    const rangeStart = 4;
    const rangeEnd = 8;
    seedStore({
      beats: 10, // = 5 s, inside range
      playing: true,
      exportRange: { start: rangeStart, end: rangeEnd }
    });

    const { result } = renderHook(() => useAudioEngine());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const engine = result.current.engine!;
    act(() => { engine.seek(5); }); // currentTime = 5s

    const seekSpy = vi.spyOn(engine, 'seek');

    // Stop playback
    act(() => {
      useAppStore.getState().recordingSet('Stop', (s) => {
        s.timeline.playhead.playing = false;
      }, { skip: true });
    });

    // No seek-to-rangeStart should have happened
    expect(seekSpy).not.toHaveBeenCalledWith(rangeStart);

    // Playhead stays at beat 10 (was not reset)
    expect(useAppStore.getState().timeline.playhead.beats).toBe(10);
  });

  it('Test 14: no range → normal play, no wrap fires', async () => {
    seedStore({
      beats: 0,
      playing: false,
      exportRange: null
    });

    const { result } = renderHook(() => useAudioEngine());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const engine = result.current.engine!;

    act(() => {
      useAppStore.getState().recordingSet('Play', (s) => {
        s.timeline.playhead.playing = true;
      }, { skip: true });
    });

    const seekSpy = vi.spyOn(engine, 'seek');

    // Advance time far beyond any reasonable range end → no wrap
    act(() => { advanceEngine(engine, 999); });

    // seek may have been called with 999 (from advanceEngine itself),
    // but must NOT have been called with a small "wrap" target.
    // Since there is no range, rangeStart would be 0 if wrap fired; any
    // call with value 0 would be a false-positive (seek(0) = wrap to start).
    // The safer assertion: none of the calls have value < 100.
    const smallSeekFired = seekSpy.mock.calls.some(([s]) => s < 100);
    expect(smallSeekFired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 15: seek() + seekNonce + plugin.onSeek on wrap
// ---------------------------------------------------------------------------

describe('Plan 9d — Loop-Preview: wrap calls engine.seek + bumps seekNonce + calls plugin.onSeek', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    // Register the real particles plugin so listPluginsByKind('Particle') resolves it.
    // Spy on its onSeek to verify the call.
    register(particlesPlugin);
  });

  afterEach(() => {
    _resetRegistryForTests();
  });

  it('Test 15: on wrap — engine.seek(rangeStart) + seekNonce bumped + plugin.onSeek for active FX clips', async () => {
    const rangeStart = 4;
    const rangeEnd = 8;

    // Particles clip: starts at beat 0 (0s), spans 20 beats (10s) → active at any point in [0, 10s].
    const fxClip = makeParticlesClip('fx-particles-1', 0, 20);

    seedStore({
      beats: 10, // 5s, inside range
      playing: false,
      exportRange: { start: rangeStart, end: rangeEnd },
      fxClips: [fxClip]
    });

    expect(useAppStore.getState().ui.seekNonce).toBe(0);

    // Spy on the real plugin's onSeek BEFORE mounting (so the hook closure captures the spy).
    const onSeekSpy = vi.spyOn(particlesPlugin, 'onSeek');

    const { result } = renderHook(() => useAudioEngine());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const engine = result.current.engine!;
    // Align engine currentTime to 5s.
    act(() => { engine.seek(5); });

    // Capture initial nonce.
    const initialNonce = useAppStore.getState().ui.seekNonce;

    // Start playing.
    act(() => {
      useAppStore.getState().recordingSet('Play', (s) => {
        s.timeline.playhead.playing = true;
      }, { skip: true });
    });

    const seekSpy = vi.spyOn(engine, 'seek');

    // Advance to rangeEnd → triggers wrap
    act(() => { advanceEngine(engine, rangeEnd); });

    // (a) engine.seek called with rangeStart
    expect(seekSpy).toHaveBeenCalledWith(rangeStart);

    // (b) seekNonce bumped
    expect(useAppStore.getState().ui.seekNonce).toBeGreaterThan(initialNonce);

    // (c) plugin.onSeek called for the active FX clip
    expect(onSeekSpy).toHaveBeenCalledWith(fxClip.id);
  });
});

// ---------------------------------------------------------------------------
// Test 16: fallback-clock case — loop-wrap works without sync-soundtrack
// ---------------------------------------------------------------------------

describe('Plan 9d — Loop-Preview: works without sync-soundtrack (fallback clock)', () => {
  it('Test 16: loop-wrap fires correctly when no audioEl is loaded (fallback clock path)', async () => {
    // No sync-audio in mediaRefs — engine uses fallback clock.
    const rangeStart = 2;
    const rangeEnd = 6;
    seedStore({
      beats: 4,   // = 2 s — inside range
      playing: false,
      exportRange: { start: rangeStart, end: rangeEnd }
    });

    const { result } = renderHook(() => useAudioEngine());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const engine = result.current.engine!;
    // Set engine currentTime to 2s (inside range, no audioEl).
    act(() => { engine.seek(2); });

    act(() => {
      useAppStore.getState().recordingSet('Play', (s) => {
        s.timeline.playhead.playing = true;
      }, { skip: true });
    });

    const seekSpy = vi.spyOn(engine, 'seek');

    // Advance to rangeEnd via seek (simulates fallback clock firing onStateChange).
    act(() => { advanceEngine(engine, rangeEnd); });

    // Even without a sync-soundtrack, the wrap must fire.
    expect(seekSpy).toHaveBeenCalledWith(rangeStart);

    // seekNonce must be bumped (proves the seek-counter path triggered).
    expect(useAppStore.getState().ui.seekNonce).toBeGreaterThan(0);
  });
});
