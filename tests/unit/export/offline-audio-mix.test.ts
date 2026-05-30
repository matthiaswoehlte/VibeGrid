import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mixAudioOffline, type VideoAudioClip } from '@/lib/export/mix-audio-offline';
import type { Clip } from '@/lib/timeline/types';
import type { MediaRef } from '@/lib/storage/types';

/**
 * Plan 5.9d Task 7 — `mixAudioOffline` test coverage.
 *
 * Mocks `OfflineAudioContext` per test so we can observe:
 * - `createBufferSource` + `createGain` invocations
 * - `setValueAtTime` calls on the gain node (volume automation)
 * - `start(when, offset)` calls on the source (per-clip timing)
 * - the rendered buffer (controlled output for peak / normalise tests)
 *
 * `decodeAudioData` returns a fake AudioBuffer with the requested
 * sample values so the test can verify mixing math.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface MockGain {
  gain: {
    value: number;
    setValueAtTime: ReturnType<typeof vi.fn>;
    linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
}
interface MockSource {
  buffer: AudioBuffer | null;
  start: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
}

class MockOfflineAudioContext {
  channels: number;
  totalSamples: number;
  sampleRate: number;
  destination = {} as AudioDestinationNode;
  createdGains: MockGain[] = [];
  createdSources: MockSource[] = [];
  /** Test override — when set, controls what `startRendering` returns. */
  static renderResult: AudioBuffer | null = null;
  /** Test override — when set, controls what `decodeAudioData` returns. */
  static decodeImpl: ((buf: ArrayBuffer) => Promise<AudioBuffer>) | null = null;

  constructor(channels: number, totalSamples: number, sampleRate: number) {
    this.channels = channels;
    this.totalSamples = totalSamples;
    this.sampleRate = sampleRate;
  }

  createGain(): GainNode {
    const g: MockGain = {
      gain: {
        value: 1.0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn()
      },
      connect: vi.fn()
    };
    this.createdGains.push(g);
    return g as unknown as GainNode;
  }

  createBufferSource(): AudioBufferSourceNode {
    const s: MockSource = {
      buffer: null,
      start: vi.fn(),
      connect: vi.fn()
    };
    this.createdSources.push(s);
    return s as unknown as AudioBufferSourceNode;
  }

  async decodeAudioData(buf: ArrayBuffer): Promise<AudioBuffer> {
    if (MockOfflineAudioContext.decodeImpl) {
      return MockOfflineAudioContext.decodeImpl(buf);
    }
    return makeFakeBuffer(48000, 1.0);
  }

  async startRendering(): Promise<AudioBuffer> {
    return MockOfflineAudioContext.renderResult ?? makeFakeBuffer(this.totalSamples, 0);
  }
}

/** Helper — fake AudioBuffer with `fillValue` in every sample. */
function makeFakeBuffer(length: number, fillValue: number): AudioBuffer {
  const data = new Float32Array(length).fill(fillValue);
  return {
    sampleRate: 48000,
    length,
    duration: length / 48000,
    numberOfChannels: 2,
    getChannelData: () => data
  } as unknown as AudioBuffer;
}

beforeEach(() => {
  (globalThis as any).OfflineAudioContext = MockOfflineAudioContext;
  MockOfflineAudioContext.renderResult = null;
  MockOfflineAudioContext.decodeImpl = null;
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    arrayBuffer: async () => new ArrayBuffer(8)
  } as Response);
});
afterEach(() => {
  delete (globalThis as any).OfflineAudioContext;
  vi.restoreAllMocks();
});

function makeAudioClip(over: Partial<Clip> = {}): Clip {
  return {
    id: 'c-a',
    trackId: 'track-audio',
    kind: 'audio',
    mediaId: 'm-a',
    startBeat: 0,
    lengthBeats: 16,
    label: 'a',
    ...over
  };
}
function makeRef(over: Partial<MediaRef> = {}): MediaRef {
  return {
    id: 'm-a',
    kind: 'audio',
    url: 'https://example.com/a.mp3',
    filename: 'a.mp3',
    duration: 10,
    uploadedAt: new Date().toISOString(),
    ...over
  };
}

describe('mixAudioOffline (Plan 5.9d)', () => {
  it('single clip + static volume 0.5: setValueAtTime called with 0.5 at every step', async () => {
    const clip = makeAudioClip({ params: { volume: 0.5 }, lengthBeats: 4 });
    let createdCtx: MockOfflineAudioContext | null = null;
    (globalThis as any).OfflineAudioContext = class extends MockOfflineAudioContext {
      constructor(c: number, s: number, sr: number) {
        super(c, s, sr);
        createdCtx = this;
      }
    };
    await mixAudioOffline([clip], [makeRef()], 120, 10);
    expect(createdCtx).not.toBeNull();
    const gain = (createdCtx as unknown as MockOfflineAudioContext).createdGains[0];
    expect(gain).toBeDefined();
    expect(gain!.gain.setValueAtTime).toHaveBeenCalled();
    // Every call should pass the static 0.5 value.
    for (const call of gain!.gain.setValueAtTime.mock.calls) {
      expect(call[0]).toBe(0.5);
    }
  });

  it('volume automation 0→1 over 4 beats: setValueAtTime called per 0.1-beat step', async () => {
    const clip = makeAudioClip({
      lengthBeats: 4,
      params: {
        volume: {
          mode: 'automation',
          interpolation: 'linear',
          points: [
            { beat: 0, value: 0 },
            { beat: 4, value: 1 }
          ]
        }
      }
    });
    let createdCtx: MockOfflineAudioContext | null = null;
    (globalThis as any).OfflineAudioContext = class extends MockOfflineAudioContext {
      constructor(c: number, s: number, sr: number) {
        super(c, s, sr);
        createdCtx = this;
      }
    };
    await mixAudioOffline([clip], [makeRef()], 120, 10);
    const gain = (createdCtx as unknown as MockOfflineAudioContext).createdGains[0];
    // 4 beats / 0.1 step + 1 (inclusive endpoint) = 41 calls.
    expect(gain!.gain.setValueAtTime.mock.calls.length).toBe(41);
    // First call: value=0 at the clip's start time (beat 0 @ 120 BPM = 0 sec).
    expect(gain!.gain.setValueAtTime.mock.calls[0][0]).toBe(0);
    expect(gain!.gain.setValueAtTime.mock.calls[0][1]).toBe(0);
    // Last call: value=1.
    expect(gain!.gain.setValueAtTime.mock.calls[40][0]).toBe(1);
  });

  it('two overlapping clips: both sources created and connected', async () => {
    const clipA = makeAudioClip({ id: 'a', startBeat: 0, lengthBeats: 8 });
    const clipB = makeAudioClip({ id: 'b', mediaId: 'm-b', startBeat: 4, lengthBeats: 8 });
    let createdCtx: MockOfflineAudioContext | null = null;
    (globalThis as any).OfflineAudioContext = class extends MockOfflineAudioContext {
      constructor(c: number, s: number, sr: number) {
        super(c, s, sr);
        createdCtx = this;
      }
    };
    await mixAudioOffline(
      [clipA, clipB],
      [makeRef({ id: 'm-a' }), makeRef({ id: 'm-b' })],
      120,
      10
    );
    expect((createdCtx as unknown as MockOfflineAudioContext).createdSources).toHaveLength(2);
  });

  it('video-audio: source added when audioEnabled is true', async () => {
    const vc: VideoAudioClip = {
      url: 'https://example.com/v.mp4',
      startBeat: 0,
      lengthBeats: 16,
      audioEnabled: true
    };
    let createdCtx: MockOfflineAudioContext | null = null;
    (globalThis as any).OfflineAudioContext = class extends MockOfflineAudioContext {
      constructor(c: number, s: number, sr: number) {
        super(c, s, sr);
        createdCtx = this;
      }
    };
    await mixAudioOffline([], [], 120, 10, [vc]);
    expect((createdCtx as unknown as MockOfflineAudioContext).createdSources).toHaveLength(1);
  });

  it('video without an audio track: decodeAudioData reject is swallowed, mix continues', async () => {
    const vc: VideoAudioClip = {
      url: 'https://example.com/v.mp4',
      startBeat: 0,
      lengthBeats: 16,
      audioEnabled: true
    };
    MockOfflineAudioContext.decodeImpl = async () => {
      throw new Error('EncodingError');
    };
    let createdCtx: MockOfflineAudioContext | null = null;
    (globalThis as any).OfflineAudioContext = class extends MockOfflineAudioContext {
      constructor(c: number, s: number, sr: number) {
        super(c, s, sr);
        createdCtx = this;
      }
    };
    // Must NOT throw — silent skip when video has no audio track.
    const result = await mixAudioOffline([], [], 120, 10, [vc]);
    expect(result).toBeDefined();
    expect((createdCtx as unknown as MockOfflineAudioContext).createdSources).toHaveLength(0);
  });

  it('peak normalisation triggered when summed peak > 1.0', async () => {
    // Single-channel fake — real AudioBuffer.getChannelData returns
    // distinct arrays per channel; the simple shared-array mock here
    // would double-scale across channels otherwise.
    const overLoudBuffer: AudioBuffer = (() => {
      const data = new Float32Array(48000).fill(1.5);
      return {
        sampleRate: 48000,
        length: 48000,
        duration: 1,
        numberOfChannels: 1,
        getChannelData: () => data
      } as unknown as AudioBuffer;
    })();
    MockOfflineAudioContext.renderResult = overLoudBuffer;
    const out = await mixAudioOffline([], [], 120, 1);
    // Samples should scale from 1.5 to ~0.95 (peak target).
    const data = out.getChannelData(0);
    expect(data[0]).toBeCloseTo(0.95, 5);
  });

  it('peak normalisation NOT triggered when summed peak ≤ 1.0', async () => {
    const quietBuffer: AudioBuffer = (() => {
      const data = new Float32Array(48000).fill(0.8);
      return {
        sampleRate: 48000,
        length: 48000,
        duration: 1,
        numberOfChannels: 1,
        getChannelData: () => data
      } as unknown as AudioBuffer;
    })();
    MockOfflineAudioContext.renderResult = quietBuffer;
    const out = await mixAudioOffline([], [], 120, 1);
    const data = out.getChannelData(0);
    // Float32 stores 0.8 as 0.800000011920929 — toBeCloseTo handles the
    // 32-bit precision delta.
    expect(data[0]).toBeCloseTo(0.8, 5);
  });

  it('clip starting after totalDurationSec renders silence without throw', async () => {
    // Clip on beat 100 (~50s @ 120 BPM); export ends at 10s.
    const clip = makeAudioClip({ startBeat: 100, lengthBeats: 16 });
    let createdCtx: MockOfflineAudioContext | null = null;
    (globalThis as any).OfflineAudioContext = class extends MockOfflineAudioContext {
      constructor(c: number, s: number, sr: number) {
        super(c, s, sr);
        createdCtx = this;
      }
    };
    const out = await mixAudioOffline([clip], [makeRef()], 120, 10);
    expect(out).toBeDefined();
    // Source skipped (would be after the export window) — no source created.
    expect((createdCtx as unknown as MockOfflineAudioContext).createdSources).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Plan 9d Task 4 — Audio windowing (W1) tests
// ---------------------------------------------------------------------------
describe('mixAudioOffline — export range (W1)', () => {
  // Helper: capture the mock context plus run mixAudioOffline with a range.
  async function runWithRange(
    clips: Clip[],
    refs: MediaRef[],
    bpm: number,
    totalDurationSec: number,
    exportRange: { start: number; end: number },
    videoAudioClips: VideoAudioClip[] = []
  ): Promise<{ ctx: MockOfflineAudioContext; result: AudioBuffer }> {
    let createdCtx: MockOfflineAudioContext | null = null;
    (globalThis as any).OfflineAudioContext = class extends MockOfflineAudioContext {
      constructor(c: number, s: number, sr: number) {
        super(c, s, sr);
        createdCtx = this;
      }
    };
    const result = await mixAudioOffline(
      clips,
      refs,
      bpm,
      totalDurationSec,
      videoAudioClips,
      exportRange
    );
    return { ctx: createdCtx as unknown as MockOfflineAudioContext, result };
  }

  // Test 21 — clip inside window (rel >= 0): source.start(rel, 0)
  it('21: clip inside window (abs t=12s, rangeStart=10s) → start(when=2, offset=0)', async () => {
    // 120 BPM → beat 24 = 12s; beat 20 = 10s; range end = beat 40 = 20s
    const clip = makeAudioClip({ startBeat: 24, lengthBeats: 4 }); // starts at 12s
    const { ctx } = await runWithRange(
      [clip],
      [makeRef()],
      120,
      20,
      { start: 10, end: 20 }
    );
    expect(ctx.createdSources).toHaveLength(1);
    const source = ctx.createdSources[0];
    expect(source.start).toHaveBeenCalledOnce();
    const [when, offset] = source.start.mock.calls[0] as [number, number];
    // rel = 12 - 10 = 2; no negative-when → start(2, 0)
    expect(when).toBeCloseTo(2, 5);
    expect(offset).toBeCloseTo(0, 5);
  });

  // Test 22 — clip overhangs window start (rel < 0): source.start(0, -rel)
  it('22: clip overhangs window start (abs t=8s, rangeStart=10s) → start(when=0, offset=2)', async () => {
    // 120 BPM → beat 16 = 8s; range start = beat 20 = 10s; range end = beat 40 = 20s
    const clip = makeAudioClip({ startBeat: 16, lengthBeats: 8 }); // 8s–12s, overlaps [10,20]
    const { ctx } = await runWithRange(
      [clip],
      [makeRef()],
      120,
      20,
      { start: 10, end: 20 }
    );
    expect(ctx.createdSources).toHaveLength(1);
    const source = ctx.createdSources[0];
    expect(source.start).toHaveBeenCalledOnce();
    const [when, offset] = source.start.mock.calls[0] as [number, number];
    // rel = 8 - 10 = -2; negative-when avoided → start(0, 2)
    expect(when).toBeCloseTo(0, 5);
    expect(offset).toBeCloseTo(2, 5);
  });

  // Test 23 — guard rebased: skip clips outside the window
  it('23a: clip starting after rangeEnd is skipped (no source created)', async () => {
    // Clip at beat 50 = 25s; range = [10,20]
    const clip = makeAudioClip({ startBeat: 50, lengthBeats: 4 }); // starts at 25s
    const { ctx } = await runWithRange(
      [clip],
      [makeRef()],
      120,
      30,
      { start: 10, end: 20 }
    );
    // Clip starts after rangeEnd → must be skipped
    expect(ctx.createdSources).toHaveLength(0);
  });

  it('23b: clip ending before rangeStart is skipped (no source created)', async () => {
    // Clip at beat 0 = 0s, lengthBeats=4 → ends at 2s; range = [10,20]
    const clip = makeAudioClip({ startBeat: 0, lengthBeats: 4 }); // 0s–2s
    const { ctx } = await runWithRange(
      [clip],
      [makeRef()],
      120,
      30,
      { start: 10, end: 20 }
    );
    // Clip ends before rangeStart → must be skipped
    expect(ctx.createdSources).toHaveLength(0);
  });

  // Test 21-v (video-audio path): same W1 split applies to video-audio clips
  it('21-v: video-audio clip inside window → start(when=2, offset=0)', async () => {
    const vc: VideoAudioClip = {
      url: 'https://example.com/v.mp4',
      startBeat: 24, // 12s at 120 BPM
      lengthBeats: 8, // ends at 16s — inside [10,20]
      audioEnabled: true
    };
    const { ctx } = await runWithRange(
      [],
      [],
      120,
      20,
      { start: 10, end: 20 },
      [vc]
    );
    expect(ctx.createdSources).toHaveLength(1);
    const source = ctx.createdSources[0];
    expect(source.start).toHaveBeenCalledOnce();
    const [when, offset] = source.start.mock.calls[0] as [number, number];
    expect(when).toBeCloseTo(2, 5);
    expect(offset).toBeCloseTo(0, 5);
  });

  it('22-v: video-audio clip overhangs window start → start(when=0, offset=2)', async () => {
    const vc: VideoAudioClip = {
      url: 'https://example.com/v.mp4',
      startBeat: 16, // 8s at 120 BPM, overlaps [10,20]
      lengthBeats: 8, // ends at 12s — overlaps [10,20]
      audioEnabled: true
    };
    const { ctx } = await runWithRange(
      [],
      [],
      120,
      20,
      { start: 10, end: 20 },
      [vc]
    );
    expect(ctx.createdSources).toHaveLength(1);
    const source = ctx.createdSources[0];
    expect(source.start).toHaveBeenCalledOnce();
    const [when, offset] = source.start.mock.calls[0] as [number, number];
    expect(when).toBeCloseTo(0, 5);
    expect(offset).toBeCloseTo(2, 5);
  });

  // Test 23b-v — symmetric video-audio guard: skip clip entirely before window
  it('23b-v: video-audio clip ending before rangeStart is skipped (no source created)', async () => {
    // 120 BPM → startBeat=4 → startSec=2s; lengthBeats=10 → endSec=7s; range=[10,20]
    // Clip fully precedes window → must be skipped without fetching/decoding.
    const vc: VideoAudioClip = {
      url: 'https://example.com/v-before.mp4',
      startBeat: 4,      // startSec = 2s
      lengthBeats: 10,   // endSec   = 7s  (entirely before rangeStart=10s)
      audioEnabled: true
    };
    const { ctx } = await runWithRange(
      [],
      [],
      120,
      30,
      { start: 10, end: 20 },
      [vc]
    );
    // Clip ends at 7s which is ≤ rangeStart=10s → must be skipped entirely
    expect(ctx.createdSources).toHaveLength(0);
  });

  // Test 24 — automation-overhang: gain.setValueAtTime at windowTimeSec=0 reflects
  // the curve value at the window-entry moment (absoluteTime == rangeStart).
  // A clip that starts before rangeStart overhangs into the window. The
  // automation raster emits events at each 0.1-beat step; those that land before
  // rangeStart are clamped to windowTimeSec=0 via Math.max(0, abs - rangeStart).
  // The LAST such clamped event should carry the gain value for the beat that
  // corresponds to absoluteTime == rangeStart (the window-entry moment).
  // No event should be scheduled at a negative windowTimeSec.
  it('24: automation-overhang — last setValueAtTime at t=0 carries curve value at window entry; no negative time', async () => {
    // 120 BPM → 2 beats/sec.
    // Clip: startBeat=16 → startSec=8s; lengthBeats=8 → endSec=16s.
    // Range: start=10s → rangeStart beat-equivalent = 10s → 20 beats at 120 BPM.
    // Clip overhangs window start by 2 s (2 beats). Window-entry moment is at
    // beat 4 (clip-relative) = absoluteTime 10s.
    // Linear volume automation 0→1 over 8 beats:
    //   at beat 4 (clip-relative) value = 0.5 (halfway through the 0→1 fade).
    const clip = makeAudioClip({
      startBeat: 16,       // startSec = 8s
      lengthBeats: 8,      // endSec   = 16s  — overlaps [10,20]
      params: {
        volume: {
          mode: 'automation' as const,
          interpolation: 'linear' as const,
          points: [
            { beat: 0, value: 0 },
            { beat: 8, value: 1 }
          ]
        }
      }
    });
    const { ctx } = await runWithRange(
      [clip],
      [makeRef()],
      120,
      20,
      { start: 10, end: 20 }
    );
    const gain = ctx.createdGains[0];
    expect(gain).toBeDefined();
    const calls = gain!.gain.setValueAtTime.mock.calls as [number, number][];

    // 1. No event should be scheduled at a negative windowTimeSec.
    for (const [, t] of calls) {
      expect(t).toBeGreaterThanOrEqual(0);
    }

    // 2. All events that fall before the window (absoluteTime < rangeStart) must be
    //    clamped to windowTimeSec = 0.
    //    The last such clamped event is the one whose absoluteTime is closest to
    //    rangeStart from below — it carries the curve value closest to the entry moment.
    const atZero = calls.filter(([, t]) => t === 0);
    expect(atZero.length).toBeGreaterThan(0);

    // 3. The LAST setValueAtTime at windowTimeSec=0 should carry the curve value
    //    at the window-entry moment (absoluteTime == rangeStart = 10s).
    //    rangeStart=10s; clip.startBeat=16 (startSec=8s); entry beat (clip-rel) = 4.
    //    Linear 0→1 over 8 beats: value at beat 4 = 0.5.
    const lastAtZero = atZero[atZero.length - 1];
    expect(lastAtZero[0]).toBeCloseTo(0.5, 5);
  });

  // Regression guard — no-range path: source.start(startSec, 0) unchanged
  it('regression: no-range path schedules source.start(startSec, 0) as before', async () => {
    // 120 BPM, startBeat=8 → startSec = 4s
    const clip = makeAudioClip({ startBeat: 8, lengthBeats: 4 });
    let createdCtx: MockOfflineAudioContext | null = null;
    (globalThis as any).OfflineAudioContext = class extends MockOfflineAudioContext {
      constructor(c: number, s: number, sr: number) {
        super(c, s, sr);
        createdCtx = this;
      }
    };
    await mixAudioOffline([clip], [makeRef()], 120, 10);
    const ctx = createdCtx as unknown as MockOfflineAudioContext;
    expect(ctx.createdSources).toHaveLength(1);
    const [when, offset] = ctx.createdSources[0].start.mock.calls[0] as [number, number];
    expect(when).toBeCloseTo(4, 5);
    expect(offset).toBeCloseTo(0, 5);
  });
});
