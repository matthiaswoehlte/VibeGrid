import {
  Muxer as Mp4Muxer,
  ArrayBufferTarget as Mp4ArrayBufferTarget
} from 'mp4-muxer';
import {
  Muxer as WebmMuxer,
  ArrayBufferTarget as WebmArrayBufferTarget
} from 'webm-muxer';

/**
 * Plan-6-R Task 6: thin facade over mp4-muxer / webm-muxer.
 *
 * Both libraries share a near-identical surface — they expose a Muxer +
 * ArrayBufferTarget pair, accept `addVideoChunk(chunk, meta)` and
 * `addAudioChunk(chunk, meta)`, and finalize the container in memory.
 * The orchestrator only depends on `OfflineMuxer`, so swapping codecs
 * is one factory call.
 *
 * `fastStart: 'in-memory'` (mp4-muxer only) keeps the entire output in
 * RAM until `finalize()`. For a 5-minute 1080p / 8 Mbit/s clip that's
 * ~300 MB — acceptable for v0.1. Longer projects should switch to
 * `StreamTarget` (writes chunks to a `WritableStream`) — out of scope.
 */

export interface OfflineMuxer {
  readonly ext: 'mp4' | 'webm';
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
  finalize(): Uint8Array;
}

export interface MuxerInit {
  ext: 'mp4' | 'webm';
  /** Picked video codec, e.g. 'avc1.42E01E' or 'vp09.00.10.08'. The muxers
   *  map to their own short codes internally; we don't pass this through. */
  videoCodec: string;
  audioCodec: 'mp4a.40.2' | 'opus';
  width: number;
  height: number;
  fps: number;
  sampleRate: number;
  channels: number;
}

export function createOfflineMuxer(init: MuxerInit): OfflineMuxer {
  if (init.ext === 'mp4') {
    const target = new Mp4ArrayBufferTarget();
    const muxer = new Mp4Muxer({
      target,
      video: {
        codec: 'avc',
        width: init.width,
        height: init.height,
        frameRate: init.fps
      },
      audio: {
        codec: 'aac',
        numberOfChannels: init.channels,
        sampleRate: init.sampleRate
      },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset'
    });
    return {
      ext: 'mp4',
      addVideoChunk(chunk, meta) {
        muxer.addVideoChunk(chunk, meta);
      },
      addAudioChunk(chunk, meta) {
        muxer.addAudioChunk(chunk, meta);
      },
      finalize(): Uint8Array {
        muxer.finalize();
        return new Uint8Array(target.buffer);
      }
    };
  }

  const target = new WebmArrayBufferTarget();
  const muxer = new WebmMuxer({
    target,
    video: {
      codec: 'V_VP9',
      width: init.width,
      height: init.height,
      frameRate: init.fps
    },
    audio: {
      codec: 'A_OPUS',
      numberOfChannels: init.channels,
      sampleRate: init.sampleRate
    },
    firstTimestampBehavior: 'offset'
  });
  return {
    ext: 'webm',
    addVideoChunk(chunk, meta) {
      muxer.addVideoChunk(chunk, meta);
    },
    addAudioChunk(chunk, meta) {
      muxer.addAudioChunk(chunk, meta);
    },
    finalize(): Uint8Array {
      muxer.finalize();
      return new Uint8Array(target.buffer);
    }
  };
}
