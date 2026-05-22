import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderOffline } from '@/lib/export/offline-render';
import type { TimelineState } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

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
