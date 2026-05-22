import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderOffline } from '@/lib/export/offline-render';
import type { TimelineState } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';
import type { VideoEngine } from '@/lib/video/engine';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Globalish = Record<string, any>;

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

/** Borrows the same WebCodecs mocks as the existing offline-render tests
 *  but in a much trimmer form — we only care about the video-seek path. */
function installWebCodecsMocks() {
  const videoChunks: unknown[] = [];
  const audioChunks: unknown[] = [];

  class MockVideoEncoder {
    static isConfigSupported = vi.fn(async (cfg: any) => ({ supported: true, config: cfg }));
    private readonly output: any;
    encodeQueueSize = 0;
    configure = vi.fn();
    flush = vi.fn(async () => undefined);
    constructor(opts: any) {
      this.output = opts.output;
    }
    encode(_frame: unknown) {
      const ctor = (globalThis as Globalish).EncodedVideoChunk;
      const chunk = new ctor({ type: 'key', timestamp: 0, duration: 33333, data: new Uint8Array([0]) });
      this.output(chunk, { decoderConfig: { codec: 'avc1.42E01E', codedWidth: 1920, codedHeight: 1080, description: new Uint8Array([1, 2, 3, 4]) } });
      videoChunks.push(chunk);
    }
  }

  class MockAudioEncoder {
    static isConfigSupported = vi.fn(async (cfg: any) => ({ supported: true, config: cfg }));
    private readonly output: any;
    encodeQueueSize = 0;
    configure = vi.fn();
    flush = vi.fn(async () => undefined);
    constructor(opts: any) {
      this.output = opts.output;
    }
    encode(_data: unknown) {
      const ctor = (globalThis as Globalish).EncodedAudioChunk;
      const chunk = new ctor({ type: 'key', timestamp: 0, duration: 21333, data: new Uint8Array([0]) });
      this.output(chunk, { decoderConfig: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, description: new Uint8Array([0x12, 0x10]) } });
      audioChunks.push(chunk);
    }
  }

  class MockVideoFrame {
    constructor(_src: any, init: { timestamp: number }) { void init; }
    close() {}
  }
  class MockAudioData {
    constructor(_init: any) {}
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
      const noop = () => undefined;
      return {
        canvas: this,
        fillStyle: '',
        strokeStyle: '',
        globalAlpha: 1,
        lineWidth: 1,
        font: '',
        textAlign: 'start',
        textBaseline: 'alphabetic',
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
        measureText: () => ({ width: 0 } as TextMetrics),
        fillText: noop,
        createLinearGradient: () => ({ addColorStop: noop }),
        createRadialGradient: () => ({ addColorStop: noop }),
        getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })
      } as any;
    }
  }
  (globalThis as Globalish).VideoEncoder = MockVideoEncoder;
  (globalThis as Globalish).AudioEncoder = MockAudioEncoder;
  (globalThis as Globalish).VideoFrame = MockVideoFrame;
  (globalThis as Globalish).AudioData = MockAudioData;
  (globalThis as Globalish).OffscreenCanvas = MockOffscreenCanvas;
}

function uninstall() {
  const g = globalThis as Globalish;
  delete g.VideoEncoder;
  delete g.AudioEncoder;
  delete g.VideoFrame;
  delete g.AudioData;
  delete g.OffscreenCanvas;
}

beforeEach(() => {
  uninstall();
  installWebCodecsMocks();
});

afterEach(uninstall);

describe('renderOffline — Plan 5.9b video seek', () => {
  it('calls videoEngine.seekAllTo once per frame', async () => {
    const seekAllTo = vi.fn(async (_t: number) => undefined);
    const engine: VideoEngine = {
      load: vi.fn(async () => undefined),
      unload: vi.fn(),
      seekTo: vi.fn(async () => undefined),
      seekAllTo,
      play: vi.fn(),
      pause: vi.fn(),
      getElement: vi.fn(() => null),
      loadedIds: vi.fn(() => []),
      destroy: vi.fn()
    };
    await renderOffline(
      {
        timeline: emptyTimeline(),
        beatGrid: grid120,
        audioClips: [], videoAudioClips: [], mediaRefs: [], bpm: 120, audioDurationSec: 1, sampleRate: 48000, numberOfChannels: 2, // 30 frames at 30fps
        getImageBitmap: () => undefined,
        videoEngine: engine,
        flowMode: false
      },
      { fps: 30 }
    );
    expect(seekAllTo).toHaveBeenCalledTimes(30);
    expect(seekAllTo).toHaveBeenNthCalledWith(1, 0);
    expect(seekAllTo).toHaveBeenNthCalledWith(2, 1 / 30);
  });

  it('no videoEngine = no seek calls (projects without video unchanged)', async () => {
    const blob = await renderOffline(
      {
        timeline: emptyTimeline(),
        beatGrid: grid120,
        audioClips: [], videoAudioClips: [], mediaRefs: [], bpm: 120, audioDurationSec: 0.5, sampleRate: 48000, numberOfChannels: 2,
        getImageBitmap: () => undefined,
        flowMode: false
      },
      { fps: 30 }
    );
    expect(blob.blob).toBeInstanceOf(Blob);
  });

  it('AbortSignal interrupts the loop between seek and encode', async () => {
    const ctrl = new AbortController();
    const seekAllTo = vi.fn(async (_t: number) => {
      ctrl.abort(); // Abort right after the first seek.
    });
    const engine: VideoEngine = {
      load: vi.fn(async () => undefined),
      unload: vi.fn(),
      seekTo: vi.fn(async () => undefined),
      seekAllTo,
      play: vi.fn(),
      pause: vi.fn(),
      getElement: vi.fn(() => null),
      loadedIds: vi.fn(() => []),
      destroy: vi.fn()
    };
    await expect(
      renderOffline(
        {
          timeline: emptyTimeline(),
          beatGrid: grid120,
          audioClips: [], videoAudioClips: [], mediaRefs: [], bpm: 120, audioDurationSec: 1, sampleRate: 48000, numberOfChannels: 2,
          getImageBitmap: () => undefined,
          videoEngine: engine,
          flowMode: false
        },
        { fps: 30, signal: ctrl.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
