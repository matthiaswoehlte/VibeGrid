import { describe, it, expect } from 'vitest';
import { createOfflineMuxer } from '@/lib/export/muxer';

const baseInit = {
  width: 1920,
  height: 1080,
  fps: 30,
  sampleRate: 48000,
  channels: 2
} as const;

/** mp4-muxer / webm-muxer do `instanceof EncodedVideoChunk` checks; the
 *  stub class in vitest.setup.ts satisfies that. We construct chunks via
 *  the stub's init form. */
function makeVideoChunk(data: Uint8Array, timestamp: number, keyFrame = true) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = (globalThis as any).EncodedVideoChunk;
  return new Ctor({
    type: keyFrame ? 'key' : 'delta',
    timestamp,
    duration: Math.round(1_000_000 / 30),
    data
  }) as EncodedVideoChunk;
}

function makeAudioChunk(data: Uint8Array, timestamp: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = (globalThis as any).EncodedAudioChunk;
  return new Ctor({
    type: 'key',
    timestamp,
    duration: Math.round((1024 / 48000) * 1_000_000),
    data
  }) as EncodedAudioChunk;
}

/**
 * Minimal video decoder config that mp4-muxer accepts as `description`.
 * For avc the description is the AVC config record; for the test we use
 * a 4-byte stub — the muxer just stores it in the metadata box.
 */
function makeVideoMeta() {
  return {
    decoderConfig: {
      codec: 'avc1.42E01E',
      codedWidth: 1920,
      codedHeight: 1080,
      description: new Uint8Array([0x01, 0x42, 0xe0, 0x1e])
    }
  } as unknown as EncodedVideoChunkMetadata;
}

function makeAudioMeta() {
  return {
    decoderConfig: {
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 2,
      description: new Uint8Array([0x12, 0x10])
    }
  } as unknown as EncodedAudioChunkMetadata;
}

describe('createOfflineMuxer', () => {
  it('returns an OfflineMuxer with ext=mp4 for MP4 init', () => {
    const m = createOfflineMuxer({
      ...baseInit,
      ext: 'mp4',
      videoCodec: 'avc1.42E01E',
      audioCodec: 'mp4a.40.2'
    });
    expect(m.ext).toBe('mp4');
  });

  it('returns an OfflineMuxer with ext=webm for WebM init', () => {
    const m = createOfflineMuxer({
      ...baseInit,
      ext: 'webm',
      videoCodec: 'vp09.00.10.08',
      audioCodec: 'opus'
    });
    expect(m.ext).toBe('webm');
  });

  it('finalize() returns a non-empty Uint8Array after a few chunks are added (mp4)', () => {
    const m = createOfflineMuxer({
      ...baseInit,
      ext: 'mp4',
      videoCodec: 'avc1.42E01E',
      audioCodec: 'mp4a.40.2'
    });
    const meta = makeVideoMeta();
    m.addVideoChunk(makeVideoChunk(new Uint8Array([0, 1, 2, 3]), 0), meta);
    m.addVideoChunk(makeVideoChunk(new Uint8Array([4, 5, 6, 7]), 33333, false), meta);
    m.addAudioChunk(makeAudioChunk(new Uint8Array([8, 9]), 0), makeAudioMeta());
    const bytes = m.finalize();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});
