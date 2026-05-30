import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderOffline } from '@/lib/export/offline-render';
import type { TimelineState } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── renderAt capture seam ────────────────────────────────────────────────────
// Tests 19 + 20 need to verify that renderOffline passes ABSOLUTE timeSec to
// renderAt, not range-relative time.  We wrap makeOfflineRenderer so every
// renderAt call pushes its timeSec argument into this array.
// The array is reset by individual tests; tests 17/18/24 ignore it.
const _renderAtTimeSecs: number[] = [];

vi.mock('@/lib/renderer/offline-tick', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/renderer/offline-tick')>();
  return {
    ...real,
    makeOfflineRenderer: (deps: Parameters<typeof real.makeOfflineRenderer>[0]) => {
      const renderer = real.makeOfflineRenderer(deps);
      return {
        renderAt(timeSec: number, videoFrames?: Map<string, VideoFrame>) {
          _renderAtTimeSecs.push(timeSec);
          renderer.renderAt(timeSec, videoFrames);
        }
      };
    }
  };
});

type Globalish = Record<string, any>;

interface MockVideoEncoderInstance {
  configure: (cfg: unknown) => void;
  encode: (frame: unknown, opts?: unknown) => void;
  flush: () => Promise<void>;
  encodeQueueSize: number;
  _output: (chunk: unknown, meta: unknown) => void;
  _error: (e: Error) => void;
}

const grid120: BeatGrid = {
  bpm: 120,
  source: 'manual',
  beatsPerBar: 4,
  offsetMs: 0
};

function emptyTimeline(): TimelineState {
  return {
    tracks: [],
    clips: [],
    playhead: { beats: 0, playing: false },
    zoom: 1,
    snap: 'beat'
  };
}

function fakeAudioBuffer(durationSec: number, sampleRate = 48000, channels = 2): AudioBuffer {
  const length = Math.round(durationSec * sampleRate);
  return {
    sampleRate,
    length,
    duration: durationSec,
    numberOfChannels: channels,
    getChannelData: (_i: number) => new Float32Array(length)
  } as unknown as AudioBuffer;
}

interface Installed {
  videoEncoderInstances: MockVideoEncoderInstance[];
  audioEncoderInstances: MockVideoEncoderInstance[];
  videoFramesCreated: number;
  audioDatasCreated: number;
}

function installWebCodecsMocks(overrides: {
  pickVideoSupported?: boolean;
  pickAudioSupported?: boolean;
  videoQueueSize?: () => number;
} = {}): Installed {
  const installed: Installed = {
    videoEncoderInstances: [],
    audioEncoderInstances: [],
    videoFramesCreated: 0,
    audioDatasCreated: 0
  };

  const makeEncoder = (output: any, error: any) => {
    const inst: MockVideoEncoderInstance = {
      configure: vi.fn(),
      encode: vi.fn((_chunk: unknown, _opts?: unknown) => {
        // Synthesize an "encoded" chunk for the muxer to receive.
        const ctor = (globalThis as Globalish).EncodedVideoChunk;
        const synthetic = new ctor({
          type: 'key',
          timestamp: 0,
          duration: 33333,
          data: new Uint8Array([0])
        });
        output(synthetic, {
          decoderConfig: {
            codec: 'avc1.42E01E',
            codedWidth: 1920,
            codedHeight: 1080,
            description: new Uint8Array([1, 2, 3, 4])
          }
        });
      }),
      flush: vi.fn(async () => undefined),
      encodeQueueSize: 0,
      _output: output,
      _error: error
    };
    if (overrides.videoQueueSize) {
      Object.defineProperty(inst, 'encodeQueueSize', {
        get: overrides.videoQueueSize
      });
    }
    return inst;
  };

  class MockVideoEncoder {
    static isConfigSupported = vi.fn(async (cfg: any) => ({
      supported: overrides.pickVideoSupported ?? true,
      config: cfg
    }));
    constructor(opts: any) {
      const inst = makeEncoder(opts.output, opts.error);
      installed.videoEncoderInstances.push(inst);
      return inst as any;
    }
  }

  class MockAudioEncoder {
    static isConfigSupported = vi.fn(async (cfg: any) => ({
      supported: overrides.pickAudioSupported ?? true,
      config: cfg
    }));
    constructor(opts: any) {
      const inst: MockVideoEncoderInstance = {
        configure: vi.fn(),
        encode: vi.fn((_data: unknown) => {
          const ctor = (globalThis as Globalish).EncodedAudioChunk;
          const synthetic = new ctor({
            type: 'key',
            timestamp: 0,
            duration: 21333,
            data: new Uint8Array([0])
          });
          opts.output(synthetic, {
            decoderConfig: {
              codec: 'mp4a.40.2',
              sampleRate: 48000,
              numberOfChannels: 2,
              description: new Uint8Array([0x12, 0x10])
            }
          });
        }),
        flush: vi.fn(async () => undefined),
        encodeQueueSize: 0,
        _output: opts.output,
        _error: opts.error
      };
      installed.audioEncoderInstances.push(inst);
      return inst as any;
    }
  }

  class MockVideoFrame {
    timestamp: number;
    constructor(_src: any, init: { timestamp: number }) {
      installed.videoFramesCreated++;
      this.timestamp = init.timestamp;
    }
    close() {}
  }

  class MockAudioData {
    timestamp: number;
    constructor(init: { timestamp: number }) {
      installed.audioDatasCreated++;
      this.timestamp = init.timestamp;
    }
    close() {}
  }

  class MockOffscreenCanvas {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext(_id: string) {
      // The makeOfflineRenderer chain ends at createRenderer which calls
      // canvas.getContext('2d') — return a stub that satisfies the
      // renderer's `ctx.fillRect / save / restore` calls.
      const noop = () => undefined;
      return {
        canvas: this,
        fillStyle: '',
        strokeStyle: '',
        globalAlpha: 1,
        lineWidth: 1,
        clearRect: noop,
        fillRect: noop,
        save: noop,
        restore: noop,
        setTransform: noop,
        // Identity matrix — see lib/renderer/loop.ts tick() comment.
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } as DOMMatrix),
        drawImage: noop,
        beginPath: noop,
        closePath: noop,
        moveTo: noop,
        lineTo: noop,
        arc: noop,
        stroke: noop,
        fill: noop,
        scale: noop,
        translate: noop,
        rotate: noop,
        setLineDash: noop,
        createRadialGradient: () => ({ addColorStop: noop }),
        getImageData: () => ({
          data: new Uint8ClampedArray(4),
          width: 1,
          height: 1
        })
      } as any;
    }
  }

  (globalThis as Globalish).VideoEncoder = MockVideoEncoder;
  (globalThis as Globalish).AudioEncoder = MockAudioEncoder;
  (globalThis as Globalish).VideoFrame = MockVideoFrame;
  (globalThis as Globalish).AudioData = MockAudioData;
  (globalThis as Globalish).OffscreenCanvas = MockOffscreenCanvas;

  return installed;
}

function uninstallWebCodecsMocks() {
  const g = globalThis as Globalish;
  delete g.VideoEncoder;
  delete g.AudioEncoder;
  delete g.VideoFrame;
  delete g.AudioData;
  delete g.OffscreenCanvas;
}

beforeEach(uninstallWebCodecsMocks);
afterEach(uninstallWebCodecsMocks);

describe('renderOffline — frame loop', () => {
  it('produces ceil(duration × fps) video frames', async () => {
    const installed = installWebCodecsMocks();
    const result = await renderOffline(
      {
        timeline: emptyTimeline(),
        beatGrid: grid120,
        audioClips: [], videoAudioClips: [], mediaRefs: [], bpm: 120, audioDurationSec: 2, sampleRate: 48000, numberOfChannels: 2,
        getImageBitmap: () => undefined,
        flowMode: false
      },
      { fps: 30 }
    );
    expect(installed.videoFramesCreated).toBe(60); // 2 × 30
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('progress callback fires monotonically and reaches 100%', async () => {
    installWebCodecsMocks();
    const progress: number[] = [];
    await renderOffline(
      {
        timeline: emptyTimeline(),
        beatGrid: grid120,
        audioClips: [], videoAudioClips: [], mediaRefs: [], bpm: 120, audioDurationSec: 1, sampleRate: 48000, numberOfChannels: 2,
        getImageBitmap: () => undefined,
        flowMode: false
      },
      {
        fps: 30,
        onProgress: (p) => progress.push(p.currentFrame)
      }
    );
    expect(progress.length).toBe(30);
    expect(progress[0]).toBe(1);
    expect(progress[progress.length - 1]).toBe(30);
    // Monotonic.
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThan(progress[i - 1]);
    }
  });
});

describe('renderOffline — error + cancel', () => {
  it('rejects with AbortError when signal is already aborted', async () => {
    installWebCodecsMocks();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      renderOffline(
        {
          timeline: emptyTimeline(),
          beatGrid: grid120,
          audioClips: [], videoAudioClips: [], mediaRefs: [], bpm: 120, audioDurationSec: 1, sampleRate: 48000, numberOfChannels: 2,
          getImageBitmap: () => undefined,
          flowMode: false
        },
        { signal: ctrl.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('encoder error fires from the error callback → rejects the renderOffline Promise', async () => {
    installWebCodecsMocks();
    // Patch the VideoEncoder so encode() trips _error after 3 frames.
    // The orchestrator checks the error flag BEFORE each encode, so the
    // 4th iteration of the frame loop sees the flag and throws.
    const originalCtor = (globalThis as Globalish).VideoEncoder;
    class FailingVideoEncoder {
      static isConfigSupported = originalCtor.isConfigSupported;
      private encodeCount = 0;
      private readonly _output: any;
      private readonly _error: any;
      configure = vi.fn();
      flush = vi.fn(async () => undefined);
      encodeQueueSize = 0;
      constructor(opts: any) {
        this._output = opts.output;
        this._error = opts.error;
      }
      encode() {
        this.encodeCount++;
        if (this.encodeCount === 3) {
          this._error(new Error('synthetic encoder fail'));
        }
      }
    }
    (globalThis as Globalish).VideoEncoder = FailingVideoEncoder;

    await expect(
      renderOffline(
        {
          timeline: emptyTimeline(),
          beatGrid: grid120,
          audioClips: [], videoAudioClips: [], mediaRefs: [], bpm: 120, audioDurationSec: 1, sampleRate: 48000, numberOfChannels: 2,
          getImageBitmap: () => undefined,
          flowMode: false
        },
        { fps: 30 }
      )
    ).rejects.toThrow('synthetic encoder fail');
  });

  it('throws when no supported codec pair is found', async () => {
    installWebCodecsMocks({ pickVideoSupported: false });
    await expect(
      renderOffline(
        {
          timeline: emptyTimeline(),
          beatGrid: grid120,
          audioClips: [], videoAudioClips: [], mediaRefs: [], bpm: 120, audioDurationSec: 1, sampleRate: 48000, numberOfChannels: 2,
          getImageBitmap: () => undefined,
          flowMode: false
        },
        { fps: 30 }
      )
    ).rejects.toThrow('No supported codec pair');
  });
});

describe('renderOffline — output', () => {
  it('returns ext=mp4 for the default codec preference', async () => {
    installWebCodecsMocks();
    const r = await renderOffline(
      {
        timeline: emptyTimeline(),
        beatGrid: grid120,
        audioClips: [], videoAudioClips: [], mediaRefs: [], bpm: 120, audioDurationSec: 0.5, sampleRate: 48000, numberOfChannels: 2,
        getImageBitmap: () => undefined,
        flowMode: false
      },
      { fps: 30 }
    );
    expect(r.ext).toBe('mp4');
    expect(r.codecLabel).toMatch(/MP4/);
  });

  it('encodes audio chunks after the frame loop completes', async () => {
    const installed = installWebCodecsMocks();
    await renderOffline(
      {
        timeline: emptyTimeline(),
        beatGrid: grid120,
        audioClips: [], videoAudioClips: [], mediaRefs: [], bpm: 120, audioDurationSec: 0.5, sampleRate: 48000, numberOfChannels: 2,
        getImageBitmap: () => undefined,
        flowMode: false
      },
      { fps: 30 }
    );
    expect(installed.audioDatasCreated).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 17–20 + 24: Export Range Selection (Plan 9d Task 3)
// ─────────────────────────────────────────────────────────────────────────────

describe('renderOffline — export range', () => {
  // The renderAt-capture array (vi.mock at top of file) is module-level and
  // accumulates across tests. Reset before each so any test reading it sees
  // only its own render pass — prevents stale-data false failures as the
  // suite grows.
  beforeEach(() => {
    _renderAtTimeSecs.length = 0;
  });

  /**
   * Test 17: Range active → only frames in [rangeStart, rangeEnd] are emitted.
   * Frame count == endFrame - startFrame; first VideoFrame output timestamp == 0 (range-relative),
   * proving the range-relative output index starts at the absolute rangeStart frame.
   */
  it('17: range active — emits only frames in [rangeStart, rangeEnd]', async () => {
    const fps = 30;
    // Range: 1.0s to 2.0s → startFrame=30, endFrame=60 → 30 frames
    const rangeStart = 1.0;
    const rangeEnd = 2.0;
    const startFrame = Math.round(rangeStart * fps); // 30
    const endFrame = Math.round(rangeEnd * fps);     // 60
    const expectedFrameCount = endFrame - startFrame; // 30

    const outputTimestampsUs: number[] = [];

    const installed = installWebCodecsMocks();

    // Spy: capture each VideoFrame's output timestamp (range-relative microseconds).
    const OrigVideoFrame = (globalThis as Globalish).VideoFrame;
    class SpyVideoFrame extends OrigVideoFrame {
      constructor(src: any, init: { timestamp: number }) {
        super(src, init);
        outputTimestampsUs.push(init.timestamp);
      }
    }
    (globalThis as Globalish).VideoFrame = SpyVideoFrame;

    await renderOffline(
      {
        timeline: emptyTimeline(),
        beatGrid: grid120,
        audioClips: [], videoAudioClips: [], mediaRefs: [], bpm: 120,
        audioDurationSec: 3,
        sampleRate: 48000, numberOfChannels: 2,
        getImageBitmap: () => undefined,
        flowMode: false,
        exportRange: { start: rangeStart, end: rangeEnd }
      },
      { fps }
    );

    // Frame count == endFrame - startFrame
    expect(installed.videoFramesCreated).toBe(expectedFrameCount);
    // First output timestamp is 0 (range-relative; absolute timeSec of first frame = startFrame/fps = 1.0s)
    expect(outputTimestampsUs[0]).toBe(0);
    // Last output timestamp corresponds to (endFrame - startFrame - 1) * (1e6/fps)
    expect(outputTimestampsUs[expectedFrameCount - 1]).toBe(
      Math.round((expectedFrameCount - 1) * (1_000_000 / fps))
    );
  });

  /**
   * Test 18: Output frame index is range-relative.
   * First emitted VideoFrame timestamp == 0; subsequent timestamps increment by 1e6/fps.
   */
  it('18: output VideoFrame timestamps are range-relative (start at 0)', async () => {
    const fps = 30;
    const rangeStart = 2.0;
    const rangeEnd = 3.0;

    const frameTimestampsUs: number[] = [];
    installWebCodecsMocks();
    const OrigVideoFrame = (globalThis as Globalish).VideoFrame;
    class SpyVideoFrame extends OrigVideoFrame {
      constructor(src: any, init: { timestamp: number }) {
        super(src, init);
        frameTimestampsUs.push(init.timestamp);
      }
    }
    (globalThis as Globalish).VideoFrame = SpyVideoFrame;

    await renderOffline(
      {
        timeline: emptyTimeline(),
        beatGrid: grid120,
        audioClips: [], videoAudioClips: [], mediaRefs: [], bpm: 120,
        audioDurationSec: 4,
        sampleRate: 48000, numberOfChannels: 2,
        getImageBitmap: () => undefined,
        flowMode: false,
        exportRange: { start: rangeStart, end: rangeEnd }
      },
      { fps }
    );

    const expectedCount = Math.round(rangeEnd * fps) - Math.round(rangeStart * fps); // 30
    expect(frameTimestampsUs).toHaveLength(expectedCount);

    // First frame timestamp must be 0
    expect(frameTimestampsUs[0]).toBe(0);

    // All frames increment by round(i * 1_000_000/fps) microseconds.
    // Implementation uses Math.round(outputFrameIdx * (1_000_000 / fps))
    // which is more precise than i * Math.round(1_000_000/fps).
    for (let i = 1; i < frameTimestampsUs.length; i++) {
      expect(frameTimestampsUs[i]).toBe(Math.round(i * (1_000_000 / fps)));
    }
  });

  /**
   * Test 19: renderAt receives ABSOLUTE timeSec, not range-relative.
   *
   * We capture every timeSec passed to renderAt via the module-level
   * _renderAtTimeSecs array (see vi.mock at top of file).  With
   * rangeStart=1.0s and fps=30, startFrame=30, endFrame=60 → 30 frames.
   * The captured sequence MUST be [30/30, 31/30, …, 59/30] (absolute).
   * If the implementation mistakenly passed range-relative time (starting
   * at 0/fps = 0.0), the first assertion `capturedTimes[0] ≈ 1.0` would
   * FAIL, proving the test is not a tautology.
   */
  it('19: renderer receives ABSOLUTE timeSec, not range-relative', async () => {
    const fps = 30;
    const rangeStart = 1.0;
    const rangeEnd   = 2.0;
    const startFrame = Math.round(rangeStart * fps); // 30
    const endFrame   = Math.round(rangeEnd   * fps); // 60
    const expectedCount = endFrame - startFrame;      // 30

    installWebCodecsMocks();

    await renderOffline(
      {
        timeline: emptyTimeline(),
        beatGrid: grid120,
        audioClips: [], videoAudioClips: [], mediaRefs: [], bpm: 120,
        audioDurationSec: 3,
        sampleRate: 48000, numberOfChannels: 2,
        getImageBitmap: () => undefined,
        flowMode: false,
        exportRange: { start: rangeStart, end: rangeEnd }
      },
      { fps }
    );

    // Exactly expectedCount renderAt calls.
    expect(_renderAtTimeSecs).toHaveLength(expectedCount);

    // PRIMARY: first call must be at ABSOLUTE t = startFrame/fps = 1.0s.
    // A range-relative-time bug would produce 0.0 here → test would FAIL.
    expect(_renderAtTimeSecs[0]).toBeCloseTo(startFrame / fps, 9);   // 1.0

    // Each subsequent call increments by exactly 1/fps.
    for (let i = 0; i < expectedCount; i++) {
      expect(_renderAtTimeSecs[i]).toBeCloseTo((startFrame + i) / fps, 9);
    }

    // Last call: absolute t = (endFrame - 1) / fps = 59/30 ≈ 1.9667s
    expect(_renderAtTimeSecs[expectedCount - 1]).toBeCloseTo(
      (endFrame - 1) / fps,
      9
    );
  });

  /**
   * Test 20: export loop samples at ABSOLUTE t even with a large rangeStart.
   *
   * rangeStart = 10s, fps = 10 → startFrame = 100.  The first renderAt call
   * MUST receive timeSec = 10.0 (absolute).  If the implementation passed
   * range-relative time it would pass 0.0 → the primary assertion fails.
   *
   * Secondary: resolveParam at that absolute beat gives the correct
   * interpolated automation value — proving beat-phase correctness flows
   * from absolute sampling (independent of rangeStart).
   */
  it('20: export sampling is absolute — rangeStart=10s first frame captured at t=10.0s', async () => {
    const fps = 10;
    const rangeStart = 10.0;
    const rangeEnd   = 10.5;      // 5 frames: f=100..104
    const startFrame = Math.round(rangeStart * fps); // 100

    installWebCodecsMocks();

    await renderOffline(
      {
        timeline: emptyTimeline(),
        beatGrid: grid120,
        audioClips: [], videoAudioClips: [], mediaRefs: [], bpm: 120,
        audioDurationSec: 15,
        sampleRate: 48000, numberOfChannels: 2,
        getImageBitmap: () => undefined,
        flowMode: false,
        exportRange: { start: rangeStart, end: rangeEnd }
      },
      { fps }
    );

    // PRIMARY: first renderAt call must be at ABSOLUTE t = 10.0s.
    // A range-relative-time bug would produce t = 0.0 → assertion fails.
    expect(_renderAtTimeSecs.length).toBeGreaterThanOrEqual(1);
    expect(_renderAtTimeSecs[0]).toBeCloseTo(startFrame / fps, 9); // 10.0

    // SECONDARY: resolveParam at the absolute beat matching t=10s yields
    // the expected automation value, confirming that absolute sampling
    // feeds correct beat context into the renderer.
    const { resolveParam } = await import('@/lib/automation/resolve');
    const bpm = 120; // 1 beat = 0.5s → t=10s ≡ beat 20
    const absoluteBeat = (_renderAtTimeSecs[0] * bpm) / 60; // 20
    const curve = {
      mode: 'automation' as const,
      interpolation: 'linear' as const,
      points: [
        { beat: 0,  value: 0 },
        { beat: 40, value: 1 }
      ]
    };
    // beat 20 / 40 → 0.5 (linear)
    expect(resolveParam(curve, absoluteBeat)).toBeCloseTo(0.5, 5);
    // If sampling were range-relative (beat 0) we'd get 0, not 0.5.
    expect(resolveParam(curve, 0)).toBe(0);
  });

  /**
   * Test 24: No range (null) → output identical to baseline (same frame count, same timestamps).
   */
  it('24: no range (null) → full-project baseline, no-op', async () => {
    const fps = 30;
    const audioDurationSec = 2;
    const expectedFrames = Math.ceil(audioDurationSec * fps); // 60

    const frameTimestampsUs: number[] = [];
    installWebCodecsMocks();
    const OrigVideoFrame = (globalThis as Globalish).VideoFrame;
    class SpyVideoFrame extends OrigVideoFrame {
      constructor(src: any, init: { timestamp: number }) {
        super(src, init);
        frameTimestampsUs.push(init.timestamp);
      }
    }
    (globalThis as Globalish).VideoFrame = SpyVideoFrame;

    await renderOffline(
      {
        timeline: emptyTimeline(),
        beatGrid: grid120,
        audioClips: [], videoAudioClips: [], mediaRefs: [], bpm: 120,
        audioDurationSec,
        sampleRate: 48000, numberOfChannels: 2,
        getImageBitmap: () => undefined,
        flowMode: false,
        exportRange: null  // explicit null — no range
      },
      { fps }
    );

    expect(frameTimestampsUs).toHaveLength(expectedFrames);
    // Timestamps are absolute (not range-relative): frame 0 → 0, frame 1 → 33333us, etc.
    expect(frameTimestampsUs[0]).toBe(0);
    expect(frameTimestampsUs[1]).toBe(Math.round((1 / fps) * 1_000_000));
    expect(frameTimestampsUs[expectedFrames - 1]).toBe(
      Math.round(((expectedFrames - 1) / fps) * 1_000_000)
    );
  });
});
